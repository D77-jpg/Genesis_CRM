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
import { Customer, CustomerEvent, DevelopmentLetter, FollowUp } from '../models';
import type {
  CustomerEventType,
  CustomerStatus,
  FollowUpMethod,
  FollowUpResult,
  LetterStatus,
  MailChannel,
} from '../constants';
import { ApiError } from '../utils/ApiError';
import { createLogger } from '../config/logger';

const logger = createLogger('timeline-service');

/** 时间线事件类型（含从其它集合派生的 created / letter / followup） */
export type TimelineEventType = 'created' | 'letter' | 'followup' | 'status_changed' | 'followup_scheduled';

export interface TimelineEvent {
  /** 前端渲染用的稳定 key */
  id: string;
  type: TimelineEventType;
  /** 事件发生时间（排序依据） */
  at: Date;
  /** type=letter 时的开发信摘要 */
  letter?: { id: string; subject: string; status: LetterStatus; channel: MailChannel };
  /** type=followup 时的跟进记录摘要 */
  followUp?: {
    id: string;
    method: FollowUpMethod;
    result: FollowUpResult;
    content: string;
    nextFollowUpAt?: Date | null;
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
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(customerId)) return;
    const oid = new Types.ObjectId(customerId);
    const now = new Date();
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;

    const docs: {
      customerId: Types.ObjectId;
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
export async function getCustomerTimeline(customerId: string, limit = 200): Promise<CustomerTimeline> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  const oid = new Types.ObjectId(customerId);

  const customer = await Customer.findById(oid).select('_id createdAt').lean();
  if (!customer) {
    throw ApiError.notFound(`客户不存在或已被删除（id=${customerId}）`);
  }

  const [letters, followUps, events] = await Promise.all([
    DevelopmentLetter.find({ customerId: oid }).sort({ createdAt: -1 }).limit(limit).lean(),
    FollowUp.find({ customerId: oid }).sort({ followUpAt: -1 }).limit(limit).lean(),
    CustomerEvent.find({ customerId: oid }).sort({ at: -1 }).limit(limit).lean(),
  ]);

  const letterRows = letters as unknown as LetterRow[];
  const followUpRows = followUps as unknown as FollowUpRow[];
  const eventRows = events as unknown as EventRow[];

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

  // 最近一次联系 = 已发送开发信 或 跟进记录 的最新时间
  let lastContactAt: Date | null = null;
  for (const letter of letterRows) {
    if (letter.status !== 'sent') continue;
    const at = letter.sentAt ? new Date(letter.sentAt) : new Date(letter.createdAt);
    if (!lastContactAt || at.getTime() > lastContactAt.getTime()) lastContactAt = at;
  }
  for (const followUp of followUpRows) {
    const at = new Date(followUp.followUpAt);
    if (!lastContactAt || at.getTime() > lastContactAt.getTime()) lastContactAt = at;
  }

  return { items: items.slice(0, limit), lastContactAt };
}
