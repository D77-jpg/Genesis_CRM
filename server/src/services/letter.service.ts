import { createHash, randomUUID } from 'node:crypto';
import { newMessageId, processMailJob } from './mail-queue.service';
import { safeMailHtml } from './mail-security';
import { prepareTrackedHtml, trackingSummary, type TrackingSummary } from './mail-tracking.service';
import { MailMessage } from '../models/MailMessage';
/**
 * 开发信业务逻辑
 * ------------------------------------------------------------------
 * 关键约束（对应产品需求）：
 *   「发送后的开发信必须同步记录到该客户的开发信记录中」
 * V2.1：先渲染并持久化任务 → 原子领取 → SMTP → 记录结果与重试历史。
 * 投递结果未知时保持待核实，禁止自动重发。
 *
 * 说明：MongoDB Community 单机部署不支持多文档事务，
 * 所以发送计数采用原子 $inc + 同文档幂等标识，支持崩溃后重做副作用。
 */
import { Types, type FilterQuery } from 'mongoose';
import {
  Customer,
  DevelopmentLetter,
  Project,
  type CustomerDocument,
  type ICustomer,
  type IDevelopmentLetter,
} from '../models';
import env from '../config/env';
import { createLogger } from '../config/logger';
import type { CustomerStatus } from '../constants';
import { ApiError } from '../utils/ApiError';
import { buildPaginated, parsePagination, sortableFields, type Paginated } from '../utils/pagination';
import {
  buildPlaceholderValues,
  escapeRegExp,
  htmlToPlainText,
  renderTemplate,
  type PlaceholderValues,
} from '../utils/text';
import { getCustomerByIdOrThrow } from './customer.service';
import { getActiveChannel, getProjectActiveChannel } from './mailer.service';
import { getProjectMailConfig } from './project-mail-config.service';
import { assertCustomerAccess, customerRefScope, projectScope, requireProjectId } from '../utils/access';
import type { AuthUser } from '../types/express';
import type {
  ListLettersQuery,
  ResendLetterInput,
  SendLetterInput,
} from '../validators/letter.validator';

const logger = createLogger('letter-service');

/** 开发信列表/详情中附带的客户摘要 */
export interface LetterCustomerSummary {
  id: string;
  name: string;
  company?: string;
  email?: string;
  status: CustomerStatus;
}

/** 对外输出的开发信 DTO（id 为字符串，customerId 已扁平化） */
export interface LetterDto {
  id: string;
  customerId: string;
  customer?: LetterCustomerSummary;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  content: string;
  contentText: string;
  template: string;
  status: IDevelopmentLetter['status'];
  channel: IDevelopmentLetter['channel'];
  sentAt?: Date;
  messageId?: string;
  scheduledAt?: Date;
  threadId?: string;
  needsReview?: boolean;
  error?: string;
  sentBy?: string;
  createdAt: Date;
  updatedAt: Date;
  tracking?: TrackingSummary;
}

/* ------------------------------------------------------------------ */
/* 占位符渲染                                                          */
/* ------------------------------------------------------------------ */

/** 由客户 + 环境变量构造完整的占位符取值表 */
async function buildValues(customer: Partial<ICustomer>): Promise<PlaceholderValues> {
  const project = customer.projectId ? await Project.findById(customer.projectId).lean() : null;
  return {
    ...buildPlaceholderValues(customer),
    companyName: project?.companyName || env.COMPANY_NAME,
    companyWebsite: project?.website || env.COMPANY_WEBSITE,
    moq: project?.moq || env.COMPANY_MOQ,
    senderName: project?.senderName || env.SENDER_NAME,
  };
}

export interface RenderedLetter {
  subject: string;
  html: string;
  text: string;
  recipientEmail: string;
  recipientName: string;
}

/**
 * 渲染开发信（不发送、不落库），供「预览」接口与发送流程共用。
 */
export async function renderLetter(
  customer: Partial<ICustomer>,
  subject: string,
  content: string,
  recipientEmailOverride?: string,
): Promise<RenderedLetter> {
  const values = await buildValues(customer);
  const recipientEmail = (recipientEmailOverride || customer.email || '').trim().toLowerCase();

  if (!recipientEmail) {
    throw ApiError.badRequest('该客户还没有填写邮箱，请先补充邮箱或在发送框中手动指定收件人', [
      { field: 'recipientEmail', message: '收件人邮箱不能为空' },
    ]);
  }

  return {
    // 主题走纯文本渲染（不转义），正文走 HTML 渲染（转义，防存储型 XSS）
    subject: renderTemplate(subject, values, { escape: false }),
    html: safeMailHtml(renderTemplate(content, values, { escape: true })),
    text: htmlToPlainText(renderTemplate(content, values, { escape: false })),
    recipientEmail,
    recipientName: customer.name ?? '',
  };
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

function buildLetterFilter(query: ListLettersQuery): FilterQuery<IDevelopmentLetter> {
  const filter: Record<string, unknown> = {};

  if (query.customerId) filter.customerId = new Types.ObjectId(query.customerId);
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.channel && query.channel !== 'all') filter.channel = query.channel;
  if (query.search) {
    const regex = new RegExp(escapeRegExp(query.search.trim()), 'i');
    filter.$or = [{ subject: regex }, { recipientName: regex }, { recipientEmail: regex }];
  }
  if (query.sentFrom || query.sentTo) {
    filter.sentAt = {
      ...(query.sentFrom ? { $gte: query.sentFrom } : {}),
      ...(query.sentTo ? { $lte: query.sentTo } : {}),
    };
  }

  return filter as FilterQuery<IDevelopmentLetter>;
}

/** 判断 customerId 是「已 populate 的对象」还是「裸 ObjectId」 */
interface PopulatedCustomer {
  _id: Types.ObjectId | string;
  name: string;
  company?: string;
  email?: string;
  status: CustomerStatus;
}

function asPopulatedCustomer(value: unknown): PopulatedCustomer | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!('_id' in record) || !('name' in record)) return null;
  return value as PopulatedCustomer;
}

function toCustomerSummary(value: unknown): LetterCustomerSummary | undefined {
  const populated = asPopulatedCustomer(value);
  if (!populated) return undefined;
  return {
    id: String(populated._id),
    name: populated.name,
    company: populated.company,
    email: populated.email,
    status: populated.status,
  };
}

/**
 * 把 Mongo 文档（lean 或 hydrated 均可）转换成对外 DTO。
 * customerId 可能是 ObjectId，也可能是 populate 后的对象，两种都要兼容。
 */
function toLetterDto(doc: Record<string, unknown>): LetterDto {
  const rawCustomerId = doc.customerId;
  const summary = toCustomerSummary(rawCustomerId);
  const customerId = summary?.id ?? String(rawCustomerId ?? '');
  const tracking = trackingSummary(doc.tracking);

  return {
    id: String((doc._id ?? doc.id ?? '').toString()),
    customerId,
    ...(summary ? { customer: summary } : {}),
    recipientName: String(doc.recipientName ?? ''),
    recipientEmail: String(doc.recipientEmail ?? ''),
    subject: String(doc.subject ?? ''),
    content: String(doc.content ?? ''),
    contentText: String(doc.contentText ?? ''),
    template: String(doc.template ?? ''),
    scheduledAt: doc.scheduledAt as Date | undefined,
    threadId: doc.threadId as string | undefined,
    needsReview: Boolean(doc.needsReview),
    status: doc.status as IDevelopmentLetter['status'],
    channel: doc.channel as IDevelopmentLetter['channel'],
    ...(doc.sentAt ? { sentAt: doc.sentAt as Date } : {}),
    ...(doc.messageId ? { messageId: String(doc.messageId) } : {}),
    ...(doc.error ? { error: String(doc.error) } : {}),
    ...(doc.sentBy ? { sentBy: String(doc.sentBy) } : {}),
    ...(tracking ? { tracking } : {}),
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

export async function listLetters(query: ListLettersQuery, actor?: AuthUser): Promise<Paginated<LetterDto>> {
  if (query.customerId) await getCustomerByIdOrThrow(query.customerId, actor);
  const { page, limit, skip, sortBy, sortOrder } = parsePagination(
    query as unknown as Record<string, unknown>,
    { allowedSortFields: sortableFields.letter, defaultSortBy: 'sentAt' },
  );

  const filter = { $and: [buildLetterFilter(query), await customerRefScope(actor)] } as FilterQuery<IDevelopmentLetter>;
  const sortSpec: Record<string, 1 | -1> = {};
  sortSpec[sortBy] = sortOrder;
  sortSpec._id = -1;

  // sentAt 可能为 null（草稿），补一层 createdAt 兜底排序
  const fallbackSort: Record<string, 1 | -1> = { ...sortSpec, createdAt: -1 };

  const [rawItems, total] = await Promise.all([
    DevelopmentLetter.find(filter)
      .sort(fallbackSort)
      .skip(skip)
      .limit(limit)
      .populate('customerId', 'name company email status')
      .lean(),
    DevelopmentLetter.countDocuments(filter),
  ]);

  const items = rawItems as unknown as Record<string, unknown>[];
  const dtos = items.map((item) => toLetterDto(item));

  return buildPaginated(dtos, total, page, limit);
}

export async function getLetter(id: string, actor?: AuthUser): Promise<LetterDto> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('开发信 ID 格式不正确');
  const doc = await DevelopmentLetter.findOne({ _id: id, ...projectScope(actor) }).populate('customerId', 'name company email status ownerId projectId');
  if (!doc) throw ApiError.notFound(`开发信不存在或已被删除（id=${id}）`);

  // 业务员只能查看自己名下客户的开发信（客户已删时 populated 为 null，同样拒绝）
  const customer = doc.customerId as unknown as { ownerId?: unknown } | null;
  assertCustomerAccess(actor, customer?.ownerId, doc.projectId);

  return toLetterDto(doc.toObject({ virtuals: false, depopulate: false }) as unknown as Record<string, unknown>);
}

/* ------------------------------------------------------------------ */
/* 发送 / 重发                                                         */
/* ------------------------------------------------------------------ */

export interface SendLetterResult {
  letter: LetterDto;
  customer: ICustomer & { id: string };
  /** mock / smtp */
  channel: ReturnType<typeof getActiveChannel>;
  /** 是否真的发送成功（草稿为 false，失败为 false） */
  delivered: boolean;
  message: string;
}

async function persistAndSend(options: {
  customer: CustomerDocument;
  subjectTemplate: string;
  contentTemplate: string;
  recipientEmailOverride?: string;
  markAsDeveloped: boolean;
  saveAsDraft: boolean;
  userId?: string;
  scheduledAt?: Date;
  requestKey?: string;
  replyToId?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}): Promise<SendLetterResult> {
  const {
    customer,
    subjectTemplate,
    contentTemplate,
    recipientEmailOverride,
    markAsDeveloped,
    saveAsDraft,
    userId,
  } = options;

  const rendered = await renderLetter(customer, subjectTemplate, contentTemplate, recipientEmailOverride);
  const mailConfig = await getProjectMailConfig(String(customer.projectId));
  const activeChannel = mailConfig.transport;

  // 回复草稿也必须先解析父邮件，确保收件人、主题和线程引用与正式回复一致。
  let threadId: string = options.threadId || randomUUID();
  let inReplyTo = options.inReplyTo;
  let references: string[] = options.references || [];
  if (options.replyToId) {
    const parent = await MailMessage.findOne({ _id: options.replyToId, customerId: customer._id, projectId: customer.projectId });
    if (!parent) throw ApiError.notFound('邮件不存在或无权访问');
    threadId = parent.threadId;
    inReplyTo = parent.messageId || undefined;
    references = [...parent.references, ...(inReplyTo ? [inReplyTo] : [])].slice(-50);
    rendered.recipientEmail = parent.from;
    const replySubject = saveAsDraft ? rendered.subject : parent.subject;
    rendered.subject = /^re:/i.test(replySubject) ? replySubject : 'Re: ' + replySubject;
  }

  // 1) 草稿：直接落库，不发送、不改客户状态
  if (saveAsDraft) {
    const payload = {
      projectId: customer.projectId,
      customerId: customer._id,
      recipientName: rendered.recipientName,
      recipientEmail: rendered.recipientEmail,
      subject: rendered.subject,
      senderAddress: mailConfig.mailFrom,
      content: rendered.html,
      contentText: rendered.text,
      template: contentTemplate,
      status: 'draft',
      channel: activeChannel,
      threadId,
      inReplyTo,
      references,
      sentBy: userId ? new Types.ObjectId(userId) : undefined,
      ...(options.requestKey ? { requestKey: options.requestKey } : {}),
    };
    let draft;
    if (options.requestKey) {
      try {
        draft = await DevelopmentLetter.findOneAndUpdate(
          { projectId: customer.projectId, requestKey: options.requestKey },
          { $setOnInsert: payload },
          { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        draft = await DevelopmentLetter.findOne({ projectId: customer.projectId, requestKey: options.requestKey });
      }
      if (!draft) throw ApiError.internal('开发信草稿保存失败');
      if (String(draft.customerId) !== String(customer._id)
        || draft.subject !== rendered.subject
        || draft.contentText !== rendered.text
        || draft.status !== 'draft') {
        throw ApiError.conflict('同一请求标识不能用于不同的开发信草稿');
      }
    } else {
      draft = await DevelopmentLetter.create(payload);
    }
    logger.info(`已保存开发信草稿 -> ${rendered.recipientEmail}`);
    return {
      letter: toLetterDto(draft.toObject({ virtuals: false }) as unknown as Record<string, unknown>),
      customer: customer.toJSON() as unknown as ICustomer & { id: string },
      channel: activeChannel,
      delivered: false,
      message: '草稿已保存，未发送',
    };
  }

  const requestKey = createHash('sha256').update(JSON.stringify([userId, options.requestKey || [customer.id, rendered, options.scheduledAt, Math.floor(Date.now() / 60000)]])).digest('hex');
  if (options.scheduledAt && options.scheduledAt.getTime() <= Date.now() && !await DevelopmentLetter.exists({ requestKey, projectId: customer.projectId })) throw ApiError.badRequest('定时时间必须晚于当前时间');
  const due = options.scheduledAt ?? new Date();
  let prepared: ReturnType<typeof prepareTrackedHtml> = { deliveryHtml: rendered.html };
  try {
    prepared = prepareTrackedHtml(rendered.html);
  } catch {
    // Tracking is optional telemetry. A malformed configuration or unexpected
    // HTML must never prevent the durable send task from being created.
    logger.warn('邮件追踪准备失败，已降级为正常发送');
  }
  let letter;
  try {
    letter = await DevelopmentLetter.findOneAndUpdate({ requestKey, projectId: customer.projectId }, { $setOnInsert: {
      projectId: customer.projectId, customerId: customer._id, recipientName: rendered.recipientName,
      recipientEmail: rendered.recipientEmail, subject: rendered.subject,
      senderAddress: mailConfig.mailFrom,
      content: rendered.html, deliveryContent: prepared.deliveryHtml,
      contentText: rendered.text, template: contentTemplate,
      status: options.scheduledAt ? 'scheduled' : 'queued', channel: activeChannel,
      messageId: newMessageId(), threadId, inReplyTo, references,
      scheduledAt: options.scheduledAt, nextAttemptAt: due, markAsDeveloped,
      sentBy: userId ? new Types.ObjectId(userId) : undefined,
      ...(prepared.tracking ? { tracking: prepared.tracking } : {}),
      history: [{ at: new Date(), status: options.scheduledAt ? 'scheduled' : 'queued' }],
    } }, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    letter = await DevelopmentLetter.findOne({ requestKey, projectId: customer.projectId });
  }
  if (!letter) throw ApiError.internal('发送任务保存失败');
  if (String(letter.customerId) !== String(customer._id)) throw ApiError.conflict('请求标识已用于其他客户');
  if (letter.subject !== rendered.subject || letter.content !== rendered.html || letter.recipientEmail !== rendered.recipientEmail) throw ApiError.conflict('同一请求标识不能用于不同邮件内容，请重新打开编辑器');
  if (letter.scheduledAt?.getTime() !== options.scheduledAt?.getTime()) throw ApiError.conflict('同一请求标识不能修改定时时间，请取消原任务后重新创建');
  // Immediate requests use the SAME durable worker path; background polling also
  // picks the task up if this HTTP request disconnects or the process restarts.
  if (!options.scheduledAt) await processMailJob(String(letter._id));
  letter = (await DevelopmentLetter.findOne({ _id: letter._id, projectId: customer.projectId }))!;
  const refreshed = await Customer.findOne({ _id: customer._id, projectId: customer.projectId });
  return {
    letter: toLetterDto(letter.toObject() as unknown as Record<string, unknown>),
    customer: (refreshed ?? customer).toJSON() as unknown as ICustomer & { id: string },
    channel: letter.channel, delivered: ['sent', 'opened'].includes(letter.status),
    message: ['sent', 'opened'].includes(letter.status) ? (letter.channel === 'mock' ? '开发信已发送（MOCK 模式，未真实投递）' : '开发信已发送')
      : letter.status === 'failed' ? (letter.error || '发送失败') : '发送任务已保存，可在邮件中心查看进度',
  };

}

/** 发送新开发信 */
export async function sendLetter(input: SendLetterInput, actor?: AuthUser): Promise<SendLetterResult> {
  if (!input.customerId) {
    throw ApiError.badRequest('缺少 customerId，无法确定收件客户');
  }
  // getCustomerByIdOrThrow 内部做归属校验：业务员不能给别人的客户发信
  const customer = await getCustomerByIdOrThrow(input.customerId, actor);

  return persistAndSend({
    customer,
    subjectTemplate: input.subject,
    contentTemplate: input.content,
    recipientEmailOverride: input.recipientEmail,
    markAsDeveloped: input.markAsDeveloped,
    saveAsDraft: input.saveAsDraft,
    replyToId: input.replyToId,
    userId: actor?.id,
    scheduledAt: input.scheduledAt,
    requestKey: input.requestKey,
  });
}

/**
 * 重新发送一封已有的开发信。
 * 默认沿用原始模板（template）与主题；也允许传入新的主题 / 正文覆盖。
 * 会生成一条「新记录」，原记录保留，形成完整的历史轨迹。
 */
export async function resendLetter(
  letterId: string,
  input: ResendLetterInput,
  actor?: AuthUser,
): Promise<SendLetterResult> {
  if (!Types.ObjectId.isValid(letterId)) throw ApiError.badRequest('开发信 ID 格式不正确');

  const original = await DevelopmentLetter.findOne({ _id: letterId, ...projectScope(actor) });
  if (!original) throw ApiError.notFound(`开发信不存在或已被删除（id=${letterId}）`);

  // 归属校验：业务员只能重发自己名下客户的开发信
  const customer = await getCustomerByIdOrThrow(String(original.customerId), actor);
  if (['queued', 'scheduled', 'sending', 'retrying'].includes(original.status) || original.needsReview) throw ApiError.conflict('任务进行中或投递结果待核实，不能重发');

  // 优先用原始模板（含占位符），没有模板时退化为已渲染的正文
  const contentTemplate = input.content ?? original.template ?? original.content;
  const subjectTemplate = input.subject ?? original.subject;

  return persistAndSend({
    customer,
    subjectTemplate,
    contentTemplate,
    recipientEmailOverride: input.recipientEmail ?? original.recipientEmail,
    markAsDeveloped: input.markAsDeveloped,
    saveAsDraft: false,
    userId: actor?.id,
    scheduledAt: input.scheduledAt,
    requestKey: input.requestKey || `resend_${original.id}_${createHash('sha256').update(JSON.stringify([input, Math.floor(Date.now() / 60000)])).digest('hex')}`,
    threadId: original.threadId,
    inReplyTo: original.inReplyTo,
    references: original.references,
  });
}

/* ------------------------------------------------------------------ */
/* 删除                                                                */
/* ------------------------------------------------------------------ */

/** 删除单封开发信，并同步回退客户计数器 */
export async function deleteLetter(id: string, actor?: AuthUser): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('开发信 ID 格式不正确');

  const letter = await DevelopmentLetter.findOne({ _id: id, ...projectScope(actor) }).populate('customerId', 'ownerId projectId');
  if (!letter) throw ApiError.notFound(`开发信不存在或已被删除（id=${id}）`);

  // populate 后 customerId 为对象，先取出裸 id 供计数器回退使用
  const populated = letter.customerId as unknown as { _id?: Types.ObjectId; ownerId?: unknown } | null;
  const customerIdStr = String(populated?._id ?? letter.customerId);
  // 业务员只能删除自己名下客户的开发信
  assertCustomerAccess(actor, populated?.ownerId, letter.projectId);

  if (['queued', 'scheduled', 'sending', 'retrying'].includes(letter.status) || letter.needsReview) throw ApiError.conflict('请先取消任务；发送中或待核实记录不能删除');
  await DevelopmentLetter.deleteOne({ _id: letter._id, ...projectScope(actor), status: { $nin: ['queued', 'scheduled', 'sending', 'retrying'] }, needsReview: { $ne: true } });

  if (['sent', 'opened'].includes(letter.status)) {
    // 带 letterCount > 0 条件的原子 $inc，既保证并发安全又不会出现负数
    await decrementLetterCount(customerIdStr, 1, requireProjectId(actor));
  }

  logger.info(`删除开发信: ${id}`);
  return { id };
}

/** 原子回退客户的开发信计数 */
async function decrementLetterCount(customerId: string, count: number, projectId?: Types.ObjectId): Promise<void> {
  try {
    await Customer.updateOne(
      { _id: new Types.ObjectId(customerId), ...(projectId ? { projectId } : {}), letterCount: { $gte: count } },
      { $inc: { letterCount: -count } },
    );
  } catch (error) {
    // 计数器只是展示用，回退失败不应该阻断删除主流程
    logger.warn(
      `回退客户 ${customerId} 的 letterCount 失败`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** 批量删除开发信 */
export async function bulkDeleteLetters(ids: string[], actor?: AuthUser): Promise<{ deleted: number }> {
  const objectIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (objectIds.length === 0) throw ApiError.badRequest('没有合法的开发信 ID');

  // 严格分配制：只在业务员可见范围内取出待删记录（也用于按客户分组回退计数器）
  const refScope = await customerRefScope(actor);
  Object.assign(refScope, { status: { $nin: ['queued', 'scheduled', 'sending', 'retrying'] }, needsReview: { $ne: true } });
  const targets = await DevelopmentLetter.find({ _id: { $in: objectIds }, ...refScope })
    .select({ _id: 1, customerId: 1, status: 1 })
    .lean();

  const targetList = targets as unknown as { _id: Types.ObjectId; customerId: Types.ObjectId; status: string }[];
  if (targetList.length === 0) return { deleted: 0 };

  const deletableIds = targetList.map((t) => t._id);
  const { deletedCount } = await DevelopmentLetter.deleteMany({ _id: { $in: deletableIds }, ...projectScope(actor) });

  const counter = new Map<string, number>();
  targetList.forEach((t) => {
    if (!['sent', 'opened'].includes(t.status)) return;
    const key = String(t.customerId);
    counter.set(key, (counter.get(key) ?? 0) + 1);
  });

  for (const [customerId, count] of counter) {
    await decrementLetterCount(customerId, count, requireProjectId(actor));
  }

  return { deleted: deletedCount ?? 0 };
}

/* ------------------------------------------------------------------ */
/* 预览 / 统计                                                         */
/* ------------------------------------------------------------------ */

/** 发送前预览：返回占位符替换后的最终内容 */
export async function previewLetter(
  customerId: string,
  subject: string,
  content: string,
  recipientEmail?: string,
  actor?: AuthUser,
): Promise<RenderedLetter> {
  const customer = await getCustomerByIdOrThrow(customerId, actor);
  return renderLetter(customer, subject, content, recipientEmail);
}

export interface LetterStats {
  total: number;
  sent: number;
  draft: number;
  failed: number;
  sent7d: number;
  sent30d: number;
  channel: ReturnType<typeof getActiveChannel>;
  byDay: { _id: string; count: number }[];
}

/** 开发信维度的统计，供仪表盘使用 */
export async function getLetterStats(actor?: AuthUser): Promise<LetterStats> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 3600 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000);
  // 严格分配制：业务员的开发信统计只覆盖自己名下客户
  const refScope = await customerRefScope(actor);

  const [total, sent, draft, failed, sent7d, sent30d, byDayRaw] = await Promise.all([
    DevelopmentLetter.countDocuments({ ...refScope }),
    DevelopmentLetter.countDocuments({ ...refScope, status: { $in: ['sent', 'opened'] } }),
    DevelopmentLetter.countDocuments({ ...refScope, status: 'draft' }),
    DevelopmentLetter.countDocuments({ ...refScope, status: 'failed' }),
    DevelopmentLetter.countDocuments({ ...refScope, status: { $in: ['sent', 'opened'] }, sentAt: { $gte: sevenDaysAgo } }),
    DevelopmentLetter.countDocuments({ ...refScope, status: { $in: ['sent', 'opened'] }, sentAt: { $gte: thirtyDaysAgo } }),
    DevelopmentLetter.aggregate<{ _id: string; count: number }>([
      { $match: { ...refScope, status: { $in: ['sent', 'opened'] }, sentAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const channel = await getProjectActiveChannel(actor?.projectId);

  return {
    total,
    sent,
    draft,
    failed,
    sent7d,
    sent30d,
    channel,
    byDay: byDayRaw,
  };
}
