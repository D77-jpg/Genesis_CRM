/**
 * 用户管理请求校验
 * ------------------------------------------------------------------
 * 仅管理员可用：创建 / 编辑资料 / 重置密码 / 停用启用，用户名规则与 User 模型保持一致。
 */
import { z } from 'zod';

/** 用户名：字母 / 数字 / . _ -，3-40 位，统一转小写（与 User 模型 username 约束一致） */
const usernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少 3 个字符')
  .max(40, '用户名最多 40 个字符')
  .regex(/^[a-zA-Z0-9._-]+$/, '用户名只能包含字母、数字、点、下划线、连字符')
  .transform((v) => v.toLowerCase());

export const createUserSchema = z.object({
  username: usernameSchema,
  /** 明文密码，服务端 bcrypt 加密后存储；bcrypt 上限 72 字节 */
  password: z.string().min(6, '密码至少 6 位').max(72, '密码最多 72 位'),
  displayName: z.string().trim().max(80, '显示名最多 80 个字符').optional(),
  /** 角色：admin 管理员 / user 业务员，默认业务员 */
  role: z.enum(['admin', 'user']).default('user'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** 编辑用户资料：显示名 / 角色（用户名、密码不在此改），至少提供一个字段 */
export const updateUserSchema = z
  .object({
    displayName: z.string().trim().max(80, '显示名最多 80 个字符').optional(),
    role: z.enum(['admin', 'user']).optional(),
  })
  .refine((data) => data.displayName !== undefined || data.role !== undefined, {
    message: '至少提供要修改的字段（displayName 或 role）',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** 重置密码：管理员为指定账号设置新密码，服务端 bcrypt 重新哈希 */
export const resetPasswordSchema = z.object({
  password: z.string().min(6, '密码至少 6 位').max(72, '密码最多 72 位'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** 停用 / 启用账号 */
export const setUserStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
