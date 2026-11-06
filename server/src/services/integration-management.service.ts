import { Types } from 'mongoose';
import { INTEGRATION_SCOPES } from '../constants';
import { IntegrationCredential, IntegrationRequestLog, Project, User } from '../models';
import type { IntegrationCredentialDocument } from '../models';
import type { AuthUser } from '../types/express';
import { ApiError } from '../utils/ApiError';
import { credentialQuota } from './integration-credential.service';

export const GLOBALSITE_PRESET = ['products:read', 'company:read', 'playbook:read', 'knowledge:read', 'customers:upsert', 'inquiries:write', 'outcomes:read'];

/** Revalidate current roles and every bound project; never trust client projectIds. */
export async function managementScope(actor: AuthUser) {
  const user = await User.findById(actor.id).select('role status organizationId projectIds');
  if (!user || user.status !== 'active') throw ApiError.unauthorized();
  if (!['admin', 'project_admin'].includes(user.role)) throw ApiError.forbidden('仅项目管理员可管理集成连接');
  if (!user.organizationId || !actor.projectId || !Types.ObjectId.isValid(actor.projectId)) throw ApiError.notFound();
  const project = await Project.findOne({ _id: actor.projectId, organizationId: user.organizationId, status: 'active' });
  if (!project || user.role !== 'admin' && !user.projectIds.some(id => String(id) === actor.projectId)) throw ApiError.notFound();
  const allowed = await Project.find({ organizationId: user.organizationId, ...(user.role === 'admin' ? {} : { _id: { $in: user.projectIds } }) }).select('_id');
  return { organizationId: user.organizationId, projectId: project._id, allowed: allowed.map(p => p._id) };
}
export async function manageableCredential(actor: AuthUser, id: string) {
  const s = await managementScope(actor);
  const credential = await IntegrationCredential.findOne({ _id: id, organizationId: s.organizationId,
    projectIds: s.projectId, $expr: { $setIsSubset: ['$projectIds', s.allowed] } });
  if (!credential) throw ApiError.notFound('凭证不存在或无权访问');
  return credential;
}
export async function credentialDto(credential: IntegrationCredentialDocument) {
  const creator = credential.createdBy ? await User.findOne({ _id: credential.createdBy, organizationId: credential.organizationId }).select('_id displayName') : null;
  return {
    id: String(credential._id), name: credential.name, scopes: [...credential.scopes], projectCount: credential.projectIds.length,
    createdBy: creator ? { id: String(creator._id), displayName: creator.displayName } : null,
    createdAt: credential.createdAt.toISOString(), lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    expiresAt: credential.expiresAt?.toISOString() ?? null, previousValidUntil: credential.previousValidUntil?.toISOString() ?? null,
    status: credential.status === 'revoked' ? 'revoked' : credential.expiresAt && credential.expiresAt.getTime() <= Date.now() ? 'expired' : 'active',
  };
}
export async function managementSettings(actor: AuthUser) {
  const s = await managementScope(actor);
  return { scopes: INTEGRATION_SCOPES.map(name => ({ name, available: true })),
    globalsitePreset: GLOBALSITE_PRESET, quota: await credentialQuota(String(s.projectId), String(s.organizationId)) };
}
export async function listManagedCredentials(actor: AuthUser, page: number, limit: number) {
  const s = await managementScope(actor);
  const filter = { organizationId: s.organizationId, projectIds: s.projectId, $expr: { $setIsSubset: ['$projectIds', s.allowed] } };
  const [rows, total] = await Promise.all([
    IntegrationCredential.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    IntegrationCredential.countDocuments(filter),
  ]);
  return { items: await Promise.all(rows.map(credentialDto)), total, page, limit };
}
export async function listIntegrationLogs(actor: AuthUser, page: number, limit: number, credentialId?: string) {
  const s = await managementScope(actor);
  if (credentialId) await manageableCredential(actor, credentialId);
  const filter = { organizationId: s.organizationId, projectId: s.projectId,
    createdAt: { $gte: new Date(Date.now() - 30 * 86400_000) }, ...(credentialId ? { credentialId } : {}) };
  const [rows, total] = await Promise.all([
    IntegrationRequestLog.find(filter).select('_id createdAt method route statusCode latencyMs').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    IntegrationRequestLog.countDocuments(filter),
  ]);
  return { items: rows.map(r => ({ id: String(r._id), createdAt: r.createdAt.toISOString(), method: r.method,
    route: r.route.split('?')[0], statusCode: r.statusCode, latencyMs: r.latencyMs })), total, page, limit };
}
