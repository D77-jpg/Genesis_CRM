/**
 * 开发信三段式跟进
 * ------------------------------------------------------------------
 * 第 1 封开发信发出后，系统按节奏自动排下一次跟进：
 *   - 第 1 封后 3 天没回复 → 提醒发第 2 封
 *   - 第 2 封后 7 天没回复 → 提醒发第 3 封
 *   - 第 3 封后 14 天仍无回复 → 判定弃用（状态已流失 + 标签「三次无回复」）
 *
 * 判定「有回复」的口径：客户名下有任何一封入站邮件，时间晚于最近一封开发信。
 * 一旦有回复，跟进停表（nextFollowUpAt 清空），不再提醒。
 *
 * 到期提醒本身不需要落库：列表按 nextFollowUpAt 实时算，
 * 同时复用客户主档的「下次跟进」，今日开发 / 客户管理的跟进视图自动联动。
 */
import mongoose from 'mongoose';
import { OUTREACH_ABANDON_TAG, OUTREACH_FOLLOWUP_DAYS, OUTREACH_MAX_STEPS } from '../constants';
import { Customer, CustomerEvent, DevelopmentLetter } from '../models';
import { MailMessage } from '../models/MailMessage';
import { customerScope } from '../utils/access';
import { createLogger } from '../config/logger';
import type { AuthUser } from '../types/express';

const logger = createLogger('outreach-followup');
const DAY = 86_400_000;
/** 后台扫描间隔：10 分钟（弃用判定不要求秒级） */
const SCAN_INTERVAL_MS = 10 * 60 * 1000;

export function outreachIntervalDays(step: number): number {
  const index = Math.min(Math.max(Math.trunc(step) || 1, 1), OUTREACH_MAX_STEPS) - 1;
  return OUTREACH_FOLLOWUP_DAYS[index];
}

/** 下一封该发的日期 */
export function outreachDueAt(sentAt: Date, step: number): Date {
  return new Date(sentAt.getTime() + outreachIntervalDays(step) * DAY);
}

/**
 * 开发信真正投出去之后调用：记录第几封，并把「下次跟进」排到节奏上。
 * 已经弃用的客户重新发信时，按新一轮开发处理。
 */
export async function scheduleOutreachFollowUp(letter: {
  projectId: unknown;
  customerId: unknown;
  outreachStep?: number;
  sentAt?: Date | null;
  createdAt?: Date;
}): Promise<void> {
  if (!letter.outreachStep) return;
  const sentAt = letter.sentAt ?? letter.createdAt ?? new Date();
  const customer = await Customer.findOne({ _id: letter.customerId, projectId: letter.projectId })
    .select('outreachAbandonedAt status tags').lean();
  if (!customer) return;

  const restarted = Boolean(customer.outreachAbandonedAt) || letter.outreachStep === 1;
  const step = customer.outreachAbandonedAt ? 1 : letter.outreachStep;
  const patch: Record<string, unknown> = {
    outreachStep: step,
    outreachLastAt: sentAt,
    outreachRepliedAt: null,
    nextFollowUpAt: outreachDueAt(sentAt, step),
  };
  if (restarted) patch.outreachStartedAt = sentAt;
  if (customer.outreachAbandonedAt) {
    patch.outreachAbandonedAt = null;
    patch.tags = (customer.tags ?? []).filter((tag) => tag !== OUTREACH_ABANDON_TAG);
    if (customer.status === 'lost') patch.status = 'contacted';
  }
  await Customer.updateOne({ _id: letter.customerId, projectId: letter.projectId }, { $set: patch });
}

export interface OutreachSyncResult {
  replied: number;
  abandoned: number;
}

/**
 * 扫一遍推进中的客户：有回复就停表；第三封到期仍无回复就弃用。
 * 幂等，可以随时重复调用（列表接口每次都会先跑一遍）。
 */
export async function syncOutreachFollowUps(
  projectId: string | mongoose.Types.ObjectId,
  now: Date = new Date(),
): Promise<OutreachSyncResult> {
  const customers = await Customer.find({
    projectId,
    outreachStep: { $gte: 1 },
    outreachAbandonedAt: null,
    status: { $nin: ['won', 'lost'] },
    outreachLastAt: { $ne: null },
  })
    .select('_id status outreachStep outreachLastAt nextFollowUpAt')
    .lean();

  const result: OutreachSyncResult = { replied: 0, abandoned: 0 };
  for (const customer of customers) {
    const replied = await MailMessage.exists({
      projectId,
      customerId: customer._id,
      deleted: { $ne: true },
      sentAt: { $gt: customer.outreachLastAt },
    });
    if (replied) {
      const patch: Record<string, unknown> = { nextFollowUpAt: null, outreachRepliedAt: now };
      const bumpStatus = customer.status === 'pending' || customer.status === 'contacted';
      if (bumpStatus) patch.status = 'replied';
      await Customer.updateOne({ _id: customer._id, projectId }, { $set: patch });
      if (bumpStatus) {
        await CustomerEvent.create({
          projectId,
          customerId: customer._id,
          type: 'status_changed',
          at: now,
          fromStatus: customer.status,
          toStatus: 'replied',
        });
      }
      result.replied += 1;
      continue;
    }

    const step = Number(customer.outreachStep ?? 0);
    const due = customer.nextFollowUpAt ? new Date(customer.nextFollowUpAt) : null;
    if (step >= OUTREACH_MAX_STEPS && due && due.getTime() <= now.getTime()) {
      await Customer.updateOne(
        { _id: customer._id, projectId },
        { $set: { status: 'lost', nextFollowUpAt: null, outreachAbandonedAt: now }, $addToSet: { tags: OUTREACH_ABANDON_TAG } },
      );
      await CustomerEvent.create({
        projectId,
        customerId: customer._id,
        type: 'status_changed',
        at: now,
        fromStatus: customer.status,
        toStatus: 'lost',
      });
      result.abandoned += 1;
    }
  }
  if (result.replied || result.abandoned) {
    logger.info(`开发信跟进同步：回复 ${result.replied} 家，弃用 ${result.abandoned} 家`);
  }
  return result;
}

export interface OutreachFollowUpItem {
  customerId: string;
  name: string;
  company?: string;
  email?: string;
  ownerId?: string;
  status: string;
  /** 已发到第几封 */
  step: number;
  /** 这封该发的是第几封 */
  nextStep: number;
  /** 最近一封开发信的主题与时间，方便写跟进时接着上文 */
  lastSubject?: string;
  lastSentAt?: Date;
  /** 到这一封之后仍无回复就弃用 */
  abandonAfter: number;
  dueAt: Date;
  /** 逾期天数：0 = 今天到期，>0 = 已经逾期几天 */
  overdueDays: number;
}

export interface OutreachFollowUpList {
  items: OutreachFollowUpItem[];
  totals: { due: number; overdue: number; today: number; second: number; third: number; lastChance: number };
  config: { days: number[]; maxSteps: number; abandonTag: string };
}

function endOfDay(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** 「跟进提醒」列表：到期（含今天到期）且还没回复的开发客户 */
export async function listOutreachFollowUps(
  projectId: string | mongoose.Types.ObjectId,
  actor: AuthUser,
  now: Date = new Date(),
): Promise<OutreachFollowUpList> {
  await syncOutreachFollowUps(projectId, now);

  const rows = await Customer.find({
    projectId,
    outreachStep: { $gte: 1 },
    outreachAbandonedAt: null,
    status: { $nin: ['won', 'lost'] },
    nextFollowUpAt: { $ne: null, $lte: endOfDay(now) },
    ...customerScope(actor),
  })
    .select('name company email ownerId status outreachStep nextFollowUpAt')
    .sort({ nextFollowUpAt: 1 })
    .limit(200)
    .lean();

  const ids = rows.map((row) => row._id);
  const letters = ids.length
    ? await DevelopmentLetter.find({ projectId, customerId: { $in: ids }, outreachStep: { $gte: 1 }, status: { $in: ['sent', 'opened'] } })
        .select('customerId subject sentAt outreachStep')
        .sort({ sentAt: -1 })
        .lean()
    : [];
  const latest = new Map<string, { subject?: string; sentAt?: Date }>();
  for (const letter of letters) {
    const key = String(letter.customerId);
    if (!latest.has(key)) latest.set(key, { subject: letter.subject, sentAt: letter.sentAt ?? undefined });
  }

  const items: OutreachFollowUpItem[] = rows.map((row) => {
    const step = Number(row.outreachStep ?? 1);
    const dueAt = new Date(row.nextFollowUpAt as unknown as Date);
    const last = latest.get(String(row._id));
    return {
      customerId: String(row._id),
      name: row.name,
      company: row.company || undefined,
      email: row.email || undefined,
      ownerId: row.ownerId ? String(row.ownerId) : undefined,
      status: row.status,
      step,
      nextStep: Math.min(step + 1, OUTREACH_MAX_STEPS),
      lastSubject: last?.subject,
      lastSentAt: last?.sentAt,
      abandonAfter: step >= OUTREACH_MAX_STEPS ? OUTREACH_FOLLOWUP_DAYS[OUTREACH_MAX_STEPS - 1] : OUTREACH_FOLLOWUP_DAYS[step - 1],
      dueAt,
      overdueDays: Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / DAY)),
    };
  });

  return {
    items,
    totals: {
      due: items.length,
      overdue: items.filter((item) => item.overdueDays > 0).length,
      today: items.filter((item) => item.overdueDays === 0).length,
      second: items.filter((item) => item.nextStep === 2).length,
      third: items.filter((item) => item.nextStep === 3).length,
      lastChance: items.filter((item) => item.step >= OUTREACH_MAX_STEPS).length,
    },
    config: { days: [...OUTREACH_FOLLOWUP_DAYS], maxSteps: OUTREACH_MAX_STEPS, abandonTag: OUTREACH_ABANDON_TAG },
  };
}

let timer: NodeJS.Timeout | null = null;

/** 后台定时扫描：没人打开页面时也要把该弃用的客户判掉 */
export function startOutreachFollowUpWorker(): void {
  if (timer) return;
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return;
  const run = async (): Promise<void> => {
    if (mongoose.connection.readyState !== 1) return;
    const projects = await Customer.distinct('projectId', { outreachStep: { $gte: 1 }, outreachAbandonedAt: null });
    for (const projectId of projects) {
      await syncOutreachFollowUps(String(projectId));
    }
  };
  timer = setInterval(() => {
    void run().catch((error) => logger.warn('开发信跟进扫描失败：', error instanceof Error ? error.message : String(error)));
  }, SCAN_INTERVAL_MS);
  timer.unref?.();
}
