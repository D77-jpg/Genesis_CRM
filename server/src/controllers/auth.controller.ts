/**
 * 鉴权接口
 *   POST /api/auth/login  账号密码登录，返回 JWT
 *   GET  /api/auth/me     获取当前登录用户
 */
import type { Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { getUserById, login } from '../services/auth.service';

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  const result = await login(username, password);
  sendSuccess(res, result);
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const user = await getUserById(req.user.id);
  sendSuccess(res, { user });
});
