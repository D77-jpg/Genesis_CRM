/**
 * 用户管理业务逻辑
 * ------------------------------------------------------------------
 * 严格分配制下，管理员通过这里创建业务员账号；账号即可作为客户「负责人」被分配。
 * 提供列表 / 创建 / 编辑资料 / 重置密码 / 停用启用 / 删除（硬删除，名下客户转为未分配）。
 * 涉及「让管理员失去权限」的操作（停用 / 删除 / 降级）受自我保护与「最后一个启用管理员」约束。
 */
import { Types } from 'mongoose';
import { Customer, Project, User, hashPassword, type UserDocument, type UserRole, type UserStatus } from '../models';
import { ApiError } from '../utils/ApiError';
import { createLogger } from '../config/logger';
import type { CreateUserInput, UpdateUserInput } from '../validators/user.validator';

const logger = createLogger('user-service');

/** 对外输出的用户 DTO：id 为字符串，绝不含 passwordHash */
export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  projectIds: string[];
  defaultProjectId?: string;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * lean() 结果转 DTO：_id → id。
 * passwordHash 在模型层 select:false，默认查询（含 lean）不会返回，故 rest 已是安全的对外字段。
 */
function toUserDto(doc: Record<string, unknown>): UserDto {
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: Types.ObjectId };
  // 旧数据可能没有 status 字段，统一回退为 active
  return { ...rest, id: _id.toString(), status: (rest.status as UserStatus) ?? 'active',
    projectIds: ((rest.projectIds as unknown[]) ?? []).map(String),
    defaultProjectId: rest.defaultProjectId ? String(rest.defaultProjectId) : undefined } as unknown as UserDto;
}

async function resolveProjectIds(values?: string[]): Promise<Types.ObjectId[]> {
  if (!values?.length) {
    const fallback = await Project.findOne({ status: 'active' }).sort({ isDefault: -1, createdAt: 1 }).select('_id');
    return fallback ? [fallback._id] : [];
  }
  const ids = [...new Set(values)].map((id) => new Types.ObjectId(id));
  const count = await Project.countDocuments({ _id: { $in: ids }, status: 'active' });
  if (count !== ids.length) throw ApiError.badRequest('包含不存在或已归档的项目');
  return ids;
}

/** 全部用户（管理员 + 业务员），按创建时间升序；用户管理列表与负责人下拉均可复用 */
export async function listUsers(): Promise<UserDto[]> {
  const docs = await User.find({}).sort({ createdAt: 1 }).lean();
  return (docs as unknown as Record<string, unknown>[]).map(toUserDto);
}

/** 创建用户：用户名查重 → bcrypt 加密 → 落库 */
export async function createUser(input: CreateUserInput): Promise<UserDto> {
  const username = input.username; // validator 已 trim + lowercase
  const existing = await User.findOne({ username });
  if (existing) {
    throw ApiError.conflict(`用户名「${username}」已存在`);
  }

  const passwordHash = await hashPassword(input.password);
  const projectIds = await resolveProjectIds(input.projectIds);
  if (input.role === 'user' && projectIds.length === 0) throw ApiError.badRequest('业务员至少需要加入一个项目');
  const user = await User.create({
    username,
    passwordHash,
    displayName: input.displayName?.trim() || username,
    role: input.role,
    projectIds,
    defaultProjectId: projectIds[0],
  });
  logger.info(`创建用户: ${user.username}（角色 ${user.role}）`);

  // 重新以 lean 读取，得到与列表一致、且不含敏感字段的干净结构
  const fresh = await User.findById(user._id).lean();
  return toUserDto(fresh as unknown as Record<string, unknown>);
}

/** 统计「启用中的管理员」数量，excludeId 用于排除即将被操作的目标（判断是否最后一个） */
async function countActiveAdmins(excludeId?: Types.ObjectId): Promise<number> {
  const filter: Record<string, unknown> = { role: 'admin', status: { $ne: 'disabled' } };
  if (excludeId) filter._id = { $ne: excludeId };
  return User.countDocuments(filter);
}

/**
 * 校验「会让某管理员失去权限」的操作（停用 / 删除 / 降级）是否被允许：
 * - 不能对当前登录的自己执行，避免把自己锁在门外；
 * - 不能对最后一个启用中的管理员执行，避免系统再无管理员可用。
 */
async function assertCanRevokeAdmin(actorId: string, target: UserDocument, action: string): Promise<void> {
  if (target._id.toString() === actorId) {
    throw ApiError.forbidden(`不能对当前登录的自己${action}`);
  }
  if (target.role === 'admin' && target.status !== 'disabled') {
    const remaining = await countActiveAdmins(target._id);
    if (remaining < 1) {
      throw ApiError.forbidden('系统必须保留至少一个启用中的管理员，无法执行此操作');
    }
  }
}

/** 按 id 取用户文档，不存在则 404 */
async function findUserOrThrow(targetId: string): Promise<UserDocument> {
  const target = await User.findById(targetId);
  if (!target) throw ApiError.notFound('用户不存在');
  return target as UserDocument;
}

/** 重新以 lean 读取并转 DTO，得到与列表一致、不含敏感字段的干净结构 */
async function toFreshDto(id: Types.ObjectId): Promise<UserDto> {
  const fresh = await User.findById(id).lean();
  return toUserDto(fresh as unknown as Record<string, unknown>);
}

/** 编辑用户资料：显示名 / 角色（用户名、密码不在此改）；管理员降级为业务员受保护 */
export async function updateUser(actorId: string, targetId: string, input: UpdateUserInput): Promise<UserDto> {
  const target = await findUserOrThrow(targetId);

  // admin → user 属于「降级」，会让其失去管理权限，套用与停用 / 删除相同的保护
  if (input.role === 'user' && target.role === 'admin') {
    await assertCanRevokeAdmin(actorId, target, '降级为业务员');
  }

  if (input.displayName !== undefined) {
    target.displayName = input.displayName.trim() || target.username;
  }
  if (input.role !== undefined) {
    target.role = input.role;
  }
  if (input.projectIds !== undefined) {
    const previous = target.projectIds.map(String);
    const next = await resolveProjectIds(input.projectIds);
    if ((input.role ?? target.role) === 'user' && next.length === 0) throw ApiError.badRequest('业务员至少需要加入一个项目');
    target.projectIds = next;
    if (!target.defaultProjectId || !next.some((id) => String(id) === String(target.defaultProjectId))) {
      target.defaultProjectId = next[0];
    }
    const removed = previous.filter((id) => !next.some((candidate) => String(candidate) === id)).map((id) => new Types.ObjectId(id));
    if (removed.length) await Customer.updateMany({ ownerId: target._id, projectId: { $in: removed } }, { $set: { ownerId: null } });
  }
  await target.save({ validateBeforeSave: false });
  logger.info(`更新用户资料: ${target.username}`);

  return toFreshDto(target._id);
}

/** 重置指定账号的密码（管理员操作，可含自己）：bcrypt 重新哈希后原子写入 */
export async function resetPassword(targetId: string, password: string): Promise<{ id: string }> {
  const passwordHash = await hashPassword(password);
  const result = await User.updateOne({ _id: targetId }, { $set: { passwordHash } });
  if (result.matchedCount === 0) throw ApiError.notFound('用户不存在');
  logger.info(`重置密码: userId=${targetId}`);
  return { id: targetId };
}

/** 停用 / 启用账号：停用后立即无法登录，且已签发 token 在 requireAuth 查库时失效 */
export async function setUserStatus(actorId: string, targetId: string, status: UserStatus): Promise<UserDto> {
  const target = await findUserOrThrow(targetId);

  if (status === 'disabled') {
    await assertCanRevokeAdmin(actorId, target, '停用');
  }

  target.status = status;
  await target.save({ validateBeforeSave: false });
  logger.info(`${status === 'disabled' ? '停用' : '启用'}用户: ${target.username}`);

  return toFreshDto(target._id);
}

/** 删除账号（硬删除）：名下客户 ownerId 置空转为「未分配」，回到管理员池后可重新分配 */
export async function deleteUser(
  actorId: string,
  targetId: string,
): Promise<{ id: string; reassignedCustomers: number }> {
  const target = await findUserOrThrow(targetId);

  await assertCanRevokeAdmin(actorId, target, '删除');

  // 先把名下客户转为未分配，避免遗留指向已删除用户的悬空归属（否则无法被「未分配」筛选捞回）
  const reassigned = await Customer.updateMany({ ownerId: target._id }, { $set: { ownerId: null } });
  await User.deleteOne({ _id: target._id });
  logger.info(`删除用户: ${target.username}（${reassigned.modifiedCount} 个客户转为未分配）`);

  return { id: targetId, reassignedCustomers: reassigned.modifiedCount };
}
