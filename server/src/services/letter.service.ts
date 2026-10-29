import {redactPrivateReview} from './agent/knowledge-visibility';
import type {KnowledgeReview,KnowledgeFreshness} from './agent/knowledge-types';
import {knowledgeReviewHardBlocker,knowledgeReviewSendIssue} from './agent/knowledge-send-gate';
import {knowledgeFreshness,draftHash} from './agent/knowledge-grounding';
import {recordLetterReviewFeedback,retractLetterReviewFeedback} from './agent/knowledge-training';
import type {FeedbackIssue} from '../models/KnowledgeFeedback';
import {AgentTask} from '../models/AgentTask';
import {hasProtectedCustomerMail} from './agent/mail-thread-analysis.service';
import { createHash, randomUUID } from 'node:crypto';
import { newMessageId, processMailJob } from './mail-queue.service';
import { safeMailHtml } from './mail-security';
import { prepareTrackedHtml, trackingSummary, type TrackingSummary } from './mail-tracking.service';
import { MailMessage } from '../models/MailMessage';
import { resolveSenderIdentity } from './mail-account.service';
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
  AgentCustomerAnalysis,
  AgentMailThreadAnalysis,
  Customer,
  DevelopmentLetter,
  KnowledgeFeedback,
  LetterTemplate,
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
import { OUTREACH_MAX_STEPS } from '../constants';
import { getCustomerByIdOrThrow } from './customer.service';
import { ensureSignature } from './letter-signature';
import { resolveProjectSalesProfile } from './project-profile';
import { resolveSignerName } from './signer.service';
import { getActiveChannel, getProjectActiveChannel } from './mailer.service';
import { assertCustomerAccess, customerRefScope, projectScope, requireProjectId } from '../utils/access';
import type { AuthUser } from '../types/express';
import type {
  ListLettersQuery,
  ResendLetterInput,
  ReviewLetterInput,
  SendLetterInput,
} from '../validators/letter.validator';

const logger = createLogger('letter-service');

function assertKnowledgeReviewCanSend(review?:KnowledgeReview){
 const issue=knowledgeReviewSendIssue(review);
 if(issue)throw ApiError.conflict('草稿仍有未核实内容，已阻止发送：'+issue);
}

/** 开发信列表/详情中附带的客户摘要 */
export interface LetterCustomerSummary {
  id: string;
  name: string;
  company?: string;
  email?: string;
  status: CustomerStatus;
}

/** 草稿的人工审核结论（没有该字段表示尚未审核） */
export interface LetterReviewSummary {
  decision: 'approved' | 'rejected';
  at: Date;
  by?: string;
  byName?: string;
  contentHash: string;
  issues?: string[];
  note?: string;
}

/** 对外输出的开发信 DTO（id 为字符串，customerId 已扁平化） */
export interface LetterDto {
  knowledgeReview?:KnowledgeReview;
  knowledgeRechecks?:Record<string,unknown>[];
  knowledgeFreshness?:KnowledgeFreshness;
  reviewBodyChanged?:boolean;
  /** 人工批准也解决不了的硬拦截原因（模型原稿/依据异常等）；有值时不能审核通过，只能重新生成 */
  sendBlocker?:string;
  id: string;
  customerId: string;
  customer?: LetterCustomerSummary;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  content: string;
  contentText: string;
  template: string;
  templateId?: string;
  templateNameSnapshot?: string;
  templateContentHash?: string;
  status: IDevelopmentLetter['status'];
  channel: IDevelopmentLetter['channel'];
  sentAt?: Date;
  messageId?: string;
  scheduledAt?: Date;
  threadId?: string;
  needsReview?: boolean;
  outreachStep?: number;
  review?: LetterReviewSummary;
  error?: string;
  sentBy?: string;
  senderAddress?: string;
  mailAccountId?: string;
  createdAt: Date;
  updatedAt: Date;
  tracking?: TrackingSummary;
}

/* ------------------------------------------------------------------ */
/* 占位符渲染                                                          */
/* ------------------------------------------------------------------ */

/**
 * 由客户 + 环境变量构造完整的占位符取值表。
 * `signerName` 是「当前使用账号」的姓名，签名和 {{senderName}} 必须用同一个值。
 */
async function buildValues(customer: Partial<ICustomer>, signerName?: string): Promise<PlaceholderValues> {
  const project = customer.projectId ? await Project.findById(customer.projectId).lean() : null;
  return {
    ...buildPlaceholderValues(customer),
    companyName: project?.companyName || env.COMPANY_NAME,
    companyWebsite: project?.website || env.COMPANY_WEBSITE,
    moq: project?.moq || env.COMPANY_MOQ,
    senderName: signerName || project?.senderName || env.SENDER_NAME,
  };
}

/**
 * 签名第一行取「实际发信的业务员」：当前登录账号 → 客户负责人 → 项目署名。
 * 具体顺序见 services/signer.service.ts；开发信结尾因此跟着人走，
 * 而不是所有账号共用一个名字（也不会退回成 Sales Team 这种泛称）。
 */
async function signerNameFor(customer: Partial<ICustomer>, actorId?: string): Promise<string> {
  return resolveSignerName({ projectId: customer.projectId, ownerId: customer.ownerId, actorId });
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
 * 正文若还没有固定结尾，这里补上——预览、草稿、实际发送看到的是同一份内容。
 */
export async function renderLetter(
  customer: Partial<ICustomer>,
  subject: string,
  content: string,
  recipientEmailOverride?: string,
  signerName?: string,
): Promise<RenderedLetter> {
  const values = await buildValues(customer, signerName);
  const recipientEmail = (recipientEmailOverride || customer.email || '').trim().toLowerCase();

  if (!recipientEmail) {
    throw ApiError.badRequest('该客户还没有填写邮箱，请先补充邮箱或在发送框中手动指定收件人', [
      { field: 'recipientEmail', message: '收件人邮箱不能为空' },
    ]);
  }

  const project = customer.projectId
    ? await Project.findById(customer.projectId).select('code slug name companyName industry website mailFrom senderName').lean()
    : null;
  const signature = resolveProjectSalesProfile(project).signature;
  const withSignature = ensureSignature(content, values.senderName, signature, true);

  return {
    // 主题走纯文本渲染（不转义），正文走 HTML 渲染（转义，防存储型 XSS）
    subject: renderTemplate(subject, values, { escape: false }),
    html: safeMailHtml(renderTemplate(withSignature, values, { escape: true })),
    text: htmlToPlainText(renderTemplate(withSignature, values, { escape: false })),
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
  if (query.review && query.review !== 'all') {
    // 走 $and，避免和下面 search 的 $or 互相覆盖
    const andConditions: Record<string, unknown>[] = [];
    if (query.review === 'todo') {
      // $ne 也匹配缺字段的文档：没有结论、或只有空 review 对象（upsert 默认值）的都算还要处理
      andConditions.push({ 'review.decision': { $ne: 'rejected' } });
    } else if (query.review === 'pending') {
      andConditions.push({ $or: [{ review: { $exists: false } }, { 'review.decision': { $exists: false } }] });
    } else {
      andConditions.push({ 'review.decision': query.review });
    }
    filter.$and = andConditions;
  }
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

/** 审核指纹：主题 + 纯文本正文，二者任一变化审核即失效。 */
function reviewContentHash(subject: string, contentText: string): string {
  return createHash('sha256').update(JSON.stringify([subject, contentText])).digest('hex');
}

/**
 * 只有同时带结论与指纹的审核记录才算数。
 * Mongoose 在 upsert（setDefaultsOnInsert）时可能写入空的 review 对象，不能当成「已审核」。
 */
function activeReview(value: IDevelopmentLetter['review'] | undefined): IDevelopmentLetter['review'] | undefined {
  return value?.decision && value.contentHash ? value : undefined;
}

function toReviewSummary(value: unknown): LetterReviewSummary | undefined {
  const raw = value as Partial<LetterReviewSummary> | null | undefined;
  if (!raw || (raw.decision !== 'approved' && raw.decision !== 'rejected')) return undefined;
  return {
    decision: raw.decision,
    at: raw.at as Date,
    ...(raw.by ? { by: String(raw.by) } : {}),
    ...(raw.byName ? { byName: raw.byName } : {}),
    ...(raw.issues?.length ? { issues: raw.issues } : {}),
    ...(raw.note ? { note: raw.note } : {}),
    contentHash: String(raw.contentHash ?? ''),
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
  const review = toReviewSummary(doc.review);
  const knowledgeReview = doc.knowledgeReview as KnowledgeReview | undefined;
  const sendBlocker = doc.status === 'draft' ? knowledgeReviewHardBlocker(knowledgeReview) : undefined;

  return {
    id: String((doc._id ?? doc.id ?? '').toString()),
    customerId,
    ...(summary ? { customer: summary } : {}),
    recipientName: String(doc.recipientName ?? ''),
    recipientEmail: String(doc.recipientEmail ?? ''),
    knowledgeReview,
    ...(sendBlocker ? { sendBlocker } : {}),
    knowledgeRechecks:doc.knowledgeRechecks as Record<string,unknown>[]|undefined,
    subject: String(doc.subject ?? ''),
    content: String(doc.content ?? ''),
    contentText: String(doc.contentText ?? ''),
    template: String(doc.template ?? ''),
    ...(doc.templateId ? { templateId: String(doc.templateId) } : {}),
    ...(doc.templateNameSnapshot ? { templateNameSnapshot: String(doc.templateNameSnapshot) } : {}),
    ...(doc.templateContentHash ? { templateContentHash: String(doc.templateContentHash) } : {}),
    scheduledAt: doc.scheduledAt as Date | undefined,
    threadId: doc.threadId as string | undefined,
    needsReview: Boolean(doc.needsReview),
    ...(doc.outreachStep ? { outreachStep: Number(doc.outreachStep) } : {}),
    ...(review ? { review } : {}),
    status: doc.status as IDevelopmentLetter['status'],
    channel: doc.channel as IDevelopmentLetter['channel'],
    ...(doc.sentAt ? { sentAt: doc.sentAt as Date } : {}),
    ...(doc.messageId ? { messageId: String(doc.messageId) } : {}),
    ...(doc.error ? { error: String(doc.error) } : {}),
    ...(doc.sentBy ? { sentBy: String(doc.sentBy) } : {}),
    ...(doc.senderAddress ? { senderAddress: String(doc.senderAddress) } : {}),
    ...(doc.mailAccountId ? { mailAccountId: String(doc.mailAccountId) } : {}),
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
  const dtos = items.map((item) => {const dto=toLetterDto(item);if(actor&&actor.role!=='admin'){dto.knowledgeReview=undefined;dto.knowledgeRechecks=undefined;}return dto;});

  return buildPaginated(dtos, total, page, limit);
}

export async function getLetter(id: string, actor?: AuthUser): Promise<LetterDto> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('开发信 ID 格式不正确');
  const doc = await DevelopmentLetter.findOne({ _id: id, ...projectScope(actor) }).populate('customerId', 'name company email status ownerId projectId');
  if (!doc) throw ApiError.notFound(`开发信不存在或已被删除（id=${id}）`);

  // 业务员只能查看自己名下客户的开发信（客户已删时 populated 为 null，同样拒绝）
  const customer = doc.customerId as unknown as { ownerId?: unknown } | null;
  assertCustomerAccess(actor, customer?.ownerId, doc.projectId);

  const result=toLetterDto(doc.toObject({virtuals:false,depopulate:false}) as unknown as Record<string,unknown>);
  if(result.knowledgeReview&&actor){result.knowledgeFreshness=await knowledgeFreshness(result.knowledgeReview,actor);const visible=await redactPrivateReview(result.knowledgeReview,actor);const allowed=new Set(visible.sources.map(s=>s.sourceId));result.knowledgeFreshness.changed=result.knowledgeFreshness.changed.map(c=>c.sourceId.startsWith('knowledge:')&&!allowed.has(c.sourceId)?{...c,title:'受限历史依据'}:c);if(visible.sources.length!==result.knowledgeReview.sources.length)result.knowledgeRechecks=undefined;result.knowledgeReview=visible;result.reviewBodyChanged=draftHash(result.contentText)!==result.knowledgeReview.bodyHash;}
  return result;
}

/* ------------------------------------------------------------------ */
/* 发送 / 重发                                                         */
/* ------------------------------------------------------------------ */

interface TemplateAttribution {
  templateId: Types.ObjectId;
  templateNameSnapshot: string;
  templateContentHash: string;
}

/** 使用原始主题和 HTML 的 JSON 元组，避免拼接字符串产生边界歧义。 */
function rawTemplateHash(subject: string, content: string): string {
  return createHash('sha256').update(JSON.stringify([subject, content]), 'utf8').digest('hex');
}

/** 对比已落库快照；不得将无模板请求重放到有归因的旧任务（反之亦然）。 */
function assertSameTemplateAttribution(letter: IDevelopmentLetter, attribution?: TemplateAttribution): void {
  if (String(letter.templateId ?? '') !== String(attribution?.templateId ?? '')
    || (letter.templateNameSnapshot ?? '') !== (attribution?.templateNameSnapshot ?? '')
    || (letter.templateContentHash ?? '') !== (attribution?.templateContentHash ?? '')) {
    throw ApiError.conflict('同一请求标识不能混用或更改模板归因，请使用新的请求标识');
  }
}

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
  templateAttribution?: TemplateAttribution;
  agentTaskId?:Types.ObjectId;
  knowledgeReview?:KnowledgeReview;
  knowledgeRechecks?:Record<string,unknown>[];
  agentDraftId?:Types.ObjectId;
  agentOutreachId?: Types.ObjectId;
  /** 同一客户三封开发信序列中的位置；草稿先写入，发送时用于排序和同线程回复。 */
  outreachStep?: number;
  /** 重发同一封信时不要重复计开发封数 */
  countAsOutreach?: boolean;
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

  // 这是本轮开发的第几封：回复类邮件不算；已弃用的客户重新发信按新一轮算
  const countedOutreach = options.countAsOutreach !== false;
  const isOutreach = countedOutreach && !options.replyToId && !options.inReplyTo;
  const currentStep = Number(customer.outreachStep ?? 0);
  const outreachStep = options.outreachStep
    ? Math.min(OUTREACH_MAX_STEPS, Math.max(1, Math.trunc(options.outreachStep)))
    : isOutreach
      ? (customer.outreachAbandonedAt ? 1 : Math.min(currentStep + 1, OUTREACH_MAX_STEPS))
      : undefined;

  const rendered = await renderLetter(
    customer,
    subjectTemplate,
    contentTemplate,
    recipientEmailOverride,
    await signerNameFor(customer, userId),
  );
  const sender = await resolveSenderIdentity(String(customer.projectId), userId, saveAsDraft);
  const activeChannel = sender.channel;

  // 回复草稿也必须先解析父邮件，确保收件人、主题和线程引用与正式回复一致。
  let threadId: string = options.threadId || randomUUID();
  let inReplyTo = options.inReplyTo;
  let references: string[] = options.references || [];
  if (options.replyToId) {
    const parent = await MailMessage.findOne({ _id: options.replyToId, customerId: customer._id, projectId: customer.projectId });
    if (!parent) throw ApiError.notFound('邮件不存在或无权访问');
    if (parent.mailboxUserId && String(parent.mailboxUserId) !== userId) {
      throw ApiError.conflict('该邮件属于其他业务员的个人邮箱，不能以当前账号回复');
    }
    threadId = parent.threadId;
    inReplyTo = parent.messageId || undefined;
    references = [...parent.references, ...(inReplyTo ? [inReplyTo] : [])].slice(-50);
    rendered.recipientEmail = parent.from;
    const replySubject = saveAsDraft ? rendered.subject : parent.subject;
    rendered.subject = /^re:/i.test(replySubject) ? replySubject : 'Re: ' + replySubject;
  }

  // 审核快照的 bodyHash 必须对应「实际落库的正文」，否则审核页会误报
  // 「主题或正文已修改，依据对应的是原生成版本」。签名/渲染都会改变正文，
  // 所以这里用渲染结果重算一次基线。
  const knowledgeReview = options.knowledgeReview
    ? { ...options.knowledgeReview, bodyHash: draftHash(rendered.text) }
    : undefined;

  // 1) 草稿：直接落库，不发送、不改客户状态
  if (saveAsDraft) {
    const payload = {
      ...(options.agentTaskId?{agentTaskId:options.agentTaskId}:{}),
      ...(options.agentDraftId?{agentDraftId:options.agentDraftId}:{}),
      ...(options.agentOutreachId ? { agentOutreachId: options.agentOutreachId } : {}),
      ...(outreachStep ? {outreachStep} : {}),
      ...(knowledgeReview ? {knowledgeReview} : {}),
      ...(knowledgeReview ? {aiSnapshot:{subject:rendered.subject,contentText:rendered.text,at:new Date()}} : {}),
      projectId: customer.projectId,
      customerId: customer._id,
      recipientName: rendered.recipientName,
      recipientEmail: rendered.recipientEmail,
      subject: rendered.subject,
      senderAddress: sender.senderAddress,
      mailAccountId: sender.mailAccountId,
      content: rendered.html,
      contentText: rendered.text,
      template: contentTemplate,
      ...options.templateAttribution,
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
        || draft.template !== contentTemplate
        || draft.recipientEmail !== rendered.recipientEmail
        || draft.status !== 'draft') {
        throw ApiError.conflict('同一请求标识不能用于不同的开发信草稿');
      }
      assertSameTemplateAttribution(draft, options.templateAttribution);
      if(String(draft.agentTaskId??'')!==String(options.agentTaskId??''))throw ApiError.conflict('同一请求不能更换任务关联');
      if (String(draft.agentOutreachId ?? '') !== String(options.agentOutreachId ?? '')) throw ApiError.conflict('同一请求不能更改首封草稿关联');
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
      ...(options.agentTaskId?{agentTaskId:options.agentTaskId}:{}),
      ...(options.agentDraftId?{agentDraftId:options.agentDraftId}:{}),
      ...(options.agentOutreachId ? { agentOutreachId: options.agentOutreachId } : {}),
      ...(knowledgeReview ? {knowledgeReview} : {}),
      ...(knowledgeReview ? {aiSnapshot:{subject:rendered.subject,contentText:rendered.text,at:new Date()}} : {}),
      projectId: customer.projectId, customerId: customer._id, recipientName: rendered.recipientName,
      recipientEmail: rendered.recipientEmail, subject: rendered.subject,
      senderAddress: sender.senderAddress,
      mailAccountId: sender.mailAccountId,
      content: rendered.html, deliveryContent: prepared.deliveryHtml,
      contentText: rendered.text, template: contentTemplate,
      ...options.templateAttribution,
      status: options.scheduledAt ? 'scheduled' : 'queued', channel: activeChannel,
      messageId: newMessageId(), threadId, inReplyTo, references,
      ...(outreachStep ? { outreachStep } : {}),
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
  if (letter.subject !== rendered.subject || letter.content !== rendered.html || letter.recipientEmail !== rendered.recipientEmail || letter.template !== contentTemplate) throw ApiError.conflict('同一请求标识不能用于不同邮件内容，请重新打开编辑器');
  assertSameTemplateAttribution(letter, options.templateAttribution);
  if(String(letter.agentTaskId??'')!==String(options.agentTaskId??''))throw ApiError.conflict('同一请求不能更换任务关联');
  if (String(letter.agentOutreachId ?? '') !== String(options.agentOutreachId ?? '')) throw ApiError.conflict('同一请求不能更改首封草稿关联');
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

  let knowledgeReview:KnowledgeReview|undefined;
  let agentOutreachId: Types.ObjectId | undefined;
  if (input.agentAnalysisId) {
    const analysis = await AgentCustomerAnalysis.findOne({ _id: input.agentAnalysisId, projectId: customer.projectId,
      userId: actor?.id, customerId: customer._id, firstOutreach: true });
    if (!analysis) throw ApiError.notFound('首封草稿不存在或无权使用');
    if (input.replyToId) throw ApiError.badRequest('首封开发信不能作为邮件回复');
    agentOutreachId = analysis._id;
    knowledgeReview=analysis.knowledgeReview;
    if (input.outreachStep && input.outreachStep > 1 && analysis.outreachStep && analysis.outreachStep !== input.outreachStep) {
      throw ApiError.badRequest('开发信序列位置与草稿不一致，请重新生成');
    }
  }
  if(input.agentTaskId){const task=await AgentTask.findOne({_id:input.agentTaskId,projectId:customer.projectId,userId:actor?.id,customerId:customer._id,status:{$in:input.saveAsDraft?['running','awaiting_review']:['awaiting_review']}});if(!task)throw ApiError.notFound('任务不存在或状态已变化');const linked=task.mailAnalysisId
 ?await AgentMailThreadAnalysis.findOne({_id:task.mailAnalysisId,projectId:customer.projectId,userId:actor?.id,customerId:customer._id})
 :await AgentCustomerAnalysis.findOne({_id:task.analysisId,projectId:customer.projectId,userId:actor?.id,customerId:customer._id});
 knowledgeReview=linked?.knowledgeReview;}
  if((input.agentTaskId||agentOutreachId)&&await hasProtectedCustomerMail(customer.id,String(customer.projectId)))throw ApiError.conflict('客户已停止营销联系，不能继续发送或准备营销草稿');
  if(!input.saveAsDraft)assertKnowledgeReviewCanSend(knowledgeReview);
  let templateAttribution: TemplateAttribution | undefined;
  if (input.templateId) {
    if (input.replyToId) throw ApiError.badRequest('回复邮件不能作为模板开发信归因');
    // 只信任同项目的模板原文，不能由客户端自行声明模板名称或哈希。
    const template = await LetterTemplate.findOne({ _id: input.templateId, projectId: customer.projectId });
    if (!template) throw ApiError.badRequest('模板不存在或不属于当前项目');
    if (input.subject !== template.subject || input.content !== template.content) {
      throw ApiError.badRequest('主题或正文与模板原文不一致；编辑后请清除 templateId 再发送');
    }
    templateAttribution = {
      templateId: template._id,
      templateNameSnapshot: template.name,
      templateContentHash: rawTemplateHash(template.subject, template.content),
    };
  }

  let subject = input.templateId ? input.subject : input.subject.trim();
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string[] | undefined;
  if (!input.saveAsDraft && input.outreachStep && input.outreachStep > 1) {
    // The three-step sequence is generated before the first send, so it cannot
    // know the future Message-ID. Resolve the preceding sent letter at send
    // time to keep replies in the same thread (plugin's non-negotiable rule).
    const previous = await DevelopmentLetter.findOne({
      projectId: customer.projectId,
      customerId: customer._id,
      outreachStep: input.outreachStep - 1,
      status: { $in: ['sent', 'opened'] },
      messageId: { $exists: true, $ne: '' },
    }).sort({ sentAt: -1 });
    if (!previous?.messageId) throw ApiError.conflict(`请先发送第 ${input.outreachStep - 1} 封开发信，再发送第 ${input.outreachStep} 封`);
    subject = /^re:/i.test(subject) ? subject : `Re: ${previous.subject}`;
    threadId = previous.threadId;
    inReplyTo = previous.messageId;
    references = [...(previous.references ?? []), previous.messageId];
  }

  return persistAndSend({
    customer,
    subjectTemplate: subject,
    contentTemplate: input.content,
    templateAttribution,
    knowledgeReview,agentOutreachId,agentTaskId:input.agentTaskId?new Types.ObjectId(input.agentTaskId):undefined,
    recipientEmailOverride: input.recipientEmail,
    markAsDeveloped: input.markAsDeveloped,
    saveAsDraft: input.saveAsDraft,
    replyToId: input.replyToId,
    outreachStep: input.outreachStep,
    threadId,
    inReplyTo,
    references,
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

  if((original.agentTaskId||original.agentOutreachId)&&await hasProtectedCustomerMail(customer.id,String(customer.projectId)))throw ApiError.conflict('客户已停止营销联系，禁止继续营销发送');
  // 优先用原始模板（含占位符），没有模板时退化为已渲染的正文
  const contentTemplate = input.content ?? original.template ?? original.content;
  let subjectTemplate = input.subject ?? original.subject;
  const priorReview = activeReview(original.review);
  const signerName = await signerNameFor(customer, actor?.id);

  if (input.saveAsDraft) {
    if (original.status !== 'draft') throw ApiError.conflict('只有草稿可以继续保存');
    const rendered = await renderLetter(customer, subjectTemplate, contentTemplate, input.recipientEmail ?? original.recipientEmail, signerName);
    // 保存草稿等于换了一份待审内容：无论之前是通过还是不通过，结论都失效，重新审核。
    const update: Record<string, unknown> = {$set:{
      subject:rendered.subject, content:rendered.html, contentText:rendered.text, template:contentTemplate,
      recipientEmail:rendered.recipientEmail, recipientName:rendered.recipientName,
    },$unset:{review:1,'knowledgeReview.manualApprovedAt':1,'knowledgeReview.manualApprovedBy':1}};
    const saved = await DevelopmentLetter.findOneAndUpdate({_id: original._id, projectId: customer.projectId, status:'draft'}, update, {new:true});
    if (!saved) throw ApiError.conflict('草稿状态已变化，请刷新后重试');
    return {letter:toLetterDto(saved.toObject() as unknown as Record<string,unknown>),customer:customer.toJSON() as unknown as ICustomer & {id:string},
      channel:saved.channel,delivered:false,message:'草稿已更新，未发送'};
  }

  // 审核结论是发送前的硬约束：不通过的稿和审核后又被改动的稿都不能直接发出。
  if (original.status === 'draft' && priorReview) {
    if (priorReview.decision === 'rejected') throw ApiError.conflict('草稿已标记为不通过，请先审核通过再发送');
    const current = await renderLetter(customer, subjectTemplate, contentTemplate, input.recipientEmail ?? original.recipientEmail, signerName);
    if (priorReview.contentHash !== reviewContentHash(current.subject, current.text)) {
      throw ApiError.conflict('审核后内容已变化，请重新审核后再发送');
    }
  }
  assertKnowledgeReviewCanSend(original.knowledgeReview);

  let threadId = original.threadId;
  let inReplyTo = original.inReplyTo;
  let references = original.references;
  if (original.outreachStep && original.outreachStep > 1 && !original.inReplyTo) {
    const previous = await DevelopmentLetter.findOne({
      projectId: customer.projectId,
      customerId: customer._id,
      outreachStep: original.outreachStep - 1,
      status: { $in: ['sent', 'opened'] },
      messageId: { $exists: true, $ne: '' },
    }).sort({ sentAt: -1 });
    if (!previous?.messageId) throw ApiError.conflict(`请先发送第 ${original.outreachStep - 1} 封开发信，再发送第 ${original.outreachStep} 封`);
    if (!/^re:/i.test(subjectTemplate)) subjectTemplate = `Re: ${previous.subject}`;
    threadId = previous.threadId;
    inReplyTo = previous.messageId;
    references = [...(previous.references ?? []), previous.messageId];
  }

  return persistAndSend({
    customer,
    subjectTemplate,
    contentTemplate,
    agentTaskId:original.agentTaskId,agentDraftId:original.agentDraftId??(original.status==='draft'?original._id:undefined),
    agentOutreachId: original.agentOutreachId,
    knowledgeReview:original.knowledgeReview,
    recipientEmailOverride: input.recipientEmail ?? original.recipientEmail,
    markAsDeveloped: input.markAsDeveloped,
    saveAsDraft: false,
    userId: actor?.id,
    scheduledAt: input.scheduledAt,
    requestKey: input.requestKey || `resend_${original.id}_${createHash('sha256').update(JSON.stringify([input, Math.floor(Date.now() / 60000)])).digest('hex')}`,
    outreachStep: original.outreachStep,
    threadId,
    inReplyTo,
    references,
    countAsOutreach: false,
  });
}

/* ------------------------------------------------------------------ */
/* 草稿审核                                                             */
/* ------------------------------------------------------------------ */

/**
 * 草稿审核：通过 / 不通过 / 撤销结论。
 * 审核是业务员对自己草稿的自检，只记录结论，不需要填写理由。
 * - 通过：把当前编辑内容渲染后与审核结论一起落库，发送时校验指纹，保证发给客户的就是审核过的内容；
 * - 不通过：这封草稿不发送，只记录结论（未保存的编辑不落库，改内容请走「保存草稿」）；
 * - 撤销：清掉结论，草稿回到待审核。
 */
export async function reviewLetter(id: string, input: ReviewLetterInput, actor?: AuthUser): Promise<LetterDto> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('开发信 ID 格式不正确');

  const letter = await DevelopmentLetter.findOne({ _id: id, ...projectScope(actor) });
  if (!letter) throw ApiError.notFound(`开发信不存在或已被删除（id=${id}）`);
  if (letter.status !== 'draft') throw ApiError.conflict('只有尚未发送的草稿可以审核');

  if (input.decision === 'clear') {
    const cleared = await DevelopmentLetter.findOneAndUpdate({ _id: letter._id, status: 'draft' }, { $unset: { review: 1, 'knowledgeReview.manualApprovedAt': 1, 'knowledgeReview.manualApprovedBy': 1 } }, { new: true });
    if (!cleared) throw ApiError.conflict('草稿状态已变化，请刷新后重试');
    await retractLetterReviewFeedback(cleared._id, cleared.projectId).catch(error => logger.warn('撤销审核训练样本失败', error));
    logger.info(`letter review cleared id=${letter.id} by=${actor?.id ?? 'system'}`);
    return toLetterDto(cleared.toObject() as unknown as Record<string, unknown>);
  }

  // 硬拦截（模型原稿未核验、依据过期/冲突等）人工批准也解决不了：
  // 直接拒绝记录「通过」，避免出现「已通过但永远发不出去」的死状态。
  if (input.decision === 'approve') {
    const blocker = knowledgeReviewHardBlocker(letter.knowledgeReview);
    if (blocker) throw ApiError.conflict(`这封草稿不能通过审核：${blocker} 请按最新依据重新生成后再审核。`);
  }

  const customer = await getCustomerByIdOrThrow(String(letter.customerId), actor);
  const decision = input.decision === 'approve' ? ('approved' as const) : ('rejected' as const);
  const base = {
    decision,
    at: new Date(),
    ...(actor?.id ? { by: new Types.ObjectId(actor.id) } : {}),
    ...(actor?.displayName || actor?.username ? { byName: actor?.displayName || actor?.username } : {}),
    ...(input.issues?.length ? { issues: input.issues } : {}),
    ...(input.note ? { note: input.note } : {}),
  };

  let update: Record<string, unknown>;
  if (decision === 'rejected') {
    update = { $set: { review: { ...base, contentHash: reviewContentHash(letter.subject, letter.contentText) } } };
  } else {
    const contentTemplate = input.content ?? letter.template ?? letter.content;
    const rendered = await renderLetter(customer, input.subject ?? letter.subject, contentTemplate, input.recipientEmail ?? letter.recipientEmail, await signerNameFor(customer, actor?.id));
    // 审核页是高风险内容的人工批准入口：人看的就是这份渲染后的正文，点「通过」
    // 即代表对这份正文负责，所以批准必须落在本次要落库的正文上。
    // 旧实现要求 rendered.text 与生成时的 bodyHash 完全一致才记录批准，只要草稿
    // 在生成后被编辑过（换行/签名重排都算），批准就永远写不进去，发送闸门随后
    // 以「高风险内容还没有人工批准」永久拦死——审核通过却发不出去。
    // 这里改为：批准时把 knowledgeReview.bodyHash 重新基线到本次正文，避免
    // 渲染差异让批准失效；防止「审核后换正文」仍由 review.contentHash 负责。
    const approvedBodyHash = draftHash(rendered.text);
    if (decision === 'approved' && letter.knowledgeReview && letter.knowledgeReview.bodyHash !== approvedBodyHash) {
      logger.info(`letter approval rebaselines knowledge bodyHash id=${letter.id} from=${letter.knowledgeReview.bodyHash} to=${approvedBodyHash}`);
    }
    const knowledgeApproval = decision === 'approved' && letter.knowledgeReview
      ? {
          'knowledgeReview.manualApprovedAt': base.at.toISOString(),
          'knowledgeReview.manualApprovedBy': actor?.id ?? 'system',
          'knowledgeReview.bodyHash': approvedBodyHash,
        }
      : {};
    update = {
      $set: {
        subject: rendered.subject,
        content: rendered.html,
        contentText: rendered.text,
        template: contentTemplate,
        recipientEmail: rendered.recipientEmail,
        recipientName: rendered.recipientName,
        review: { ...base, contentHash: reviewContentHash(rendered.subject, rendered.text) },
        ...knowledgeApproval,
      },
    };
  }

  const updated = await DevelopmentLetter.findOneAndUpdate({ _id: letter._id, status: 'draft' }, update, { new: true });
  if (!updated) throw ApiError.conflict('草稿状态已变化，请刷新后重试');
  // Training data is a derivative of the human conclusion. Never fail an audit
  // because a secondary sample could not be written.
  await recordLetterReviewFeedback(updated, decision, actor, {
    issues: input.issues as FeedbackIssue[] | undefined,
    note: input.note,
  }).catch(error => logger.warn('审核训练样本保存失败', error));
  logger.info(`letter ${decision} id=${letter.id} by=${actor?.id ?? 'system'}`);
  return toLetterDto(updated.toObject() as unknown as Record<string, unknown>);
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
  await KnowledgeFeedback.deleteMany({ letterId: letter._id, projectId: letter.projectId });

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
  await KnowledgeFeedback.deleteMany({ letterId: { $in: deletableIds }, ...projectScope(actor) });

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
  return renderLetter(customer, subject, content, recipientEmail, await signerNameFor(customer, actor?.id));
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
