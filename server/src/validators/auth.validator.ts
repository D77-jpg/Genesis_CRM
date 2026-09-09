/**
 * 鉴权相关请求校验
 */
import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(40, '用户名最多 40 个字符'),
  password: z.string().min(1, '请输入密码').max(128, '密码过长'),
});

export type LoginInput = z.infer<typeof loginSchema>;
