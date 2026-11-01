import { Types } from 'mongoose';
import { AgentTask } from '../models/AgentTask';
import { Customer, DevelopmentLetter, Project, User } from '../models';
import {
  OutreachAutomationConfig,
  OutreachAutomationDay,
  OutreachAutomationEnrollment,
} from '../models/OutreachAutomation';
import type { AuthUser } from '../types/express';
import { ApiError } from '../utils/ApiError';
import { customerScope, requireProjectId } from '../utils/access';
import { createLogger } from '../config/logger';
import { getCurrentMailSender } from './mail-account.service';
import { queueOutreachStep } from './agent/outreach-sequence.service';
import { hasProtectedCustomerMail } from './agent/mail-thread-analysis.service';
import { draftHash } from './agent/knowledge-grounding';
import { approveDraftForAutomation, resendLetter } from './letter.service';
import { syncOutreachFollowUps } from './outreach-followup.service';
import type { OutreachStep } from './project-profile';

const logger = createLogger('outreach-automation');
const AUTO_TARGET_STATUSES = ['pending', 'contacted'] as const;
const MAX_AUTO_STEPS = 3;
const DAY_MS = 86_400_000;
const TICK_MS = 15_000;
const MAX_QUEUE_ROWS = 80;

export interface OutreachAutomationConfigDto {
  id: string;
  enabled: boolean;
  pausedReason?: string;
  dailyLimit: number;
  perDomainLimit: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  version: number;
}

export interface OutreachAutomationQueueRow {
  id: string;
  customerId: string;
  customerName: string;
  company?: string;
  email?: string;
  customerStatus: string;
  status: string;
  currentStep: number;
  nextStep: number;
  nextRunAt: string;
  lastError?: string;
  lastSentAt?: string;
}

export interface OutreachAutomationRecentRow {
  letterId: string;
  customerId: string;
  customerName: string;
  step: number;
  sentAt: string;
  status: string;
}

export interface OutreachAutomationOverview {
  config: OutreachAutomationConfigDto;
  mailbox: {
    email: string;
    displayName: string;
    channel: 'mock' | 'smtp';
    canSend: boolean;
    reason?: string;
    usedToday: number;
    dailyLimit: number;
  } | null;
  stats: {
    eligible: number;
    enrolled: number;
    active: number;
    paused: number;
    completed: number;
    blocked: number;
    failed: number;
    sentToday: number;
    remainingToday: number;
  };
  queue: OutreachAutomationQueueRow[];
  recent: OutreachAutomationRecentRow[];
}

export interface OutreachAutomationConfigInput {
  expectedVersion: number;
  dailyLimit: number;
  perDomainLimit: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
}

const dayFormatter = (timezone: string): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
};

const timeFormatter = (timezone: string): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  }
};

export function dayIn(timezone: string, now = new Date()): string {
  return dayFormatter(timezone).format(now);
}

export function localClock(timezone: string, now = new Date()): { minutes: number; weekday: number } {
  const parts = timeFormatter(timezone).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const weekdayName = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minutes: hour * 60 + minute, weekday: weekdayMap[weekdayName] ?? 1 };
}

export function isWithinSendWindow(
  config: Pick<OutreachAutomationConfigDto, 'windowStart' | 'windowEnd' | 'timezone'>,
  now = new Date(),
): boolean {
  const { minutes, weekday } = localClock(config.timezone, now);
  if (weekday === 0 || weekday === 6) return false;
  const [startHour, startMinute] = config.windowStart.split(':').map(Number);
  const [endHour, endMinute] = config.windowEnd.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
}

function configDto(doc: InstanceType<typeof OutreachAutomationConfig>): OutreachAutomationConfigDto {
  return {
    id: String(doc._id),
    enabled: doc.enabled,
    ...(doc.pausedReason ? { pausedReason: doc.pausedReason } : {}),
    dailyLimit: Number(doc.dailyLimit),
    perDomainLimit: Number(doc.perDomainLimit),
    windowStart: doc.windowStart,
    windowEnd: doc.windowEnd,
    timezone: doc.timezone,
    version: Number(doc.version),
  };
}

function scope(actor: AuthUser, targetUserId?: string) {
  return {
    projectId: new Types.ObjectId(requireProjectId(actor)),
    userId: new Types.ObjectId(targetUserId ?? actor.id),
  };
}

async function resolveTargetUser(actor: AuthUser, targetUserId?: string): Promise<{ id: string; role: 'admin' | 'user' }> {
  if (!targetUserId || targetUserId === actor.id) {
    return { id: actor.id, role: actor.role === 'admin' ? 'admin' : 'user' };
  }
  if (actor.role !== 'admin') throw ApiError.forbidden('只有管理员可以管理其他业务员的自动开发');
  if (!/^[a-f\d]{24}$/i.test(targetUserId)) throw ApiError.badRequest('业务员 ID 格式不正确');
  const user = await User.findOne({ _id: targetUserId, status: 'active' }).select('role projectIds');
  if (!user) throw ApiError.notFound('业务员不存在或已停用');
  if (user.role !== 'admin' && !user.projectIds.some((id) => String(id) === String(requireProjectId(actor)))) {
    throw ApiError.notFound('该业务员不在当前项目中');
  }
  return { id: String(user._id), role: user.role === 'admin' ? 'admin' : 'user' };
}

async function getConfig(actor: AuthUser, targetUserId?: string) {
  const target = await resolveTargetUser(actor, targetUserId);
  const base = scope(actor, target.id);
  const existing = await OutreachAutomationConfig.findOne(base);
  if (existing) return existing;
  try {
    return await OutreachAutomationConfig.create({
      ...base,
      actorRole: target.role,
      enabled: false,
      dailyLimit: 20,
      perDomainLimit: 3,
      windowStart: '09:30',
      windowEnd: '17:30',
      timezone: 'Asia/Shanghai',
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await OutreachAutomationConfig.findOne(base);
    if (!raced) throw ApiError.internal('自动开发配置创建失败');
    return raced;
  }
}

function eligibleFilter(actor: AuthUser, targetUserId?: string) {
  return {
    ...customerScope(actor),
    ownerId: new Types.ObjectId(targetUserId ?? actor.id),
    email: { $exists: true, $ne: '' },
    status: { $in: [...AUTO_TARGET_STATUSES] },
    outreachAbandonedAt: null,
    outreachRepliedAt: null,
    $or: [{ outreachStep: { $lt: MAX_AUTO_STEPS } }, { outreachStep: { $exists: false } }],
  };
}


async function getActorForConfig(doc: InstanceType<typeof OutreachAutomationConfig>): Promise<AuthUser> {
  const [user, project] = await Promise.all([
    User.findById(doc.userId).select('username displayName role status projectIds'),
    Project.findById(doc.projectId).select('status'),
  ]);
  if (!user || user.status === 'disabled' || !project || project.status !== 'active') {
    throw new Error('当前账号或项目已停用');
  }
  if (user.role !== 'admin' && !user.projectIds.some((id) => String(id) === String(doc.projectId))) {
    throw new Error('当前账号已不在该项目中');
  }
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    role: doc.actorRole === 'admin' && user.role === 'admin' ? 'admin' : 'user',
    projectId: String(doc.projectId),
  };
}

async function reserveDay(
  projectId: Types.ObjectId,
  campaignId: Types.ObjectId,
  timezone: string,
  dailyLimit: number,
  now: Date,
): Promise<boolean> {
  const day = dayIn(timezone, now);
  let bucket = await OutreachAutomationDay.findOne({ campaignId, day });
  if (!bucket) {
    try {
      bucket = await OutreachAutomationDay.create({ projectId, campaignId, day, sent: 0 });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  if (!bucket) return false;
  const reserved = await OutreachAutomationDay.findOneAndUpdate(
    { campaignId, day, sent: { $lt: dailyLimit } },
    { $inc: { sent: 1 } },
    { new: true },
  );
  return Boolean(reserved);
}

async function releaseDay(campaignId: Types.ObjectId, timezone: string, now: Date): Promise<void> {
  await OutreachAutomationDay.updateOne(
    { campaignId, day: dayIn(timezone, now), sent: { $gt: 0 } },
    { $inc: { sent: -1 } },
  );
}

async function domainAtLimit(campaignId: Types.ObjectId, email: string, limit: number, now: Date): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return true;
  const letters = await DevelopmentLetter.find({
    automationCampaignId: campaignId,
    status: { $in: ['sent', 'opened'] },
    sentAt: { $gte: new Date(now.getTime() - DAY_MS) },
  }).select('recipientEmail').lean();
  return letters.filter((letter) => String(letter.recipientEmail).toLowerCase().endsWith(`@${domain}`)).length >= limit;
}

/** Keep a safe amount of time between automatic sends, even if many rows are due. */
async function campaignPacingReady(campaignId: Types.ObjectId, now: Date): Promise<boolean> {
  const last = await DevelopmentLetter.findOne({
    automationCampaignId: campaignId,
    status: { $in: ['sent', 'opened', 'queued', 'scheduled', 'sending', 'retrying'] },
  }).sort({ sentAt: -1, createdAt: -1 }).select('createdAt sentAt').lean();
  const at = last?.sentAt ?? last?.createdAt;
  return !at || now.getTime() - new Date(at).getTime() >= 60_000;
}

async function ensureEnrollment(
  campaignId: Types.ObjectId,
  actor: AuthUser,
  customer: { _id: Types.ObjectId; outreachStep?: number; nextFollowUpAt?: Date },
  now: Date,
  ownerId: Types.ObjectId,
) {
  const existing = await OutreachAutomationEnrollment.findOne({ campaignId, customerId: customer._id });
  if (existing) {
    if (['paused', 'failed'].includes(existing.status)) {
      await OutreachAutomationEnrollment.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'active',
            nextRunAt: now,
            lastError: null,
            attempts: 0,
          },
        },
      );
    }
    return existing;
  }
  try {
    return await OutreachAutomationEnrollment.create({
      projectId: new Types.ObjectId(requireProjectId(actor)),
      campaignId,
      userId: ownerId,
      customerId: customer._id,
      status: 'active',
      currentStep: Number(customer.outreachStep ?? 0),
      nextRunAt: customer.nextFollowUpAt && new Date(customer.nextFollowUpAt) > now ? customer.nextFollowUpAt : now,
      taskIds: [],
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await OutreachAutomationEnrollment.findOne({ campaignId, customerId: customer._id });
    if (!raced) throw ApiError.internal('自动开发队列创建失败');
    return raced;
  }
}

export async function getOutreachAutomationOverview(actor: AuthUser, targetUserId?: string): Promise<OutreachAutomationOverview> {
  const target = await resolveTargetUser(actor, targetUserId);
  const config = await getConfig(actor, target.id);
  const mailbox = await getCurrentMailSender(String(requireProjectId(actor)), target.id);
  const projectFilter = { ...scope(actor, target.id), campaignId: config._id };
  const now = new Date();
  const [rows, grouped, recentLetters, enrolledCustomerIds] = await Promise.all([
    OutreachAutomationEnrollment.find(projectFilter)
      .sort({ nextRunAt: 1, updatedAt: -1 })
      .limit(MAX_QUEUE_ROWS)
      .lean(),
    OutreachAutomationEnrollment.aggregate<{ _id: string; count: number }>([
      { $match: projectFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    DevelopmentLetter.find({
      projectId: config.projectId,
      automationCampaignId: config._id,
      status: { $in: ['sent', 'opened'] },
    }).sort({ sentAt: -1 }).limit(12).select('_id customerId outreachStep sentAt status createdAt').lean(),
    OutreachAutomationEnrollment.distinct('customerId', projectFilter),
  ]);
  const eligible = await Customer.countDocuments({
    ...eligibleFilter(actor, target.id),
    ...(enrolledCustomerIds.length ? { _id: { $nin: enrolledCustomerIds } } : {}),
  });

  const customerIds = [...new Set([...rows.map((row) => String(row.customerId)), ...recentLetters.map((letter) => String(letter.customerId))])]
    .filter((id) => /^[a-f\d]{24}$/i.test(id))
    .map((id) => new Types.ObjectId(id));
  const customers = customerIds.length
    ? await Customer.find({ _id: { $in: customerIds }, projectId: config.projectId }).select('name company email status').lean()
    : [];
  const customerMap = new Map(customers.map((customer) => [String(customer._id), customer]));
  const counts = grouped.reduce<Record<string, number>>((acc, row) => {
    acc[String(row._id)] = Number(row.count);
    return acc;
  }, {});
  const enrolled = grouped.reduce((total, row) => total + Number(row.count), 0);
  const sentTodayBucket = await OutreachAutomationDay.findOne({ campaignId: config._id, day: dayIn(config.timezone, now) }).lean();
  const sentToday = Number(sentTodayBucket?.sent ?? 0);

  return {
    config: configDto(config),
    mailbox: mailbox.account ? {
      email: mailbox.account.email,
      displayName: mailbox.account.displayName,
      channel: mailbox.channel,
      canSend: mailbox.canSend,
      ...(mailbox.reason ? { reason: mailbox.reason } : {}),
      usedToday: mailbox.account.usedToday,
      dailyLimit: mailbox.account.dailyLimit,
    } : null,
    stats: {
      eligible,
      enrolled,
      active: counts.active ?? 0,
      paused: counts.paused ?? 0,
      completed: counts.completed ?? 0,
      blocked: counts.blocked ?? 0,
      failed: counts.failed ?? 0,
      sentToday,
      remainingToday: Math.max(0, config.dailyLimit - sentToday),
    },
    queue: rows.map((row) => {
      const customer = customerMap.get(String(row.customerId));
      return {
        id: String(row._id),
        customerId: String(row.customerId),
        customerName: customer?.name ?? '客户已删除',
        ...(customer?.company ? { company: customer.company } : {}),
        ...(customer?.email ? { email: customer.email } : {}),
        customerStatus: customer?.status ?? '',
        status: row.status,
        currentStep: Number(row.currentStep ?? 0),
        nextStep: Math.min(MAX_AUTO_STEPS, Number(row.currentStep ?? 0) + 1),
        nextRunAt: new Date(row.nextRunAt).toISOString(),
        ...(row.lastError ? { lastError: row.lastError } : {}),
        ...(row.lastSentAt ? { lastSentAt: new Date(row.lastSentAt).toISOString() } : {}),
      };
    }),
    recent: recentLetters.map((letter) => {
      const customer = customerMap.get(String(letter.customerId));
      return {
        letterId: String(letter._id),
        customerId: String(letter.customerId),
        customerName: customer?.name ?? '客户已删除',
        step: Number(letter.outreachStep ?? 0),
        sentAt: new Date(letter.sentAt ?? letter.createdAt).toISOString(),
        status: letter.status,
      };
    }),
  };
}

export async function saveOutreachAutomationConfig(
  input: OutreachAutomationConfigInput,
  actor: AuthUser,
  targetUserId?: string,
): Promise<OutreachAutomationOverview> {
  const target = await resolveTargetUser(actor, targetUserId);
  const config = await getConfig(actor, target.id);
  if (config.version !== input.expectedVersion) throw ApiError.conflict('自动开发设置已变化，请刷新后重试');
  if (input.windowStart >= input.windowEnd) throw ApiError.badRequest('发送开始时间必须早于结束时间');
  const saved = await OutreachAutomationConfig.findOneAndUpdate(
    { _id: config._id, version: input.expectedVersion },
    {
      $set: {
        dailyLimit: input.dailyLimit,
        perDomainLimit: input.perDomainLimit,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timezone: input.timezone,
      },
      $inc: { version: 1 },
    },
    { new: true, runValidators: true },
  );
  if (!saved) throw ApiError.conflict('自动开发设置已变化，请刷新后重试');
  return getOutreachAutomationOverview(actor, target.id);
}

async function assertMailboxReady(actor: AuthUser, targetUserId?: string) {
  const target = await resolveTargetUser(actor, targetUserId);
  const mailbox = await getCurrentMailSender(String(requireProjectId(actor)), target.id);
  if (mailbox.channel !== 'smtp') {
    throw ApiError.conflict('当前项目使用模拟发送，自动开发需要先启用真实 SMTP 发送');
  }
  if (!mailbox.canSend) throw ApiError.conflict(mailbox.reason || '个人发件邮箱不可用，请先验证邮箱');
  return mailbox;
}

export async function startOutreachAutomation(
  actor: AuthUser,
  customerIds?: string[],
  targetUserId?: string,
): Promise<{ enrolled: number; skipped: number; overview: OutreachAutomationOverview }> {
  const target = await resolveTargetUser(actor, targetUserId);
  await assertMailboxReady(actor, target.id);
  const config = await getConfig(actor, target.id);
  const now = new Date();
  let candidates;
  if (customerIds?.length) {
    const ids = customerIds.filter((id) => /^[a-f\d]{24}$/i.test(id)).map((id) => new Types.ObjectId(id));
    candidates = await Customer.find({ ...eligibleFilter(actor, target.id), _id: { $in: ids } })
      .select('_id outreachStep nextFollowUpAt')
      .lean();
  } else {
    candidates = await Customer.find(eligibleFilter(actor, target.id))
      .select('_id outreachStep nextFollowUpAt')
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();
  }

  let enrolled = 0;
  let skipped = 0;
  for (const customer of candidates) {
    const existing = await OutreachAutomationEnrollment.findOne({ campaignId: config._id, customerId: customer._id });
    if (existing && ['blocked', 'completed'].includes(existing.status)) {
      skipped += 1;
      continue;
    }
    await ensureEnrollment(config._id, actor, customer, now, new Types.ObjectId(target.id));
    enrolled += 1;
  }

  if (!enrolled) {
    throw ApiError.conflict(
      customerIds?.length
        ? '选中的客户当前都不符合自动开发条件'
        : '没有符合条件的客户：需要已有邮箱、状态为待开发/已联系，且未回复、未退订',
    );
  }
  await OutreachAutomationConfig.updateOne(
    { _id: config._id, version: config.version },
    { $set: { enabled: true, pausedReason: null }, $inc: { version: 1 } },
  );
  const overview = await getOutreachAutomationOverview(actor, target.id);
  return { enrolled, skipped, overview };
}

export async function pauseOutreachAutomation(
  actor: AuthUser,
  targetUserId?: string,
  reason = '已手动暂停',
): Promise<OutreachAutomationOverview> {
  const target = await resolveTargetUser(actor, targetUserId);
  const config = await getConfig(actor, target.id);
  await OutreachAutomationConfig.updateOne(
    { _id: config._id },
    { $set: { enabled: false, pausedReason: reason }, $inc: { version: 1 } },
  );
  await OutreachAutomationEnrollment.updateMany(
    { campaignId: config._id, status: 'active' },
    { $set: { status: 'paused', nextRunAt: new Date() } },
  );
  return getOutreachAutomationOverview(actor, target.id);
}

export async function resumeOutreachAutomation(actor: AuthUser, targetUserId?: string): Promise<OutreachAutomationOverview> {
  const target = await resolveTargetUser(actor, targetUserId);
  await assertMailboxReady(actor, target.id);
  const config = await getConfig(actor, target.id);
  await OutreachAutomationConfig.updateOne(
    { _id: config._id },
    { $set: { enabled: true, pausedReason: null }, $inc: { version: 1 } },
  );
  await OutreachAutomationEnrollment.updateMany(
    { campaignId: config._id, status: 'paused' },
    { $set: { status: 'active', nextRunAt: new Date(), lastError: null } },
  );
  return getOutreachAutomationOverview(actor, target.id);
}

export async function controlOutreachEnrollment(
  actor: AuthUser,
  enrollmentId: string,
  action: 'pause' | 'resume',
  targetUserId?: string,
): Promise<OutreachAutomationOverview> {
  const target = await resolveTargetUser(actor, targetUserId);
  const config = await getConfig(actor, target.id);
  const enrollment = await OutreachAutomationEnrollment.findOne({
    _id: enrollmentId,
    ...scope(actor, target.id),
    campaignId: config._id,
  });
  if (!enrollment) throw ApiError.notFound('自动开发队列项不存在');
  if (action === 'pause') {
    if (enrollment.status === 'active') {
      await OutreachAutomationEnrollment.updateOne(
        { _id: enrollment._id, status: 'active' },
        { $set: { status: 'paused', nextRunAt: new Date() } },
      );
    }
  } else {
    if (!config.enabled) throw ApiError.conflict('自动开发已暂停，请先恢复总开关');
    if (!['paused', 'failed'].includes(enrollment.status)) throw ApiError.conflict('当前队列项不能恢复');
    await OutreachAutomationEnrollment.updateOne(
      { _id: enrollment._id },
      { $set: { status: 'active', nextRunAt: new Date(), lastError: null, attempts: 0 } },
    );
  }
  return getOutreachAutomationOverview(actor, target.id);
}

async function markEnrollment(
  enrollmentId: Types.ObjectId,
  set: Record<string, unknown>,
  inc?: Record<string, number>,
): Promise<void> {
  await OutreachAutomationEnrollment.updateOne(
    { _id: enrollmentId },
    { $set: set, ...(inc ? { $inc: inc } : {}) },
  );
}

async function sentProgress(projectId: Types.ObjectId, customerId: Types.ObjectId): Promise<number> {
  const sent = await DevelopmentLetter.find({
    projectId,
    customerId,
    status: { $in: ['sent', 'opened'] },
  }).select('outreachStep').lean();
  const explicit = sent
    .map((letter) => Number(letter.outreachStep))
    .filter((step) => Number.isInteger(step) && step >= 1 && step <= MAX_AUTO_STEPS);
  return Math.min(MAX_AUTO_STEPS, Math.max(sent.length, ...explicit, 0));
}

async function findDraft(projectId: Types.ObjectId, customerId: Types.ObjectId, step: number) {  return DevelopmentLetter.findOne({
    projectId,
    customerId,
    outreachStep: step,
    status: { $in: ['draft', 'queued', 'scheduled', 'sending', 'retrying', 'sent', 'opened', 'failed', 'cancelled'] },
  }).sort({ createdAt: -1 });
}

async function hasActiveTask(projectId: Types.ObjectId, customerId: Types.ObjectId, step: number) {
  return AgentTask.exists({
    projectId,
    customerId,
    outreachStep: step,
    status: { $in: ['queued', 'running', 'paused', 'waiting_input', 'awaiting_review'] },
  });
}

async function processEnrollment(
  config: InstanceType<typeof OutreachAutomationConfig>,
  enrollment: InstanceType<typeof OutreachAutomationEnrollment>,
  actor: AuthUser,
  now: Date,
): Promise<{ sent: boolean; queued?: boolean }> {
  const customer = await Customer.findOne({
    _id: enrollment.customerId,
    projectId: config.projectId,
    ownerId: config.userId,
  });
  if (!customer) {
    await markEnrollment(enrollment._id, { status: 'blocked', lastError: '客户已删除或归属已变化' });
    return { sent: false };
  }
  const step = Math.max(Number(customer.outreachStep ?? 0), await sentProgress(config.projectId, customer._id));
  if (step >= MAX_AUTO_STEPS) {
    await markEnrollment(enrollment._id, { status: 'completed', currentStep: step, lastError: null });
    return { sent: false };
  }
  if (!AUTO_TARGET_STATUSES.includes(customer.status as (typeof AUTO_TARGET_STATUSES)[number])
    || customer.outreachRepliedAt
    || customer.outreachAbandonedAt) {
    await markEnrollment(enrollment._id, {
      status: 'blocked',
      currentStep: step,
      lastError: customer.outreachRepliedAt ? '客户已回复，自动开发已停止' : '客户已不在可开发状态',
    });
    return { sent: false };
  }
  if (await hasProtectedCustomerMail(String(customer._id), String(config.projectId))) {
    await markEnrollment(enrollment._id, { status: 'blocked', lastError: '检测到退订、退信或拒绝信号，已停止自动开发' });
    return { sent: false };
  }

  await markEnrollment(enrollment._id, { currentStep: step });
  const nextStep = step + 1;
  if (nextStep > 1) {
    const due = customer.nextFollowUpAt ? new Date(customer.nextFollowUpAt) : null;
    if (due && due.getTime() > now.getTime()) {
      await markEnrollment(enrollment._id, { nextRunAt: due, lastError: null });
      return { sent: false };
    }
  }

  const draft = await findDraft(config.projectId, customer._id, nextStep);
  if (!draft) {
    if (await hasActiveTask(config.projectId, customer._id, nextStep)) {
      await markEnrollment(enrollment._id, { nextRunAt: new Date(now.getTime() + 30_000) });
      return { sent: false };
    }
    if (enrollment.queuedStep === nextStep && enrollment.queuedAt
      && now.getTime() - new Date(enrollment.queuedAt).getTime() < 60_000) {
      await markEnrollment(enrollment._id, { nextRunAt: new Date(now.getTime() + 30_000) });
      return { sent: false };
    }
    try {
      const queued = await queueOutreachStep(actor, String(customer._id), nextStep as OutreachStep);
      await markEnrollment(enrollment._id, {
        status: 'active',
        queuedStep: nextStep,
        queuedAt: now,
        nextRunAt: new Date(now.getTime() + 30_000),
        lastError: null,
        ...(queued.taskId ? { taskIds: [...enrollment.taskIds, new Types.ObjectId(queued.taskId)] } : {}),
      });
    } catch (error) {
      const attempts = Number(enrollment.attempts ?? 0) + 1;
      const message = error instanceof Error ? error.message : '第几封草稿生成失败';
      await markEnrollment(
        enrollment._id,
        {
          status: attempts >= 3 ? 'failed' : 'active',
          lastError: message,
          nextRunAt: new Date(now.getTime() + (attempts >= 3 ? DAY_MS : 5 * 60_000)),
        },
        { attempts: 1 },
      );
    }
    return { sent: false, queued: true };
  }

  if (['sent', 'opened'].includes(draft.status)) {
    await markEnrollment(enrollment._id, { currentStep: nextStep, nextRunAt: now });
    return { sent: false };
  }
  if (['queued', 'scheduled', 'sending', 'retrying'].includes(draft.status)) {
    await markEnrollment(enrollment._id, { nextRunAt: new Date(now.getTime() + 60_000) });
    return { sent: false };
  }
  if (draft.status !== 'draft') {
    await markEnrollment(enrollment._id, { status: 'failed', lastError: `第 ${nextStep} 封状态异常：${draft.status}` });
    return { sent: false };
  }
  if (draft.review?.decision === 'rejected') {
    await markEnrollment(enrollment._id, { status: 'paused', lastError: '草稿已被人工标记为不通过，自动发送已暂停' });
    return { sent: false };
  }
  if (draft.needsReview) {
    await markEnrollment(enrollment._id, { status: 'paused', lastError: '草稿需要人工核实，自动发送已暂停' });
    return { sent: false };
  }
  if (!draft.knowledgeReview) {
    await markEnrollment(enrollment._id, { status: 'paused', lastError: '草稿缺少依据审核，自动发送已暂停' });
    return { sent: false };
  }
  if (draft.knowledgeReview.bodyHash && draftHash(draft.contentText) !== draft.knowledgeReview.bodyHash) {
    await markEnrollment(enrollment._id, { status: 'paused', lastError: '草稿内容在生成后发生变化，自动发送已暂停' });
    return { sent: false };
  }
  if (!draft.subject?.trim() || !draft.contentText?.trim() || /\{\{[^}]+\}\}/.test(draft.contentText)) {
    await markEnrollment(enrollment._id, { status: 'failed', lastError: '草稿内容不完整或仍有未替换的占位符' });
    return { sent: false };
  }
  if (await domainAtLimit(config._id, draft.recipientEmail, config.perDomainLimit, now)) {
    await markEnrollment(enrollment._id, { nextRunAt: new Date(now.getTime() + 30 * 60_000) });
    return { sent: false };
  }
  if (!await reserveDay(config.projectId, config._id, config.timezone, config.dailyLimit, now)) {
    await markEnrollment(enrollment._id, { nextRunAt: new Date(now.getTime() + 60 * 60_000) });
    return { sent: false };
  }

  try {
    await approveDraftForAutomation(String(draft._id), actor, String(config._id));
    const result = await resendLetter(
      String(draft._id),
      {
        markAsDeveloped: true,
        requestKey: `auto-${String(config._id)}-${String(enrollment._id)}-step${nextStep}`,
      },
      actor,
      { campaignId: config._id, enrollmentId: enrollment._id },
    );
    if (!result.delivered) throw new Error(result.message || 'SMTP 未接受自动开发信');
    const refreshed = await Customer.findById(customer._id).select('outreachStep nextFollowUpAt').lean();
    const sentStep = Number(refreshed?.outreachStep ?? nextStep);
    await markEnrollment(enrollment._id, {
      status: sentStep >= MAX_AUTO_STEPS ? 'completed' : 'active',
      currentStep: sentStep,
      nextRunAt: refreshed?.nextFollowUpAt ?? new Date(now.getTime() + 3 * DAY_MS),
      lastSentAt: now,
      lastError: null,
      queuedStep: undefined,
      queuedAt: undefined,
    });
    logger.info(`自动开发已发送：customer=${String(customer._id)} step=${sentStep}`);
    return { sent: true };
  } catch (error) {
    await releaseDay(config._id, config.timezone, now);
    const message = error instanceof Error ? error.message : '自动发送失败';
    await markEnrollment(enrollment._id, {
      status: 'paused',
      lastError: message,
      nextRunAt: new Date(now.getTime() + 10 * 60_000),
    });
    logger.warn(`自动开发暂停一个客户：${message}`);
    return { sent: false };
  }
}

let ticking = false;

export async function tickOutreachAutomation(now = new Date()): Promise<void> {
  if (ticking) return;
  ticking = true;
  const syncedProjects = new Set<string>();
  try {
    const configs = await OutreachAutomationConfig.find({ enabled: true }).limit(50);
    for (const config of configs) {
      if (!await campaignPacingReady(config._id, now)) continue;
      let actor: AuthUser;
      try {
        actor = await getActorForConfig(config);
      } catch (error) {
        await OutreachAutomationConfig.updateOne(
          { _id: config._id },
          { $set: { enabled: false, pausedReason: error instanceof Error ? error.message : '账号或项目不可用' }, $inc: { version: 1 } },
        );
        await OutreachAutomationEnrollment.updateMany(
          { campaignId: config._id, status: 'active' },
          { $set: { status: 'paused', nextRunAt: now } },
        );
        continue;
      }

      const mailbox = await getCurrentMailSender(String(config.projectId), String(config.userId));
      if (!mailbox.canSend || mailbox.channel !== 'smtp') {
        await OutreachAutomationConfig.updateOne(
          { _id: config._id },
          {
            $set: {
              enabled: false,
              pausedReason: mailbox.reason || '个人发件邮箱不可用，自动开发已暂停',
            },
            $inc: { version: 1 },
          },
        );
        await OutreachAutomationEnrollment.updateMany(
          { campaignId: config._id, status: 'active' },
          { $set: { status: 'paused', nextRunAt: now } },
        );
        continue;
      }

      if (!isWithinSendWindow(configDto(config), now)) continue;
      const today = await OutreachAutomationDay.findOne({
        campaignId: config._id,
        day: dayIn(config.timezone, now),
      }).select('sent').lean();
      if (Number(today?.sent ?? 0) >= config.dailyLimit) continue;
      if (!syncedProjects.has(String(config.projectId))) {
        syncedProjects.add(String(config.projectId));
        try {
          await syncOutreachFollowUps(config.projectId, now);
        } catch (error) {
          logger.warn(`自动开发同步回复失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await OutreachAutomationConfig.updateOne({ _id: config._id }, { $set: { lastTickAt: now } });
      const rows = await OutreachAutomationEnrollment.find({
        campaignId: config._id,
        status: 'active',
        nextRunAt: { $lte: now },
      }).sort({ nextRunAt: 1 }).limit(20);

      for (const row of rows) {
        const result = await processEnrollment(config, row, actor, now);
        if (result.sent || result.queued) break;
      }
    }
  } catch (error) {
    logger.warn(`自动开发 tick 失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    ticking = false;
  }
}

let timer: NodeJS.Timeout | undefined;

export function startOutreachAutomationWorker(): void {
  if (timer || process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return;
  timer = setInterval(() => {
    void tickOutreachAutomation().catch((error) => {
      logger.warn('自动开发 worker 失败', error instanceof Error ? error.message : String(error));
    });
  }, TICK_MS);
  timer.unref?.();
}

export function stopOutreachAutomationWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
