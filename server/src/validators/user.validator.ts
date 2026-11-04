/**
 * 用户管理请求校验
 * ------------------------------------------------------------------
 * 仅管理员可用：创建 / 编辑资料 / 重置密码 / 停用启用，用户名规则与 User 模型保持一致。
 */
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, passwordPolicyIssues } from '../utils/password-policy';
import { objectIdSchema } from './common';

/** Shared password rule for account creation, administrator resets and self-service reset. */
export const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 位`)
  .superRefine((value, ctx) => {
    for (const message of passwordPolicyIssues(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

/** Optional account email used by password reset and email OTP 2FA. */
const emailSchema = z
  .string()
  .trim()
  .max(200, '邮箱最多 200 个字符')
  .transform((v) => v.toLowerCase())
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: '邮箱格式不正确' });

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
  password: passwordSchema,
  displayName: z.string().trim().max(80, '显示名最多 80 个字符').optional(),
  email: emailSchema.optional(),
  /** 邮件 OTP 二次验证；开启时必须配置邮箱。 */
  twoFactorEnabled: z.boolean().default(false),
  /** 角色：admin 系统管理员 / project_admin 项目管理员 / user 销售 / viewer 只读 */
  role: z.enum(['admin', 'project_admin', 'user', 'viewer']).default('user'),
  /** 普通用户可进入的项目；不传时兼容旧客户端，自动分配默认项目。 */
  projectIds: z.array(objectIdSchema).max(100).optional(),
}).superRefine((data, ctx) => {
  if (data.twoFactorEnabled && !data.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: '开启 2FA 前请填写邮箱' });
  }
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** 编辑用户资料：显示名 / 角色（用户名、密码不在此改），至少提供一个字段 */
export const updateUserSchema = z
  .object({
    displayName: z.string().trim().max(80, '显示名最多 80 个字符').optional(),
    email: emailSchema.optional(),
    twoFactorEnabled: z.boolean().optional(),
    role: z.enum(['admin', 'project_admin', 'user', 'viewer']).optional(),
    projectIds: z.array(objectIdSchema).max(100).optional(),
  })
  .refine(
    (data) =>
      data.displayName !== undefined
      || data.email !== undefined
      || data.twoFactorEnabled !== undefined
      || data.role !== undefined
      || data.projectIds !== undefined,
    {
      message: '至少提供要修改的字段',
    },
  );

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** 重置密码：管理员为指定账号设置新密码，服务端 bcrypt 重新哈希 */
export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** 停用 / 启用账号 */
export const setUserStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
