/**
 * 开发信业务逻辑
 * ------------------------------------------------------------------
 * 关键约束（对应产品需求）：
 *   「发送后的开发信必须同步记录到该客户的开发信记录中」
 * 因此这里的顺序是：先渲染 → 再发送 → 无论成功失败都落库一条记录，
 * 失败时记录 status=failed + error，保证历史可追溯、可重发。
 *
 * 说明：MongoDB Community 单机部署不支持多文档事务，
 * 所以计数器维护采用原子 $inc，并在异常分支做补偿，避免脏数据。
 */
import { Types, type FilterQuery } from 'mongoose';
import {
  Customer,
  DevelopmentLetter,
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
import { getActiveChannel, sendMail } from './mailer.service';
import { assertCustomerAccess, customerRefScope } from '../utils/access';
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
  error?: string;
  sentBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/* ------------------------------------------------------------------ */
/* 占位符渲染                                                          */
/* ------------------------------------------------------------------ */

/** 由客户 + 环境变量构造完整的占位符取值表 */
function buildValues(customer: Partial<ICustomer>): PlaceholderValues {
  return {
    ...buildPlaceholderValues(customer),
    companyName: env.COMPANY_NAME,
    companyWebsite: env.COMPANY_WEBSITE,
    moq: env.COMPANY_MOQ,
    senderName: env.SENDER_NAME,
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
  const values = buildValues(customer);
  const recipientEmail = (recipientEmailOverride || customer.email || '').trim().toLowerCase();

  if (!recipientEmail) {
    throw ApiError.badRequest('该客户还没有填写邮箱，请先补充邮箱或在发送框中手动指定收件人', [
      { field: 'recipientEmail', message: '收件人邮箱不能为空' },
    ]);
  }

  return {
    // 主题走纯文本渲染（不转义），正文走 HTML 渲染（转义，防存储型 XSS）
    subject: renderTemplate(subject, values, { escape: false }),
    html: renderTemplate(content, values, { escape: true }),
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
    status: doc.status as IDevelopmentLetter['status'],
    channel: doc.channel as IDevelopmentLetter['channel'],
    ...(doc.sentAt ? { sentAt: doc.sentAt as Date } : {}),
    ...(doc.messageId ? { messageId: String(doc.messageId) } : {}),
    ...(doc.error ? { error: String(doc.error) } : {}),
    ...(doc.sentBy ? { sentBy: String(doc.sentBy) } : {}),
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

export async function listLetters(query: ListLettersQuery, actor?: AuthUser): Promise<Paginated<LetterDto>> {
  const { page, limit, skip, sortBy, sortOrder } = parsePagination(
    query as unknown as Record<string, unknown>,
    { allowedSortFields: sortableFields.letter, defaultSortBy: 'sentAt' },
  );

  const filter: FilterQuery<IDevelopmentLetter> = buildLetterFilter(query);
  // 全局列表（未指定 customerId）时，业务员只看自己名下客户的开发信；
  // 嵌套在客户详情下的列表（带 customerId）由入口 getCustomerByIdOrThrow 做归属校验。
  if (!query.customerId) {
    Object.assign(filter, await customerRefScope(actor));
  }
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
  const doc = await DevelopmentLetter.findById(id).populate('customerId', 'name company email status ownerId');
  if (!doc) throw ApiError.notFound(`开发信不存在或已被删除（id=${id}）`);

  // 业务员只能查看自己名下客户的开发信（客户已删时 populated 为 null，同样拒绝）
  const customer = doc.customerId as unknown as { ownerId?: unknown } | null;
  assertCustomerAccess(actor, customer?.ownerId);

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

  // 1) 草稿：直接落库，不发送、不改客户状态
  if (saveAsDraft) {
    const draft = await DevelopmentLetter.create({
      customerId: customer._id,
      recipientName: rendered.recipientName,
      recipientEmail: rendered.recipientEmail,
      subject: rendered.subject,
      content: rendered.html,
      contentText: rendered.text,
      template: contentTemplate,
      status: 'draft',
      channel: getActiveChannel(),
      sentBy: userId ? new Types.ObjectId(userId) : undefined,
    });
    logger.info(`已保存开发信草稿 -> ${rendered.recipientEmail}`);
    return {
      letter: toLetterDto(draft.toObject({ virtuals: false }) as unknown as Record<string, unknown>),
      customer: customer.toJSON() as unknown as ICustomer & { id: string },
      channel: getActiveChannel(),
      delivered: false,
      message: '草稿已保存，未发送',
    };
  }

  // 2) 真实 / 模拟发送
  const mailResult = await sendMail({
    to: rendered.recipientEmail,
    toName: rendered.recipientName,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  // 3) 无论成功失败都记录，保证「发送后的开发信必须同步记录」
  const letter = await DevelopmentLetter.create({
    customerId: customer._id,
    recipientName: rendered.recipientName,
    recipientEmail: rendered.recipientEmail,
    subject: rendered.subject,
    content: rendered.html,
    contentText: rendered.text,
    template: contentTemplate,
    status: mailResult.accepted ? 'sent' : 'failed',
    channel: mailResult.channel,
    sentAt: mailResult.accepted ? new Date() : undefined,
    messageId: mailResult.messageId,
    error: mailResult.accepted ? undefined : mailResult.error,
    sentBy: userId ? new Types.ObjectId(userId) : undefined,
  });

  // 4) 发送成功才更新客户计数与状态
  if (mailResult.accepted) {
    const update: Record<string, unknown> = {
      $inc: { letterCount: 1 },
      $set: { lastContactAt: letter.sentAt ?? new Date() },
    };
    // 语义升级：发送成功后只把「待开发」推进到「已联系」，不降级已推进的客户
    if (markAsDeveloped && customer.status === 'pending') {
      (update.$set as Record<string, unknown>).status = 'contacted';
    }
    await Customer.updateOne({ _id: customer._id }, update);
  }

  const refreshed = await Customer.findById(customer._id);
  const customerDto = (refreshed ?? customer).toJSON() as unknown as ICustomer & { id: string };

  return {
    letter: toLetterDto(letter.toObject({ virtuals: false }) as unknown as Record<string, unknown>),
    customer: customerDto,
    channel: mailResult.channel,
    delivered: mailResult.accepted,
    message: mailResult.accepted
      ? mailResult.channel === 'mock'
        ? '开发信已发送（MOCK 模式，未真实投递到邮箱）'
        : '开发信已发送'
      : `开发信发送失败：${mailResult.error ?? '未知错误'}（记录已保存，可稍后重发）`,
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
    userId: actor?.id,
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

  const original = await DevelopmentLetter.findById(letterId);
  if (!original) throw ApiError.notFound(`开发信不存在或已被删除（id=${letterId}）`);

  // 归属校验：业务员只能重发自己名下客户的开发信
  const customer = await getCustomerByIdOrThrow(String(original.customerId), actor);

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
  });
}

/* ------------------------------------------------------------------ */
/* 删除                                                                */
/* ------------------------------------------------------------------ */

/** 删除单封开发信，并同步回退客户计数器 */
export async function deleteLetter(id: string, actor?: AuthUser): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('开发信 ID 格式不正确');

  const letter = await DevelopmentLetter.findById(id).populate('customerId', 'ownerId');
  if (!letter) throw ApiError.notFound(`开发信不存在或已被删除（id=${id}）`);

  // populate 后 customerId 为对象，先取出裸 id 供计数器回退使用
  const populated = letter.customerId as unknown as { _id?: Types.ObjectId; ownerId?: unknown } | null;
  const customerIdStr = String(populated?._id ?? letter.customerId);
  // 业务员只能删除自己名下客户的开发信
  assertCustomerAccess(actor, populated?.ownerId);

  await DevelopmentLetter.deleteOne({ _id: letter._id });

  if (letter.status === 'sent') {
    // 带 letterCount > 0 条件的原子 $inc，既保证并发安全又不会出现负数
    await decrementLetterCount(customerIdStr, 1);
  }

  logger.info(`删除开发信: ${id}`);
  return { id };
}

/** 原子回退客户的开发信计数 */
async function decrementLetterCount(customerId: string, count: number): Promise<void> {
  try {
    await Customer.updateOne(
      { _id: new Types.ObjectId(customerId), letterCount: { $gte: count } },
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
  const targets = await DevelopmentLetter.find({ _id: { $in: objectIds }, ...refScope })
    .select({ _id: 1, customerId: 1, status: 1 })
    .lean();

  const targetList = targets as unknown as { _id: Types.ObjectId; customerId: Types.ObjectId; status: string }[];
  if (targetList.length === 0) return { deleted: 0 };

  const deletableIds = targetList.map((t) => t._id);
  const { deletedCount } = await DevelopmentLetter.deleteMany({ _id: { $in: deletableIds } });

  const counter = new Map<string, number>();
  targetList.forEach((t) => {
    if (t.status !== 'sent') return;
    const key = String(t.customerId);
    counter.set(key, (counter.get(key) ?? 0) + 1);
  });

  for (const [customerId, count] of counter) {
    await decrementLetterCount(customerId, count);
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
    DevelopmentLetter.countDocuments({ ...refScope, status: 'sent' }),
    DevelopmentLetter.countDocuments({ ...refScope, status: 'draft' }),
    DevelopmentLetter.countDocuments({ ...refScope, status: 'failed' }),
    DevelopmentLetter.countDocuments({ ...refScope, status: 'sent', sentAt: { $gte: sevenDaysAgo } }),
    DevelopmentLetter.countDocuments({ ...refScope, status: 'sent', sentAt: { $gte: thirtyDaysAgo } }),
    DevelopmentLetter.aggregate<{ _id: string; count: number }>([
      { $match: { ...refScope, status: 'sent', sentAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return {
    total,
    sent,
    draft,
    failed,
    sent7d,
    sent30d,
    channel: getActiveChannel(),
    byDay: byDayRaw,
  };
}
