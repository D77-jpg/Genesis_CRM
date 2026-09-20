/**
 * 客户活动时间线业务逻辑
 * ------------------------------------------------------------------
 * 时间线把「一个客户身上发生过的重要事情」按时间倒序聚合成一条流：
 *   客户创建 → 发送开发信 → 状态变化 → 跟进 → 修改下一次跟进时间 → 再次发送 …
 *
 * 数据来源分两类：
 *   1) 可从既有集合派生：Customer.createdAt、DevelopmentLetter、FollowUp —— 直接读取，不重复落库；
 *   2) 无法事后还原的字段改动：状态变化、下一次跟进时间变化 —— 由 recordCustomerChanges 增量写入 CustomerEvent。
 *
 * 目标是让销售打开客户详情就能快速判断：
 *   之前发生过什么 / 最近一次联系是什么时候（lastContactAt）/ 下一步要做什么（nextFollowUpAt + 状态）。
 */
import { Types } from 'mongoose';
import { Customer, CustomerEvent, DevelopmentLetter, FollowUp, Quotation } from '../models';
import type {
  CustomerEventType,
  CustomerStatus,
  FollowUpMethod,
  FollowUpResult,
  LetterStatus,
  MailChannel,
  QuotationCurrency,
  QuotationStatus,
} from '../constants';
import { ApiError } from '../utils/ApiError';
import { projectScope } from '../utils/access';
import { createLogger } from '../config/logger';
import type { AuthUser } from '../types/express';

import { MailMessage } from '../models/MailMessage';
const logger = createLogger('timeline-service');

/** 时间线事件类型（含从其它集合派生的 created / letter / followup / quotation） */
export type TimelineEventType = 'created' | 'letter' | 'mail_received' | 'mail_opened' | 'mail_clicked' | 'followup' | 'quotation' | 'status_changed' | 'followup_scheduled';

export interface TimelineEvent {
  /** 前端渲染用的稳定 key */
  id: string;
  type: TimelineEventType;
  /** 事件发生时间（排序依据） */
  at: Date;
  /** type=letter 时的开发信摘要 */
  letter?: { id: string; subject: string; status: LetterStatus; channel: MailChannel };
  mail?: { id: string; subject: string; from: string };
  interaction?: { letterId: string; subject: string; count: number; lastAt?: Date; url?: string };
  /** type=followup 时的跟进记录摘要 */
  followUp?: {
    id: string;
    method: FollowUpMethod;
    result: FollowUpResult;
    content: string;
    nextFollowUpAt?: Date | null;
  };
  /** type=quotation 时的报价单摘要 */
  quotation?: {
    id: string;
    quotationNo: string;
    title: string;
    status: QuotationStatus;
    totalAmount: number;
    currency: QuotationCurrency;
  };
  /** type=status_changed 时的状态变化 */
  statusChange?: { from?: CustomerStatus; to?: CustomerStatus };
  /** type=followup_scheduled 时变更后的下一次跟进时间（null 表示被清除） */
  nextFollowUpAt?: Date | null;
}

export interface CustomerTimeline {
  items: TimelineEvent[];
  /** 最近一次「联系」：已发送的开发信 或 跟进记录 里最新的时间 */
  lastContactAt: Date | null;
}

/* ---------------- lean() 结果的最小结构（避免 mongoose 泛型在字段访问上报错） ---------------- */
interface LetterRow {
  _id: Types.ObjectId;
  subject: string;
  status: LetterStatus;
  channel: MailChannel;
  sentAt?: Date | null;
  createdAt: Date;
  tracking?: {
    openedAt?: Date | null;
    openCount?: number;
    lastOpenedAt?: Date | null;
    clickedAt?: Date | null;
    clickCount?: number;
    lastClickedAt?: Date | null;
    links?: { originalUrl: string; clickCount?: number }[];
  };
}
interface FollowUpRow {
  _id: Types.ObjectId;
  method: FollowUpMethod;
  result: FollowUpResult;
  content: string;
  followUpAt: Date;
  nextFollowUpAt?: Date | null;
}
interface EventRow {
  _id: Types.ObjectId;
  type: CustomerEventType;
  at: Date;
  fromStatus?: CustomerStatus;
  toStatus?: CustomerStatus;
  nextFollowUpAt?: Date | null;
}
interface QuotationRow {
  _id: Types.ObjectId;
  quotationNo: string;
  title: string;
  status: QuotationStatus;
  totalAmount: number;
  currency: QuotationCurrency;
  createdAt: Date;
  updatedAt?: Date;
}

interface CustomerChangeSnapshot {
  status?: CustomerStatus;
  nextFollowUpAt?: Date | null;
}

function followUpTimeValue(value?: Date | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * 记录客户字段改动事件（best-effort）。
 * 仅在 status / nextFollowUpAt 真正发生变化时写入；写入失败只告警，绝不阻断主更新流程。
 */
export async function recordCustomerChanges(
  customerId: string,
  before: CustomerChangeSnapshot,
  after: CustomerChangeSnapshot,
  userId?: string,
  projectId?: string,
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(customerId) || !projectId || !Types.ObjectId.isValid(projectId)) return;
    const oid = new Types.ObjectId(customerId);
    const projectOid = new Types.ObjectId(projectId);
    const now = new Date();
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;

    const docs: {
      customerId: Types.ObjectId;
      projectId: Types.ObjectId;
      type: CustomerEventType;
      at: Date;
      fromStatus?: CustomerStatus;
      toStatus?: CustomerStatus;
      nextFollowUpAt?: Date | null;
      createdBy?: Types.ObjectId;
    }[] = [];

    if (before.status && after.status && before.status !== after.status) {
      docs.push({
        customerId: oid,
        projectId: projectOid,
        type: 'status_changed',
        at: now,
        fromStatus: before.status,
        toStatus: after.status,
        createdBy,
      });
    }

    if (followUpTimeValue(before.nextFollowUpAt) !== followUpTimeValue(after.nextFollowUpAt)) {
      docs.push({
        customerId: oid,
        projectId: projectOid,
        type: 'followup_scheduled',
        at: now,
        nextFollowUpAt: after.nextFollowUpAt ?? null,
        createdBy,
      });
    }

    if (docs.length > 0) await CustomerEvent.insertMany(docs);
  } catch (error) {
    logger.warn(`记录客户活动事件失败（已忽略）: customer=${customerId} ${(error as Error).message}`);
  }
}

/** 聚合某客户的完整时间线（按时间倒序） */
export async function getCustomerTimeline(customerId: string, limit = 200, actor?: AuthUser): Promise<CustomerTimeline> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  const oid = new Types.ObjectId(customerId);

  const customer = await Customer.findOne({ _id: oid, ...projectScope(actor) }).select('_id projectId createdAt').lean();
  if (!customer) {
    throw ApiError.notFound(`客户不存在或已被删除（id=${customerId}）`);
  }

  const [letters, followUps, events, quotations] = await Promise.all([
    DevelopmentLetter.find({ customerId: oid, ...projectScope(actor) }).sort({ createdAt: -1 }).limit(limit).lean(),
    FollowUp.find({ customerId: oid, ...projectScope(actor) }).sort({ followUpAt: -1 }).limit(limit).lean(),
    CustomerEvent.find({ customerId: oid, ...projectScope(actor) }).sort({ at: -1 }).limit(limit).lean(),
    // 报价单追加在末尾（index 3），不影响上面既有的解构位置
    Quotation.find({ customerId: oid, ...projectScope(actor) }).sort({ updatedAt: -1 }).limit(limit).lean(),
  ]);

  const letterRows = letters as unknown as LetterRow[];
  const followUpRows = followUps as unknown as FollowUpRow[];
  const eventRows = events as unknown as EventRow[];
  const quotationRows = quotations as unknown as QuotationRow[];

  const items: TimelineEvent[] = [];

  const createdAt = (customer as unknown as { createdAt?: Date }).createdAt;
  if (createdAt) {
    items.push({ id: `created-${customerId}`, type: 'created', at: new Date(createdAt) });
  }

  for (const letter of letterRows) {
    const at = letter.sentAt ? new Date(letter.sentAt) : new Date(letter.createdAt);
    items.push({
      id: `letter-${String(letter._id)}`,
      type: 'letter',
      at,
      letter: {
        id: String(letter._id),
        subject: letter.subject,
        status: letter.status,
        channel: letter.channel,
      },
    });
    if (letter.tracking?.openedAt) {
      items.push({
        id: `mail-opened-${String(letter._id)}`,
        type: 'mail_opened',
        at: new Date(letter.tracking.openedAt),
        interaction: {
          letterId: String(letter._id), subject: letter.subject,
          count: letter.tracking.openCount ?? 1,
          lastAt: letter.tracking.lastOpenedAt ? new Date(letter.tracking.lastOpenedAt) : undefined,
        },
      });
    }
    if (letter.tracking?.clickedAt) {
      const firstClicked = letter.tracking.links?.find((link) => (link.clickCount ?? 0) > 0);
      items.push({
        id: `mail-clicked-${String(letter._id)}`,
        type: 'mail_clicked',
        at: new Date(letter.tracking.clickedAt),
        interaction: {
          letterId: String(letter._id), subject: letter.subject,
          count: letter.tracking.clickCount ?? 1,
          lastAt: letter.tracking.lastClickedAt ? new Date(letter.tracking.lastClickedAt) : undefined,
          url: firstClicked?.originalUrl,
        },
      });
    }
  }

  for (const followUp of followUpRows) {
    items.push({
      id: `followup-${String(followUp._id)}`,
      type: 'followup',
      at: new Date(followUp.followUpAt),
      followUp: {
        id: String(followUp._id),
        method: followUp.method,
        result: followUp.result,
        content: followUp.content,
        nextFollowUpAt: followUp.nextFollowUpAt ? new Date(followUp.nextFollowUpAt) : null,
      },
    });
  }

  // 报价单：从集合派生（不重复落库），锚定 updatedAt 以反映「创建 / 发送 / 状态变化」等最近一次关键动作
  for (const quotation of quotationRows) {
    const at = quotation.updatedAt ? new Date(quotation.updatedAt) : new Date(quotation.createdAt);
    items.push({
      id: `quotation-${String(quotation._id)}`,
      type: 'quotation',
      at,
      quotation: {
        id: String(quotation._id),
        quotationNo: quotation.quotationNo,
        title: quotation.title,
        status: quotation.status,
        totalAmount: quotation.totalAmount,
        currency: quotation.currency,
      },
    });
  }

  for (const event of eventRows) {
    const at = new Date(event.at);
    if (event.type === 'status_changed') {
      items.push({
        id: `event-${String(event._id)}`,
        type: 'status_changed',
        at,
        statusChange: { from: event.fromStatus, to: event.toStatus },
      });
    } else if (event.type === 'followup_scheduled') {
      items.push({
        id: `event-${String(event._id)}`,
        type: 'followup_scheduled',
        at,
        nextFollowUpAt: event.nextFollowUpAt ? new Date(event.nextFollowUpAt) : null,
      });
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());

  const received = await MailMessage.find({ customerId: oid, ...projectScope(actor) }).sort({ sentAt: -1 }).limit(limit).select('_id subject from sentAt');
  for (const mail of received) items.push({ id: `mail-${mail._id}`, type: 'mail_received', at: mail.sentAt,
    mail: { id: String(mail._id), subject: mail.subject, from: mail.from } });
  items.sort((a, b) => b.at.getTime() - a.at.getTime());

  // 最近一次联系 = 已发送开发信 或 跟进记录 的最新时间
  let lastContactAt: Date | null = null;
  for (const mail of received) if (!lastContactAt || mail.sentAt > lastContactAt) lastContactAt = mail.sentAt;
  for (const letter of letterRows) {
    if (!['sent', 'opened'].includes(letter.status)) continue;
    const at = letter.sentAt ? new Date(letter.sentAt) : new Date(letter.createdAt);
    if (!lastContactAt || at.getTime() > lastContactAt.getTime()) lastContactAt = at;
  }
  for (const followUp of followUpRows) {
    const at = new Date(followUp.followUpAt);
    if (!lastContactAt || at.getTime() > lastContactAt.getTime()) lastContactAt = at;
  }

  return { items: items.slice(0, limit), lastContactAt };
}
