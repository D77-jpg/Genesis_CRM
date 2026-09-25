import { Types } from 'mongoose';
import { Customer, CustomerEvent, DevelopmentLetter, FollowUp, LetterTemplate, Project, Quotation, User } from '../models';
import { MailMessage } from '../models/MailMessage';
import { detectProtectedMailSignal } from './agent/mail-thread-analysis.service';
import { requireProjectId } from '../utils/access';
import { ApiError } from '../utils/ApiError';
import type { AuthUser } from '../types/express';

export type PerformanceWindowDays = 30 | 90 | 180;
export type PerformanceMetric = 'sent' | 'replied' | 'interested' | 'quoted' | 'won' | 'unsubscribed' | 'bounced';
export type PerformanceStage = Exclude<PerformanceMetric, 'sent'>;
export type PerformanceMetrics = Record<PerformanceMetric, number>;
export interface PerformanceRate { numerator: number; denominator: number; rate: number | null }
export type PerformanceRates = Record<PerformanceStage, PerformanceRate>;
export interface TemplatePerformanceGroup {
  templateId: string;
  templateNameSnapshot: string;
  templateContentHash: string;
  /** Historical snapshots remain visible even after a template is deleted. */
  deleted: boolean;
  metrics: PerformanceMetrics;
  rates: PerformanceRates;
  /** Distinct recipients, unlike sent (distinct successfully sent letters). */
  sampleSize: number;
  insufficientSample: boolean;
}
export interface TemplatePerformanceSummary {
  windowDays: PerformanceWindowDays;
  windowStart: Date;
  windowEnd: Date;
  sampleThreshold: number;
  /** Sent letters without complete server-verified attribution snapshot; never inferred by subject/content. */
  unattributed: number;
  correlationDisclaimer: string;
  templates: TemplatePerformanceGroup[];
}

const MAX_DOCUMENTS = 5000;
const MAX_THRESHOLD = 10000;
const STAGES: PerformanceStage[] = ['replied', 'interested', 'quoted', 'won', 'unsubscribed', 'bounced'];
const DISCLAIMER = '回复须匹配模板发信线程；其余阶段为同项目同客户且发送后的时间相关事件，不代表模板导致回复、意向、报价或成交；不同模板可能关联同一客户。';
type Id = Types.ObjectId;
type SentLetter = { _id: Id; customerId: Id; sentAt: Date; templateId?: Id; templateNameSnapshot?: string; templateContentHash?: string };
type ScopedCustomer = { _id: Id; status: string };
type Mail = { customerId: Id | null; sentAt: Date; from: string; subject?: string; text?: string; threadId?: string };
type Follow = { customerId: Id; followUpAt: Date; result: string };
type Event = { customerId: Id; at: Date; toStatus?: string };
type Quote = { customerId: Id; createdAt: Date };

function bounded<T>(docs: T[], label: string): T[] {
  if (docs.length > MAX_DOCUMENTS) throw new ApiError(413, `${label}数量超过安全统计上限，请缩短统计窗口`, 'PAYLOAD_TOO_LARGE');
  return docs;
}

function metrics(): PerformanceMetrics {
  return { sent: 0, replied: 0, interested: 0, quoted: 0, won: 0, unsubscribed: 0, bounced: 0 };
}

function rate(numerator: number, denominator: number): PerformanceRate {
  return { numerator, denominator, rate: denominator ? numerator / denominator : null };
}

/** A customer is counted once per stage per immutable template snapshot (not once per event/mail). */
export async function getTemplatePerformanceSummary(
  windowDays: PerformanceWindowDays,
  actor?: AuthUser,
  sampleThreshold = 5,
): Promise<TemplatePerformanceSummary> {
  if (windowDays !== 30 && windowDays !== 90 && windowDays !== 180) throw ApiError.badRequest('统计窗口只能为 30、90 或 180 天');
  if (!Number.isSafeInteger(sampleThreshold) || sampleThreshold < 1 || sampleThreshold > MAX_THRESHOLD) {
    throw ApiError.badRequest('样本门槛必须为 1 至 10000 的安全整数');
  }
  const projectId = requireProjectId(actor);
  // The middleware normally verifies the project, but direct service callers cannot
  // claim an inaccessible project. Administrators may access any active project.
  if (!actor?.id || !Types.ObjectId.isValid(actor.id) ||
    !await Project.exists({ _id: projectId, status: 'active' }) ||
    !await User.exists({ _id: new Types.ObjectId(actor.id), status: 'active',
      ...(actor.role === 'admin' ? {} : { projectIds: projectId }) })) {
    throw ApiError.notFound('项目不存在或无权访问');
  }
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 86400000);
  const window = { $gte: windowStart, $lte: windowEnd };
  // Performance is a project aggregate (not a personal inbox). Every actor in the project
  // sees the same denominator; never accept a caller-supplied project id.
  const customers = bounded(await Customer.find({ projectId }).select('_id status').limit(MAX_DOCUMENTS + 1).lean() as ScopedCustomer[], '客户');
  const customerIds = customers.map((customer) => customer._id);
  const empty: TemplatePerformanceSummary = { windowDays, windowStart, windowEnd, sampleThreshold, unattributed: 0, correlationDisclaimer: DISCLAIMER, templates: [] };
  if (!customerIds.length) return empty;
  const refs = { projectId, customerId: { $in: customerIds } };
  const letters = bounded(await DevelopmentLetter.find({ ...refs, status: { $in: ['sent', 'opened'] }, sentAt: window })
    .select('_id customerId sentAt templateId templateNameSnapshot templateContentHash').limit(MAX_DOCUMENTS + 1).lean() as SentLetter[], '开发信');
  if (!letters.length) return empty;

  const [mails, followUps, quotations, events, otherOutbound] = await Promise.all([
    MailMessage.find({ ...refs, deleted: { $ne: true }, sentAt: window }).select('customerId sentAt from subject text threadId').limit(MAX_DOCUMENTS + 1).lean(),
    FollowUp.find({ ...refs, followUpAt: window, result: 'interested' }).select('customerId followUpAt result').limit(MAX_DOCUMENTS + 1).lean(),
    Quotation.find({ ...refs, createdAt: window }).select('customerId createdAt').limit(MAX_DOCUMENTS + 1).lean(),
    CustomerEvent.find({ ...refs, type: 'status_changed', at: window, toStatus: { $in: ['interested', 'won', 'lost'] } })
      .select('customerId at toStatus').limit(MAX_DOCUMENTS + 1).lean(),
    DevelopmentLetter.find({ ...refs, status: { $in: ['sent', 'opened'] }, sentAt: window, threadId: { $exists: true } })
      .select('customerId sentAt threadId templateId templateNameSnapshot templateContentHash').limit(MAX_DOCUMENTS + 1).lean(),
  ]);
  bounded(mails, '来信'); bounded(followUps, '跟进'); bounded(quotations, '报价'); bounded(events, '状态事件'); bounded(otherOutbound, '对照发信');
  const byCustomer = <T extends { customerId: Id | null }>(docs: T[]): Map<string, T[]> => {
    const result = new Map<string, T[]>();
    for (const doc of docs) {
      if (!doc.customerId) continue;
      const key = String(doc.customerId);
      const list = result.get(key) ?? [];
      list.push(doc);
      result.set(key, list);
    }
    return result;
  };
  const mailsByCustomer = byCustomer(mails as Mail[]);
  const followsByCustomer = byCustomer(followUps as Follow[]);
  const quotesByCustomer = byCustomer(quotations as Quote[]);
  const eventsByCustomer = byCustomer(events as Event[]);
  const outboundThreads = new Map<string, Date>();
  for (const outbound of otherOutbound as { customerId: Id; sentAt: Date; threadId?: string; templateId?: Id; templateNameSnapshot?: string; templateContentHash?: string }[]) {
    if (!outbound.threadId || !outbound.templateId || !outbound.templateNameSnapshot || !outbound.templateContentHash) continue;
    const key = JSON.stringify([String(outbound.customerId), outbound.threadId, String(outbound.templateId), outbound.templateNameSnapshot, outbound.templateContentHash]);
    const previous = outboundThreads.get(key);
    if (!previous || outbound.sentAt < previous) outboundThreads.set(key, outbound.sentAt);
  }
  const customersById = new Map(customers.map((customer) => [String(customer._id), customer]));
  type Accumulator = { templateId: string; templateNameSnapshot: string; templateContentHash: string; metrics: PerformanceMetrics; recipients: Map<string, Date> };
  const groups = new Map<string, Accumulator>();
  let unattributed = 0;
  for (const letter of letters) {
    // Complete server-verified snapshot required. Legacy/partial records remain unattributed;
    // never infer a template name or version from a mutable live template.
    if (!letter.templateId || !letter.templateNameSnapshot || !letter.templateContentHash) { unattributed++; continue; }
    const templateId = String(letter.templateId);
    const name = letter.templateNameSnapshot ?? '';
    const hash = letter.templateContentHash ?? '';
    const key = JSON.stringify([templateId, name, hash]);
    let group = groups.get(key);
    if (!group) {
      group = { templateId, templateNameSnapshot: name, templateContentHash: hash, metrics: metrics(), recipients: new Map() };
      groups.set(key, group);
    }
    group.metrics.sent++;
    const customerId = String(letter.customerId);
    const prior = group.recipients.get(customerId);
    if (!prior || letter.sentAt < prior) group.recipients.set(customerId, letter.sentAt);
  }
  const templateIds = [...new Set([...groups.values()].map((group) => group.templateId))];
  const existing = templateIds.length ? await LetterTemplate.find({ projectId, _id: { $in: templateIds } }).select('_id').limit(MAX_DOCUMENTS + 1).lean() : [];
  bounded(existing, '模板');
  const existingIds = new Set(existing.map((doc) => String(doc._id)));
  const templates = [...groups.values()].map((group): TemplatePerformanceGroup => {
    for (const [customerId, earliestSend] of group.recipients) {
      const afterSend = (at: Date) => at >= earliestSend && at <= windowEnd;
      const customerMails = (mailsByCustomer.get(customerId) ?? []).filter((mail) => afterSend(mail.sentAt));
      // Genuine replies require a confirmed template send in the same thread; unrelated
      // inbound messages cannot silently become a template reply. Other stages remain
      // project/customer time correlations, not proof of delivery or causation.
      if (customerMails.some((mail) => mail.threadId &&
          (outboundThreads.get(JSON.stringify([customerId, mail.threadId, group.templateId, group.templateNameSnapshot, group.templateContentHash])) ?? Infinity) <= mail.sentAt &&
          detectProtectedMailSignal({ from: mail.from, subject: mail.subject, text: mail.text }).classification === 'normal')) group.metrics.replied++;
      const mailSignals = customerMails.map((mail) => detectProtectedMailSignal({ from: mail.from, subject: mail.subject, text: mail.text }).classification);
      if (mailSignals.includes('unsubscribe')) group.metrics.unsubscribed++;
      if (mailSignals.includes('bounce')) group.metrics.bounced++;
      const customerEvents = (eventsByCustomer.get(customerId) ?? []).filter((event) => afterSend(event.at));
      if ((followsByCustomer.get(customerId) ?? []).some((follow) => afterSend(follow.followUpAt)) ||
        customerEvents.some((event) => event.toStatus === 'interested')) group.metrics.interested++;
      if ((quotesByCustomer.get(customerId) ?? []).some((quote) => afterSend(quote.createdAt))) group.metrics.quoted++;
      const customer = customersById.get(customerId);
      // A current win alone cannot establish when it occurred. Require a recorded win after
      // this template was sent; a later loss (or any current non-won state) removes the association.
      if (customer?.status === 'won' && customerEvents.some((event) => event.toStatus === 'won')) group.metrics.won++;
    }
    const sampleSize = group.recipients.size;
    const rates = {} as PerformanceRates;
    for (const stage of STAGES) rates[stage] = rate(group.metrics[stage], sampleSize);
    return { templateId: group.templateId, templateNameSnapshot: group.templateNameSnapshot,
      templateContentHash: group.templateContentHash, deleted: !existingIds.has(group.templateId),
      metrics: group.metrics, rates, sampleSize, insufficientSample: sampleSize < sampleThreshold };
  });
  // Stable display order only, never a performance ranking—especially below the sample threshold.
  templates.sort((a, b) => a.templateId.localeCompare(b.templateId) ||
    a.templateContentHash.localeCompare(b.templateContentHash) || a.templateNameSnapshot.localeCompare(b.templateNameSnapshot));
  return { ...empty, unattributed, templates };
}
