/**
 * 鉴权接口
 *   POST /api/auth/login   账号密码登录，签发 HttpOnly 会话 cookie
 *   POST /api/auth/refresh 刷新访问令牌与轮换 refresh token
 *   POST /api/auth/logout  注销当前会话
 *   GET  /api/auth/me      获取当前登录用户
 */
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import {
  createAuthSession,
  findUserByRefreshToken,
  getUserById,
  login,
  revokeAuthSession,
  rotateAuthSession,
  safeTokenEqual,
  signToken,
} from '../services/auth.service';
import { recordAudit } from '../services/audit.service';
import { AUTH_COOKIE_NAMES, clearAuthCookies, getCookie, setAuthCookies } from '../utils/auth-cookies';

function enforceCsrf(req: Request): void {
  const header = req.headers['x-csrf-token'];
  const expected = getCookie(req, AUTH_COOKIE_NAMES.csrf);
  if (!safeTokenEqual(typeof header === 'string' ? header : undefined, expected)) {
    throw ApiError.forbidden('CSRF 校验失败，请刷新页面后重试');
  }
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  try {
    const result = await login(username, password);
    const session = await createAuthSession(result.user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const access = signToken(result.user, session.sessionId);
    setAuthCookies(res, {
      accessToken: access.token,
      refreshToken: session.refreshToken,
      csrfToken: createCsrfToken(),
      accessExpiresAt: access.expiresAt,
    });
    await recordAudit({
      actor: result.user,
      action: 'auth.login.success',
      request: req,
      detail: {},
    });
    sendSuccess(res, { user: result.user, expiresAt: access.expiresAt });
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

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  enforceCsrf(req);
  const refreshToken = getCookie(req, AUTH_COOKIE_NAMES.refresh);
  if (!refreshToken) throw ApiError.unauthorized('登录已过期，请重新登录');

  try {
    const rotated = await rotateAuthSession(refreshToken, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const access = signToken(rotated.user, rotated.sessionId);
    setAuthCookies(res, {
      accessToken: access.token,
      refreshToken: rotated.refreshToken,
      csrfToken: createCsrfToken(),
      accessExpiresAt: access.expiresAt,
    });
    sendSuccess(res, { user: rotated.user, expiresAt: access.expiresAt });
  } catch (error) {
    clearAuthCookies(res);
    throw error;
  }
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = getCookie(req, AUTH_COOKIE_NAMES.refresh);
  if (refreshToken) {
    enforceCsrf(req);
    const user = await findUserByRefreshToken(refreshToken);
    await revokeAuthSession(refreshToken);
    if (user) {
      await recordAudit({ actor: user, action: 'auth.logout', request: req, detail: {} });
    }
  }
  clearAuthCookies(res);
  sendSuccess(res, { loggedOut: true });
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const user = await getUserById(req.user.id);
  sendSuccess(res, { user });
});

function createCsrfToken(): string {
  // The token is returned in a readable cookie and compared timing-safely.
  return randomBytes(32).toString('base64url');
}
