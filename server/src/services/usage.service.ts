/**
 * Organization-level metering and invoice estimates.
 *
 * Emails are counted when an attempt reserves a mailbox slot; AI tokens are
 * counted when an agent run settles; storage is counted as a delta on upload
 * and deletion. Values are intentionally append-friendly and can later be
 * exported to Stripe / an accounting system without changing call sites.
 */
import { Types } from 'mongoose';
import { BillingInvoice, Organization, UsageRecord, type UsageMetric } from '../models';
import { PLAN_CATALOG, type OrganizationLimits, type OrganizationPlan } from '../constants/plans';
import { ApiError } from '../utils/ApiError';
import { currentOrganizationId } from '../models/tenant-context';

export function currentUsagePeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function organizationObjectId(organizationId?: string): Types.ObjectId | undefined {
  const value = organizationId || currentOrganizationId()?.toString();
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

export async function addUsage(metric: UsageMetric, amount: number, organizationId?: string): Promise<void> {
  const orgId = organizationObjectId(organizationId);
  if (!orgId || !Number.isFinite(amount) || amount === 0) return;
  const delta = Math.trunc(amount);
  await UsageRecord.updateOne(
    { organizationId: orgId, period: currentUsagePeriod(), metric },
    { $inc: { value: delta }, $setOnInsert: { organizationId: orgId, period: currentUsagePeriod(), metric } },
    { upsert: true },
  );
  // Storage deletions may make a month's delta negative; billing never goes
  // below zero for a metric.
  if (delta < 0) {
    await UsageRecord.updateOne({ organizationId: orgId, period: currentUsagePeriod(), metric, value: { $lt: 0 } }, { $set: { value: 0 } });
  }
}

export async function getUsage(organizationId?: string, period = currentUsagePeriod()): Promise<Record<UsageMetric, number>> {
  const orgId = organizationObjectId(organizationId);
  const result: Record<UsageMetric, number> = { emails: 0, ai_tokens: 0, storage_bytes: 0 };
  if (!orgId) return result;
  const records = await UsageRecord.find({ organizationId: orgId, period }).lean();
  for (const record of records) result[record.metric] = Math.max(0, Number(record.value) || 0);
  return result;
}

export async function assertUsageAvailable(
  metric: 'monthlyEmails' | 'monthlyAiTokens' | 'storageBytes',
  amount: number,
  organizationId?: string,
): Promise<void> {
  const orgId = organizationObjectId(organizationId);
  if (!orgId) return;
  const organization = await Organization.findById(orgId).select('limits plan name').lean();
  if (!organization) throw ApiError.unauthorized('组织不存在');
  const usage = await getUsage(orgId.toString());
  const used = metric === 'monthlyEmails' ? usage.emails : metric === 'monthlyAiTokens' ? usage.ai_tokens : usage.storage_bytes;
  const limit = organization.limits[metric];
  if (limit > 0 && used + Math.max(0, amount) > limit) {
    throw ApiError.tooManyRequests(`当前套餐额度已用完（${metric}: ${used}/${limit}），请升级套餐或联系平台管理员`);
  }
}

export interface UsageSummary {
  period: string;
  usage: Record<UsageMetric, number>;
  limits: OrganizationLimits;
  percentages: Record<UsageMetric, number>;
  plan: OrganizationPlan;
  planLabel: string;
  estimatedInvoiceUsd: number;
  currency: 'USD';
  periodEnd?: Date;
}

/** Compute the current month's list-price estimate, including overage. */
export async function getUsageSummary(organizationId?: string): Promise<UsageSummary> {
  const orgId = organizationObjectId(organizationId);
  if (!orgId) throw ApiError.badRequest('缺少组织上下文');
  const organization = await Organization.findById(orgId).lean();
  if (!organization) throw ApiError.notFound('组织不存在');
  const period = currentUsagePeriod();
  const usage = await getUsage(orgId.toString(), period);
  const plan = organization.plan as OrganizationPlan;
  const catalog = PLAN_CATALOG[plan];
  const limits = organization.limits;
  const overageEmails = Math.max(0, usage.emails - limits.monthlyEmails);
  const overageTokens = Math.max(0, usage.ai_tokens - limits.monthlyAiTokens);
  const overageStorage = Math.max(0, usage.storage_bytes - limits.storageBytes);
  const estimatedInvoiceUsd = Number((
    catalog.monthlyPriceUsd
    + (overageEmails / 1000) * catalog.overage.emailUsdPer1000
    + (overageTokens / 1_000_000) * catalog.overage.aiTokensUsdPer1M
    + (overageStorage / 1024 ** 3) * catalog.overage.storageUsdPerGb
  ).toFixed(2));
  return {
    period,
    usage,
    limits,
    percentages: {
      emails: limits.monthlyEmails ? Math.min(100, Math.round((usage.emails / limits.monthlyEmails) * 100)) : 0,
      ai_tokens: limits.monthlyAiTokens ? Math.min(100, Math.round((usage.ai_tokens / limits.monthlyAiTokens) * 100)) : 0,
      storage_bytes: limits.storageBytes ? Math.min(100, Math.round((usage.storage_bytes / limits.storageBytes) * 100)) : 0,
    },
    plan,
    planLabel: plan,
    estimatedInvoiceUsd,
    currency: 'USD',
    ...(organization.currentPeriodEnd ? { periodEnd: organization.currentPeriodEnd } : {}),
  };
}

/** Persist a draft invoice for a closed month; payment-gateway sync is external. */
export async function createInvoiceEstimate(organizationId: string, period = currentUsagePeriod()): Promise<Record<string, unknown>> {
  const orgId = organizationObjectId(organizationId);
  if (!orgId) throw ApiError.badRequest('组织 ID 格式不正确');
  const organization = await Organization.findById(orgId).lean();
  if (!organization) throw ApiError.notFound('组织不存在');
  const usage = await getUsage(orgId.toString(), period);
  const catalog = PLAN_CATALOG[organization.plan as OrganizationPlan];
  const overageEmails = Math.max(0, usage.emails - organization.limits.monthlyEmails);
  const overageTokens = Math.max(0, usage.ai_tokens - organization.limits.monthlyAiTokens);
  const overageStorage = Math.max(0, usage.storage_bytes - organization.limits.storageBytes);
  const lines = [
    { key: 'plan', description: `${catalog.id} plan`, quantity: 1, unitAmountUsd: catalog.monthlyPriceUsd, amountUsd: catalog.monthlyPriceUsd },
    ...(overageEmails ? [{ key: 'email_overage', description: 'Email overage', quantity: overageEmails, unitAmountUsd: catalog.overage.emailUsdPer1000 / 1000, amountUsd: Number(((overageEmails / 1000) * catalog.overage.emailUsdPer1000).toFixed(2)) }] : []),
    ...(overageTokens ? [{ key: 'ai_overage', description: 'AI token overage', quantity: overageTokens, unitAmountUsd: catalog.overage.aiTokensUsdPer1M / 1_000_000, amountUsd: Number(((overageTokens / 1_000_000) * catalog.overage.aiTokensUsdPer1M).toFixed(2)) }] : []),
    ...(overageStorage ? [{ key: 'storage_overage', description: 'Storage overage', quantity: overageStorage, unitAmountUsd: catalog.overage.storageUsdPerGb / 1024 ** 3, amountUsd: Number(((overageStorage / 1024 ** 3) * catalog.overage.storageUsdPerGb).toFixed(2)) }] : []),
  ];
  const subtotal = Number(lines.reduce((sum, line) => sum + line.amountUsd, 0).toFixed(2));
  const invoice = await BillingInvoice.findOneAndUpdate(
    { organizationId: orgId, period },
    { $set: { number: `INV-${period.replace('-', '')}-${orgId.toString().slice(-6)}`, status: 'draft', currency: 'USD', lines, subtotalUsd: subtotal, totalUsd: subtotal, dueAt: new Date(Date.now() + 15 * 86_400_000) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return invoice.toObject() as unknown as Record<string, unknown>;
}
