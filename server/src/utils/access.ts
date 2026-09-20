/**
 * 数据访问控制（严格分配制）
 * ------------------------------------------------------------------
 * 角色语义：
 *   admin —— 管理员，可见并可操作全部客户（含未分配）。
 *   user  —— 业务员，仅可见 / 操作「负责人是自己」的客户；未分配客户不可见。
 *
 * 本模块只提供纯权限判定与「过滤片段」，不感知具体业务：
 *   customerScope(actor)     -> 直接并入 Customer 查询的 filter
 *   assertCustomerAccess()   -> 单客户归属校验（越权一律 404，不泄露存在性）
 *   customerRefScope(actor)  -> 开发信 / 跟进记录等「按 customerId 关联」的从属资源范围
 */
import { Types } from 'mongoose';
import { Customer } from '../models';
import type { AuthUser } from '../types/express';
import { ApiError } from './ApiError';

/** 是否管理员；无 actor（理论上 requireAuth 后不会发生）按受限处理 */
export function isAdmin(user?: AuthUser | null): boolean {
  return user?.role === 'admin';
}

/** 当前业务请求的项目范围。没有项目上下文时返回永不命中的条件，默认拒绝。 */
export function projectScope(user?: AuthUser | null): Record<string, unknown> {
  if (!user?.projectId || !Types.ObjectId.isValid(user.projectId)) {
    return { projectId: new Types.ObjectId() };
  }
  return { projectId: new Types.ObjectId(user.projectId) };
}

export function requireProjectId(user?: AuthUser | null): Types.ObjectId {
  if (!user?.projectId || !Types.ObjectId.isValid(user.projectId)) {
    throw ApiError.notFound('项目不存在或无权访问');
  }
  return new Types.ObjectId(user.projectId);
}

/** 从 populate 前后两种形态里安全取出负责人 id 字符串 */
function ownerIdToString(ownerId: unknown): string {
  if (!ownerId) return '';
  if (typeof ownerId === 'object') {
    const ref = ownerId as { _id?: unknown };
    return ref._id ? String(ref._id) : '';
  }
  return String(ownerId);
}

/**
 * 客户集合的可见范围过滤片段。
 * 管理员返回空对象（不限制）；业务员返回 { ownerId: 自己 }，天然排除未分配与他人客户。
 */
export function customerScope(user?: AuthUser | null): Record<string, unknown> {
  const scope = projectScope(user);
  if (!user || isAdmin(user)) return scope;
  return { ...scope, ownerId: new Types.ObjectId(user.id) };
}

/**
 * 校验对单个客户的访问权：业务员访问非自己名下客户一律抛 404。
 * 用 404 而非 403，避免通过状态码差异探测他人客户是否存在。
 */
export function assertCustomerAccess(user: AuthUser | undefined | null, ownerId: unknown, projectId?: unknown): void {
  if (!user?.projectId || (projectId && String(projectId) !== user.projectId)) {
    throw ApiError.notFound('客户不存在或无权访问');
  }
  if (isAdmin(user)) return;
  if (ownerIdToString(ownerId) !== user.id) {
    throw ApiError.notFound('客户不存在或无权访问');
  }
}

/**
 * 业务员可见的客户 id 集合，供开发信 / 跟进记录等从属资源做范围过滤。
 * 返回 null 表示不限制（管理员）。
 */
export async function visibleCustomerIds(user?: AuthUser | null): Promise<Types.ObjectId[] | null> {
  if (!user?.projectId) return [];
  if (isAdmin(user)) return null;
  const docs = await Customer.find({ ...projectScope(user), ownerId: new Types.ObjectId(user.id) }).select('_id').lean();
  return (docs as unknown as { _id: Types.ObjectId }[]).map((d) => d._id);
}

/**
 * 「按 customerId 关联」的从属资源（开发信 / 跟进 / 事件）的可见范围过滤片段。
 * 管理员不限制；业务员限定 customerId ∈ 自己名下客户，无客户时返回永不命中的条件。
 */
export async function customerRefScope(user?: AuthUser | null): Promise<Record<string, unknown>> {
  const project = projectScope(user);
  const ids = await visibleCustomerIds(user);
  if (ids === null) return project;
  if (ids.length === 0) return { ...project, customerId: new Types.ObjectId() };
  return { ...project, customerId: { $in: ids } };
}
