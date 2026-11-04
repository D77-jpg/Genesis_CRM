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
import { recordAudit } from '../services/audit.service';

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  try {
    const result = await login(username, password);
    await recordAudit({
      actor: result.user,
      action: 'auth.login.success',
      request: req,
      detail: {},
    });
    sendSuccess(res, result);
  } catch (error) {
    const reason = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    await recordAudit({
      actorUsername: username,
      action: reason === 'RATE_LIMITED' ? 'auth.login.locked' : 'auth.login.failed',
      success: false,
      request: req,
      detail: { reason },
    });
    throw error;
  }
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const user = await getUserById(req.user.id);
  sendSuccess(res, { user });
});
