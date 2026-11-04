/**
 * 鉴权相关请求校验
 */
import { z } from 'zod';
import { passwordSchema } from './user.validator';

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(40, '用户名最多 40 个字符'),
  password: z.string().min(1, '请输入密码').max(128, '密码过长'),
});

export const verifyTwoFactorSchema = z.object({
  challengeId: z.string().regex(/^[a-f\d]{24}$/i, '验证会话无效'),
  code: z.string().trim().regex(/^\d{6}$/, '请输入 6 位数字验证码'),
});

export const forgotPasswordSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(40, '用户名最多 40 个字符'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20, '重置链接无效').max(200, '重置链接无效'),
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
