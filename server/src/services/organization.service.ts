/**
 * Organization (tenant) lifecycle and plan quota checks.
 *
 * The current request's organization is resolved by auth middleware and is
 * also available through the Mongoose tenant context. Platform administrators
 * use the explicit `organizationId` argument to inspect another tenant.
 */
import mongoose, { Types } from 'mongoose';
import env from '../config/env';
import { ApiError } from '../utils/ApiError';
import { AgentAiProvider, AgentAiSettings, BillingInvoice, EmailSuppression, Organization, Project, User, type IOrganization, type OrganizationDocument } from '../models';
import { limitsForPlan, type OrganizationLimits, type OrganizationPlan } from '../constants/plans';
import type { AuthUser } from '../types/express';
import { getTenantContext } from '../models/tenant-context';

export const DEFAULT_ORGANIZATION_SLUG = env.DEFAULT_ORGANIZATION_SLUG || 'default';

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  status: IOrganization['status'];
  plan: OrganizationPlan;
  limits: OrganizationLimits;
  billingEmail?: string;
  billingAddress?: string;
  taxId?: string;
  currency: string;
  locale: 'zh' | 'en';
  subscriptionStatus: IOrganization['subscriptionStatus'];
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: Date;
  createdAt: Date;
}

export function toOrganizationDto(doc: OrganizationDocument | (IOrganization & { _id: Types.ObjectId })): OrganizationDto {
  return {
    id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    status: doc.status,
    plan: doc.plan,
    limits: doc.limits,
    ...(doc.billingEmail ? { billingEmail: doc.billingEmail } : {}),
    ...(doc.billingAddress ? { billingAddress: doc.billingAddress } : {}),
    ...(doc.taxId ? { taxId: doc.taxId } : {}),
    currency: doc.currency,
    locale: doc.locale,
    subscriptionStatus: doc.subscriptionStatus,
    currentPeriodStart: doc.currentPeriodStart,
    currentPeriodEnd: doc.currentPeriodEnd,
    cancelAtPeriodEnd: doc.cancelAtPeriodEnd,
    ...(doc.trialEndsAt ? { trialEndsAt: doc.trialEndsAt } : {}),
    createdAt: doc.createdAt,
  };
}

export function slugifyOrganization(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

/** Create/read the organization used by a single-tenant installation. */
export async function ensureDefaultOrganization(): Promise<OrganizationDocument> {
  const slug = DEFAULT_ORGANIZATION_SLUG;
  let organization = await Organization.findOne({ slug });
  if (!organization) {
    organization = await Organization.create({
      name: env.DEFAULT_ORGANIZATION_NAME || 'Default Organization',
      slug,
      plan: 'enterprise',
      limits: limitsForPlan('enterprise'),
      billingEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || undefined,
      subscriptionStatus: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
    });
  }
  return organization;
}

/**
 * Backfill the tenant key for installations created before P2. The operation
 * is idempotent and only touches documents missing organizationId.
 */
export async function migrateLegacyTenantData(): Promise<void> {
  const organization = await ensureDefaultOrganization();
  const organizationId = organization._id;
  await Promise.all([
    Project.updateMany({ organizationId: { $exists: false } }, { $set: { organizationId } }),
    User.updateMany({ organizationId: { $exists: false } }, { $set: { organizationId } }),
  ]);

  // Models that are not project-scoped still get a tenant key so global
  // settings and audit records remain isolated.
  const names = mongoose.modelNames().filter((name) => name !== 'Organization');
  for (const name of names) {
    const model = mongoose.model(name);
    if (!model.schema.path('organizationId')) continue;
    await model.updateMany({ organizationId: { $exists: false } }, { $set: { organizationId } });
  }
  // The pre-P2 suppression index was global; the tenant-aware index now
  // includes organizationId. Dropping the old index is idempotent.
  for (const [model, names] of [
    [EmailSuppression, ['scopeKey_1_email_1']],
    [Project, ['slug_1', 'code_1']],
    [AgentAiSettings, ['key_1']],
    [AgentAiProvider, ['name_1']],
  ] as const) {
    for (const name of names) {
      try {
        await model.collection.dropIndex(name);
      } catch {
        // Index absent or already migrated.
      }
    }
  }
}

/** Resolve the active organization for a request, falling back for legacy data. */
export async function resolveOrganization(actor: AuthUser): Promise<OrganizationDocument> {
  const context = getTenantContext();
  const id = actor.organizationId || context?.organizationId;
  if (id && Types.ObjectId.isValid(id)) {
    const organization = await Organization.findById(id);
    if (!organization) throw ApiError.unauthorized('组织不存在，请联系平台管理员');
    if (organization.status === 'suspended') throw ApiError.forbidden('组织已暂停，请联系平台管理员');
    return organization;
  }
  return ensureDefaultOrganization();
}

export async function getOrganizationById(id: string): Promise<OrganizationDocument> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('组织 ID 格式不正确');
  const organization = await Organization.findById(id);
  if (!organization) throw ApiError.notFound('组织不存在');
  return organization;
}

export async function listOrganizations(): Promise<OrganizationDto[]> {
  const docs = await Organization.find({}).sort({ createdAt: 1 });
  return docs.map(toOrganizationDto);
}

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
  plan?: OrganizationPlan;
  billingEmail?: string;
  adminUsername: string;
  adminPassword: string;
  adminDisplayName?: string;
  adminEmail?: string;
}

/** Platform-only provisioning: organization + its first organization admin. */
export async function createOrganization(input: CreateOrganizationInput, actor: AuthUser): Promise<OrganizationDto> {
  if (!actor.isPlatformAdmin) throw ApiError.forbidden('只有平台管理员可以创建组织');
  const slug = slugifyOrganization(input.slug || input.name);
  if (!slug) throw ApiError.badRequest('组织标识不能为空');
  if (await Organization.exists({ slug })) throw ApiError.conflict('组织标识已存在');
  const username = input.adminUsername.trim().toLowerCase();
  if (await User.exists({ username })) throw ApiError.conflict('管理员用户名已存在');
  const plan = input.plan ?? 'starter';
  const organization = await Organization.create({
    name: input.name.trim(),
    slug,
    plan,
    limits: limitsForPlan(plan),
    billingEmail: input.billingEmail?.trim().toLowerCase() || undefined,
    subscriptionStatus: plan === 'starter' ? 'trialing' : 'active',
    trialEndsAt: plan === 'starter' ? new Date(Date.now() + 14 * 86_400_000) : undefined,
    createdBy: new Types.ObjectId(actor.id),
  });
  const { hashPassword } = await import('../models/User');
  await User.create({
    organizationId: organization._id,
    username,
    passwordHash: await hashPassword(input.adminPassword),
    displayName: input.adminDisplayName?.trim() || username,
    email: input.adminEmail?.trim().toLowerCase() || undefined,
    role: 'admin',
    projectIds: [],
  });
  return toOrganizationDto(organization);
}

export interface UpdateOrganizationInput {
  name?: string;
  billingEmail?: string;
  billingAddress?: string;
  taxId?: string;
  currency?: string;
  locale?: 'zh' | 'en';
  status?: IOrganization['status'];
  plan?: OrganizationPlan;
  limits?: Partial<OrganizationLimits>;
}

/** Organization admins update their own profile; platform admins may update any tenant. */
export async function updateOrganization(
  organizationId: string,
  input: UpdateOrganizationInput,
  actor: AuthUser,
): Promise<OrganizationDto> {
  if (!actor.isPlatformAdmin) {
    const own = actor.organizationId || getTenantContext()?.organizationId;
    if (!own || own !== organizationId) throw ApiError.forbidden('无权修改该组织');
    if (input.status || input.plan || input.limits) throw ApiError.forbidden('套餐和配额只能由平台管理员修改');
  }
  const update: Record<string, unknown> = {};
  for (const key of ['name', 'billingEmail', 'billingAddress', 'taxId', 'currency', 'locale', 'status', 'plan'] as const) {
    if (input[key] !== undefined) update[key] = input[key];
  }
  if (input.plan) update.limits = limitsForPlan(input.plan);
  if (input.limits) update.limits = { ...(input.limits as OrganizationLimits) };
  update.updatedAt = new Date();
  const updated = await Organization.findByIdAndUpdate(organizationId, { $set: update }, { new: true, runValidators: true });
  if (!updated) throw ApiError.notFound('组织不存在');
  return toOrganizationDto(updated);
}

export async function assertOrganizationCapacity(metric: 'users' | 'projects'): Promise<void> {
  const organization = await resolveOrganization({ id: '', username: '', displayName: '', role: 'user' } as AuthUser);
  const limit = organization.limits[metric];
  const model = metric === 'users' ? User : Project;
  const filter = metric === 'users' ? { status: { $ne: 'disabled' } } : { status: 'active' };
  const used = await model.countDocuments(filter);
  if (used >= limit) {
    throw ApiError.forbidden(`当前套餐的${metric === 'users' ? '用户' : '项目'}额度已用完（${limit}）`);
  }
}

export async function assertPlanQuota(metric: 'monthlyEmails' | 'monthlyAiTokens' | 'storageBytes', amount = 0): Promise<void> {
  const contextOrg = getTenantContext()?.organizationId;
  if (!contextOrg) return;
  const organization = await getOrganizationById(contextOrg);
  if (organization.limits[metric] > 0 && amount > organization.limits[metric]) {
    throw ApiError.forbidden(`当前套餐额度不足：${metric}`);
  }
}

export async function getBillingSummary(organizationId: string): Promise<{
  organization: OrganizationDto;
  invoice?: Record<string, unknown>;
}> {
  const organization = await getOrganizationById(organizationId);
  const invoice = await BillingInvoice.findOne({ organizationId: new Types.ObjectId(organizationId) }).sort({ period: -1 });
  return { organization: toOrganizationDto(organization), ...(invoice ? { invoice: invoice.toObject() as unknown as Record<string, unknown> } : {}) };
}
