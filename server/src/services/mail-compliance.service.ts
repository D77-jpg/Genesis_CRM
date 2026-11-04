/**
 * Outbound email compliance primitives.
 *
 * Kept independent of nodemailer so the same rules can be used by the queue,
 * the unsubscribe endpoint and the admin diagnostics UI.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import { Types } from 'mongoose';
import { Customer, DevelopmentLetter, EmailSuppression, Project, type SuppressionReason } from '../models';
import { ApiError } from '../utils/ApiError';
import { currentOrganizationId } from '../models/tenant-context';

const TOKEN_VERSION = 1;
const GLOBAL_SCOPE = 'global';

export interface UnsubscribeTarget {
  projectId: string;
  email: string;
}

function scopeKey(projectId?: string): string {
  return projectId && Types.ObjectId.isValid(projectId) ? `project:${projectId}` : GLOBAL_SCOPE;
}

function tokenSecret(): string {
  // Reuse the application signing secret; the token is domain-separated by
  // the "unsubscribe:" prefix and never accepted as a login credential.
  return process.env.JWT_SECRET || 'genesis-crm-unsubscribe';
}

export function createUnsubscribeToken(projectId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ v: TOKEN_VERSION, p: projectId, e: email.trim().toLowerCase() })).toString('base64url');
  const signature = createHmac('sha256', tokenSecret()).update(`unsubscribe:${payload}`).digest('base64url').slice(0, 43);
  return `${payload}.${signature}`;
}

export function parseUnsubscribeToken(token: string): UnsubscribeTarget | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', tokenSecret()).update(`unsubscribe:${payload}`).digest('base64url').slice(0, 43);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      v?: number; p?: string; e?: string;
    };
    if (parsed.v !== TOKEN_VERSION || !parsed.p || !Types.ObjectId.isValid(parsed.p) || !parsed.e) return null;
    return { projectId: parsed.p, email: parsed.e.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function unsubscribeUrlFor(projectId: string, email: string): string {
  const token = createUnsubscribeToken(projectId, email);
  const base = (process.env.PUBLIC_BASE_URL || process.env.TRACKING_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
  return `${base}/api/unsubscribe/${token}`;
}

export function unsubscribeHeaders(projectId: string, email: string): Record<string, string> {
  const url = unsubscribeUrlFor(projectId, email);
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Append a visible, non-tracked opt-out footer to every outbound marketing mail. */
export function appendUnsubscribeFooter(html: string, text: string, projectId: string, email: string, includeHtml = true): { html: string; text: string } {
  if (!projectId || !email) return { html, text };
  const url = unsubscribeUrlFor(projectId, email);
  const escapedUrl = url.replace(/&/g, '&amp;');
  const footerHtml = `<div data-compliance="unsubscribe" style="margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280">`
    + `<p style="margin:0">You are receiving this business email because we believe it is relevant to your work. `
    + `<a href="${escapedUrl}" rel="unsubscribe" data-no-track style="color:#4b5563;text-decoration:underline">Unsubscribe</a> to stop future outreach.</p>`
    + `</div>`;
  const footerText = `\n\nYou are receiving this business email because we believe it is relevant to your work.\nUnsubscribe: ${url}`;
  if (html.includes('You are receiving this business email') || text.includes('You are receiving this business email')) {
    return { html, text };
  }
  if (!includeHtml) return { html, text: `${text}${footerText}` };
  return { html: `${html}${footerHtml}`, text: `${text}${footerText}` };
}

async function organizationForProject(projectId?: string): Promise<Types.ObjectId | undefined> {
  const fromContext = currentOrganizationId();
  if (fromContext) return fromContext;
  if (!projectId || !Types.ObjectId.isValid(projectId)) return undefined;
  const project = await Project.findById(projectId).select('organizationId').lean();
  return project?.organizationId as Types.ObjectId | undefined;
}

export async function isEmailSuppressed(projectId: string, email: string): Promise<EmailSuppressionDocumentLike | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const organizationId = await organizationForProject(projectId);
  return EmailSuppression.findOne({
    email: normalized,
    ...(organizationId ? { organizationId } : { organizationId: { $exists: false } }),
    $or: [{ scopeKey: scopeKey(projectId) }, { scopeKey: GLOBAL_SCOPE }],
  }).lean() as Promise<EmailSuppressionDocumentLike | null>;
}

export interface EmailSuppressionDocumentLike {
  _id: Types.ObjectId;
  email: string;
  reason: SuppressionReason;
  source: string;
  scopeKey: string;
  projectId?: Types.ObjectId;
  note?: string;
  createdAt: Date;
}

export async function suppressEmail(input: {
  projectId?: string;
  email: string;
  reason: SuppressionReason;
  source: 'link' | 'inbound' | 'smtp' | 'admin' | 'import';
  note?: string;
  createdBy?: string;
  global?: boolean;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  if (!input.global && (!input.projectId || !Types.ObjectId.isValid(input.projectId))) return;
  const key = input.global ? GLOBAL_SCOPE : scopeKey(input.projectId);
  const organizationId = await organizationForProject(input.projectId);
  await EmailSuppression.updateOne(
    { scopeKey: key, email, ...(organizationId ? { organizationId } : { organizationId: { $exists: false } }) },
    {
      $setOnInsert: {
        scopeKey: key,
        ...(organizationId ? { organizationId } : {}),
        ...(input.global ? {} : { projectId: new Types.ObjectId(input.projectId) }),
        email,
        reason: input.reason,
        source: input.source,
        ...(input.note ? { note: input.note.slice(0, 500) } : {}),
        ...(input.createdBy && Types.ObjectId.isValid(input.createdBy) ? { createdBy: new Types.ObjectId(input.createdBy) } : {}),
      },
    },
    { upsert: true },
  );
  // A global suppression still carries the project that observed the event so
  // that project's queued mail can be cancelled immediately. Other projects
  // are protected by the global scope at queue time.
  const projectId = input.projectId;
  if (projectId && Types.ObjectId.isValid(projectId)) {
    const pid = new Types.ObjectId(projectId);
    await Promise.all([
      Customer.updateMany(
        { projectId: pid, email },
        { $set: { outreachAbandonedAt: new Date(), nextFollowUpAt: null } },
      ),
      DevelopmentLetter.updateMany(
        { projectId: pid, recipientEmail: email, status: { $in: ['queued', 'scheduled', 'retrying'] } },
        { $set: { status: 'cancelled', error: `收件人已进入不再发送名单（${input.reason}），取消待发送邮件` } },
      ),
    ]);
  }
}

export async function listSuppressions(input: {
  projectId: string;
  search?: string;
  page: number;
  limit: number;
}): Promise<{ items: EmailSuppressionDocumentLike[]; total: number }> {
  const filter: Record<string, unknown> = {
    $or: [{ scopeKey: scopeKey(input.projectId) }, { scopeKey: GLOBAL_SCOPE }],
  };
  if (input.search?.trim()) {
    filter.email = new RegExp(input.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  const [items, total] = await Promise.all([
    EmailSuppression.find(filter).sort({ createdAt: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(),
    EmailSuppression.countDocuments(filter),
  ]);
  return { items: items as unknown as EmailSuppressionDocumentLike[], total };
}

export async function removeSuppression(projectId: string, id: string, actorIsAdmin: boolean): Promise<void> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('抑制记录不存在');
  const row = await EmailSuppression.findById(id).select('scopeKey projectId');
  if (!row) throw ApiError.notFound('抑制记录不存在');
  if (!actorIsAdmin && row.scopeKey !== scopeKey(projectId)) throw ApiError.notFound('抑制记录不存在');
  await EmailSuppression.deleteOne({ _id: id });
}

export interface DomainHealth {
  domain: string;
  selector: string;
  checkedAt: Date;
  spf: { status: 'ok' | 'missing' | 'warning' | 'error'; records: string[]; message: string };
  dkim: { status: 'ok' | 'missing' | 'warning' | 'error'; records: string[]; message: string };
  dmarc: { status: 'ok' | 'missing' | 'warning' | 'error'; records: string[]; message: string };
  overall: 'ok' | 'warning' | 'error';
}

async function txt(name: string): Promise<string[]> {
  try {
    const rows = await dns.resolveTxt(name);
    return rows.map((parts) => parts.join(''));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw error;
  }
}

/** Verify the DNS records a receiving mail server will evaluate. */
export async function checkDomainHealth(domain: string, selector = 'default'): Promise<DomainHealth> {
  const normalized = domain.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) throw ApiError.badRequest('域名格式不正确');
  const checkedAt = new Date();
  const result = (records: string[], predicate: (r: string) => boolean, label: string): DomainHealth['spf'] => {
    if (!records.length) return { status: 'missing', records: [], message: `未找到 ${label} 记录` };
    const matched = records.filter(predicate);
    return matched.length
      ? { status: 'ok', records: matched, message: `${label} 记录已找到` }
      : { status: 'warning', records, message: `${label} 记录存在但格式未通过检查` };
  };
  const [spfRecords, dmarcRecords, dkimRecords] = await Promise.all([
    txt(normalized),
    txt(`_dmarc.${normalized}`),
    txt(`${selector.trim() || 'default'}._domainkey.${normalized}`),
  ]);
  const spf = result(spfRecords, (record) => /^v=spf1(?:\s|$)/i.test(record), 'SPF');
  const dmarc = result(dmarcRecords, (record) => /^v=DMARC1(?:\s|;|$)/i.test(record), 'DMARC');
  const dkim = result(dkimRecords, (record) => /v=DKIM1|(?:^|;)\s*p=/i.test(record), 'DKIM');
  const overall = [spf, dkim, dmarc].some((item) => item.status === 'error')
    ? 'error'
    : [spf, dkim, dmarc].every((item) => item.status === 'ok') ? 'ok' : 'warning';
  return { domain: normalized, selector: selector.trim() || 'default', checkedAt, spf, dkim, dmarc, overall };
}

/** Effective cap for one mailbox today, including optional warm-up ramp. */
export function effectiveDailyLimit(project: {
  mailCompliance?: { warmupEnabled?: boolean; warmupStartedAt?: Date; warmupStartLimit?: number; warmupDailyIncrement?: number; warmupMaxLimit?: number; dailySendLimit?: number };
} | null, accountLimit: number): { limit: number; warmup: boolean; reason?: string } {
  const settings = project?.mailCompliance;
  const projectLimit = Math.max(1, Number(settings?.dailySendLimit ?? 300));
  const base = Math.min(accountLimit, projectLimit);
  if (!settings?.warmupEnabled) return { limit: base, warmup: false };
  const start = settings.warmupStartedAt ? new Date(settings.warmupStartedAt).getTime() : Date.now();
  const days = Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
  const ramp = Math.max(1, Number(settings.warmupStartLimit ?? 20)) + days * Math.max(1, Number(settings.warmupDailyIncrement ?? 10));
  const cap = Math.min(base, Math.max(1, Number(settings.warmupMaxLimit ?? 200)), ramp);
  return { limit: cap, warmup: true, reason: `预热第 ${days + 1} 天，今日上限 ${cap} 封` };
}

export async function getProjectComplianceSettings(projectId: string): Promise<{
  warmupEnabled: boolean;
  warmupStartedAt?: Date;
  warmupStartLimit: number;
  warmupDailyIncrement: number;
  warmupMaxLimit: number;
  dailySendLimit: number;
  trackingEnabled: boolean;
}> {
  const project = await Project.findById(projectId).select('mailCompliance').lean();
  if (!project) throw ApiError.notFound('项目不存在');
  const s = project.mailCompliance;
  return {
    warmupEnabled: Boolean(s?.warmupEnabled),
    ...(s?.warmupStartedAt ? { warmupStartedAt: s.warmupStartedAt } : {}),
    warmupStartLimit: Number(s?.warmupStartLimit ?? 20),
    warmupDailyIncrement: Number(s?.warmupDailyIncrement ?? 10),
    warmupMaxLimit: Number(s?.warmupMaxLimit ?? 200),
    dailySendLimit: Number(s?.dailySendLimit ?? 300),
    trackingEnabled: s?.trackingEnabled !== false,
  };
}
