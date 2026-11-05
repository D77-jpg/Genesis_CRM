/**
 * Shared CLI/UI credential service. Tokens exist only in returned memory;
 * persistence and audit contain hashes/identifiers only.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import type { Request } from 'express';
import { INTEGRATION_SCOPES, type IntegrationScope } from '../constants';
import { integrationCredentialLimit } from '../constants/plans';
import { ApiError } from '../utils/ApiError';
import { IntegrationCredential, Organization, Project, type IntegrationCredentialDocument } from '../models';
import { runWithTenant } from '../models/tenant-context';
import type { AuthUser } from '../types/express';
import { recordAudit } from './audit.service';

export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function generateToken(): string { return 'gci_' + randomBytes(24).toString('hex'); }
export interface CredentialOperation { actor?: AuthUser; request?: Request }
export interface CreateCredentialInput {
  name: string; projectIds: string[]; scopes: string[]; expiresAt?: Date | null; note?: string; createdBy?: string;
}
export interface CreatedCredential { credential: IntegrationCredentialDocument; token: string }

function assertValidScopes(scopes: string[]): IntegrationScope[] {
  if (!scopes.length || scopes.length > INTEGRATION_SCOPES.length || scopes.some(s => !(INTEGRATION_SCOPES as readonly string[]).includes(s))) {
    throw ApiError.badRequest('非法集成权限');
  }
  return [...new Set(scopes)] as IntegrationScope[];
}
const activeAt = (now: Date) => ({ status: 'active', $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });
const rawAccounting = <T>(fn: () => T) => runWithTenant({ bypass: true, source: 'credential-quota-accounting' }, fn);
const accountingOrganization = (id: string) => ({ $or: [{ organizationId: new Types.ObjectId(id) }, { organizationId: { $exists: false } }] });

export async function credentialQuota(projectId: string, organizationId: string) {
  const org = await Organization.findById(organizationId).select('plan limits status');
  if (!org || org.status === 'suspended') throw ApiError.forbidden('组织不可用');
  const limit = org.limits.integrationCredentialsPerProject ?? integrationCredentialLimit(org.plan);
  // Legacy CLI-created records may not have organizationId. Count them only by
  // this already-authorized project, never expose their tokens or other projects.
  const filter = { projectIds: new Types.ObjectId(projectId), $and: [activeAt(new Date(Date.now())), accountingOrganization(organizationId)] };
  const used = await rawAccounting(() => IntegrationCredential.countDocuments(filter));
  return { limit, used };
}

async function auditCredential(action: 'create' | 'rotate' | 'revoke', credential: IntegrationCredentialDocument, operation?: CredentialOperation, detail: Record<string, unknown> = {}) {
  for (const projectId of credential.projectIds.map(String)) await recordAudit({
    actor: operation?.actor ?? { username: 'integration-cli' },
    action: ('integration.credential.' + action) as 'integration.credential.create',
    projectId, targetType: 'integrationCredential', targetId: String(credential._id),
    request: operation?.request, detail: { ...detail, scopes: [...credential.scopes] },
  });
}

export async function createCredential(input: CreateCredentialInput, operation?: CredentialOperation): Promise<CreatedCredential> {
  const scopes = assertValidScopes(input.scopes);
  if (!input.name.trim() || input.name.trim().length > 120) throw ApiError.badRequest('凭证名称不合法');
  if (input.expiresAt && (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now())) throw ApiError.badRequest('到期时间必须晚于现在');
  const ids = [...new Set(input.projectIds)];
  if (!ids.length || ids.length > 100 || ids.some(id => !/^[a-f\d]{24}$/i.test(id))) throw ApiError.badRequest('非法项目 ID');
  const projects = await Project.find({ _id: { $in: ids } }).select('_id organizationId');
  if (projects.length !== ids.length) throw ApiError.badRequest('项目不存在');
  const orgs = [...new Set(projects.map(p => p.organizationId ? String(p.organizationId) : ''))];
  if (orgs.length !== 1) throw ApiError.badRequest('凭证不能跨组织绑定');
  const organizationId = orgs[0] || undefined;
  const token = generateToken();
  const base = {
    name: input.name.trim(), tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12),
    scopes, projectIds: projects.map(p => p._id), status: 'active' as const,
    expiresAt: input.expiresAt ?? null, note: input.note,
    createdBy: input.createdBy ? new Types.ObjectId(input.createdBy) : undefined,
    ...(organizationId ? { organizationId: new Types.ObjectId(organizationId) } : {}),
  };
  // Unowned historical projects retain privileged script compatibility. The
  // customer-facing management API rejects them before reaching this service.
  if (!organizationId) {
    const credential = await IntegrationCredential.create(base);
    await auditCredential('create', credential, operation);
    return { credential, token };
  }
  const org = await Organization.findById(organizationId).select('plan limits status');
  if (!org || org.status === 'suspended') throw ApiError.forbidden('组织不可用');
  const limit = org.limits.integrationCredentialsPerProject ?? integrationCredentialLimit(org.plan);
  for (let attempt = 0; attempt < 64; attempt++) {
    const now = new Date(Date.now());
    // Expiry releases unique seats without changing historical public status.
    await rawAccounting(() => IntegrationCredential.updateMany({
      projectIds: { $in: projects.map(p => p._id) }, status: 'active', quotaEnabled: true, expiresAt: { $lte: now },
      $and: [accountingOrganization(organizationId)],
    }, { $set: { quotaEnabled: false } }));
    const seatKeys: string[] = [];
    for (const project of projects) {
      const existing = await rawAccounting(() => IntegrationCredential.find({ projectIds: project._id,
        $and: [activeAt(now), accountingOrganization(organizationId)] }).select('_id +seatKeys').lean());
      if (existing.length >= limit) throw new ApiError(409, '当前项目的凭证数量已达套餐上限', 'CONFLICT', [{ reason: 'CREDENTIAL_LIMIT', limit, used: existing.length }]);
      const prefix = organizationId + ':' + String(project._id) + ':';
      const occupied = new Set(existing.flatMap(c => c.seatKeys ?? []));
      const legacy = existing.filter(c => !c.seatKeys?.some(k => k.startsWith(prefix))).length;
      const available = Array.from({ length: limit }, (_, i) => prefix + i).slice(legacy).find(k => !occupied.has(k));
      if (!available) throw new ApiError(409, '当前项目的凭证数量已达套餐上限', 'CONFLICT', [{ reason: 'CREDENTIAL_LIMIT', limit, used: existing.length }]);
      seatKeys.push(available);
    }
    try {
      const credential = await IntegrationCredential.create({ ...base, quotaEnabled: true, seatKeys });
      await auditCredential('create', credential, operation);
      return { credential, token };
    } catch (error) {
      // A unique multikey index atomically reserves every project's seat in the
      // credential insert itself. Concurrent losers re-read, never oversubscribe.
      if ((error as { code?: number; keyPattern?: Record<string, unknown> }).code !== 11000
        || !(error as { keyPattern?: Record<string, unknown> }).keyPattern?.seatKeys) throw error;
    }
  }
  throw ApiError.conflict('凭证创建繁忙，请刷新后重试');
}

/** Same credential id retains project binding, idempotency and rate-limit identity. */
export async function rotateCredential(id: string, graceSeconds = 0, operation?: CredentialOperation): Promise<CreatedCredential> {
  if (!Number.isInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 604800) throw ApiError.badRequest('宽限时间不合法');
  const credential = await IntegrationCredential.findById(id).select('+tokenHash +previousTokenHash');
  if (!credential) throw ApiError.notFound('凭证不存在');
  if (credential.status !== 'active' || (credential.expiresAt && credential.expiresAt.getTime() <= Date.now())) throw ApiError.conflict('凭证已失效，不能轮换');
  if (graceSeconds > 0 && credential.previousValidUntil && credential.previousValidUntil.getTime() > Date.now()) {
    throw new ApiError(409, '上次轮换仍处于宽限期', 'CONFLICT', [{ reason: 'ROTATION_IN_PROGRESS' }]);
  }
  const token = generateToken();
  const previousValidUntil = graceSeconds ? new Date(Math.min(Date.now() + graceSeconds * 1000, credential.expiresAt?.getTime() ?? Infinity)) : null;
  const updated = await IntegrationCredential.findOneAndUpdate(
    { _id: credential._id, status: 'active', tokenHash: credential.tokenHash },
    { $set: { tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12),
      previousTokenHash: previousValidUntil ? credential.tokenHash : null, previousValidUntil } },
    { new: true },
  );
  if (!updated) throw ApiError.conflict('凭证已发生变化，请刷新后重试');
  await auditCredential('rotate', updated, operation, { graceSeconds, previousValidUntil: previousValidUntil?.toISOString() ?? null });
  return { credential: updated, token };
}

export async function revokeCredential(id: string, operation?: CredentialOperation): Promise<IntegrationCredentialDocument> {
  const credential = await IntegrationCredential.findOneAndUpdate({ _id: id },
    { $set: { status: 'revoked', previousTokenHash: null, previousValidUntil: null, quotaEnabled: false } }, { new: true });
  if (!credential) throw ApiError.notFound('凭证不存在');
  await auditCredential('revoke', credential, operation);
  return credential;
}

export interface VerifiedCredential { id: string; scopes: string[]; projectIds: string[] }
export async function verifyToken(token: string): Promise<VerifiedCredential | null> {
  if (!/^gci_[a-f0-9]{48}$/.test(token)) return null;
  const hash = hashToken(token), now = new Date(Date.now());
  const credential = await IntegrationCredential.findOne({ status: 'active', $or: [
    { tokenHash: hash }, { previousTokenHash: hash, previousValidUntil: { $gt: now } },
  ] }).select('+tokenHash +previousTokenHash');
  if (!credential || (credential.expiresAt && credential.expiresAt <= now)) return null;
  const expected = credential.tokenHash === hash ? credential.tokenHash
    : credential.previousValidUntil && credential.previousValidUntil > now ? credential.previousTokenHash : null;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hash, 'hex'))) return null;
  if (!credential.lastUsedAt || now.getTime() - credential.lastUsedAt.getTime() > 60_000) {
    void IntegrationCredential.updateOne({ _id: credential._id }, { $set: { lastUsedAt: now } }).catch(() => undefined);
  }
  return { id: String(credential._id), scopes: credential.scopes, projectIds: credential.projectIds.map(String) };
}
