/**
 * 鉴权接口
 *   POST /api/auth/login              账号密码登录；开启 2FA 时返回邮件验证码挑战
 *   POST /api/auth/login/verify-2fa   校验邮件 OTP 并签发会话
 *   POST /api/auth/forgot-password    申请重置密码邮件（统一响应，防账号枚举）
 *   POST /api/auth/reset-password     使用一次性令牌重置密码
 *   POST /api/auth/refresh            刷新访问令牌与轮换 refresh token
 *   POST /api/auth/logout             注销当前会话
 *   GET  /api/auth/me                 获取当前登录用户
 */
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import {
  authenticate,
  createAuthSession,
  createLoginTwoFactorChallenge,
  findUserByRefreshToken,
  getUserById,
  maskEmail,
  revokeAuthSession,
  rotateAuthSession,
  safeTokenEqual,
  signToken,
  verifyLoginTwoFactor,
  TWO_FACTOR_CODE_TTL_MINUTES,
} from '../services/auth.service';
import { requestPasswordReset, resetPasswordWithToken } from '../services/password-reset.service';
import { sendTwoFactorEmail } from '../services/auth-mail.service';
import { recordAudit } from '../services/audit.service';
import { AUTH_COOKIE_NAMES, clearAuthCookies, getCookie, setAuthCookies } from '../utils/auth-cookies';
import type { AuthUser } from '../types/express';

function enforceCsrf(req: Request): void {
  const header = req.headers['x-csrf-token'];
  const expected = getCookie(req, AUTH_COOKIE_NAMES.csrf);
  if (!safeTokenEqual(typeof header === 'string' ? header : undefined, expected)) {
    throw ApiError.forbidden('CSRF 校验失败，请刷新页面后重试');
  }
}

/** Issue the browser session after every required authentication factor succeeds. */
async function completeLogin(req: Request, res: Response, user: AuthUser, detail: Record<string, unknown>): Promise<string> {
  const session = await createAuthSession(user, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    authenticated: true, twoFactor: detail.twoFactor === true,
  });
  const access = signToken(user, session.sessionId);
  setAuthCookies(res, {
    accessToken: access.token,
    refreshToken: session.refreshToken,
    csrfToken: createCsrfToken(),
    accessExpiresAt: access.expiresAt,
  });
  await recordAudit({
    actor: user,
    action: 'auth.login.success',
    request: req,
    detail,
  });
  return access.expiresAt;
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  try {
    const account = await authenticate(username, password);

    if (account.twoFactorEnabled) {
      if (!account.email) {
        throw ApiError.internal('账号已开启双重验证但未配置邮箱，请联系管理员');
      }
      const challenge = await createLoginTwoFactorChallenge(account.user);
      const sent = await sendTwoFactorEmail(
        account.email,
        account.user.displayName,
        challenge.code,
        TWO_FACTOR_CODE_TTL_MINUTES,
      );
      if (!sent) throw ApiError.mailFailed('验证码邮件发送失败，请稍后重试或联系管理员');

      await recordAudit({
        actor: account.user,
        action: 'auth.login.2fa_required',
        request: req,
        detail: {},
      });
      sendSuccess(res, {
        twoFactorRequired: true,
        challengeId: challenge.challengeId,
        emailHint: maskEmail(account.email),
        expiresAt: challenge.expiresAt,
      });
      return;
    }

    const expiresAt = await completeLogin(req, res, account.user, {});
    sendSuccess(res, { user: account.user, expiresAt });
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

export const verifyTwoFactorHandler = asyncHandler(async (req: Request, res: Response) => {
  const { challengeId, code } = req.body as { challengeId: string; code: string };
  try {
    const user = await verifyLoginTwoFactor(challengeId, code);
    const expiresAt = await completeLogin(req, res, user, { twoFactor: true });
    sendSuccess(res, { user, expiresAt });
  } catch (error) {
    const reason = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    await recordAudit({
      action: 'auth.login.failed',
      success: false,
      request: req,
      detail: { reason, twoFactor: true },
    });
    throw error;
  }
});

export const forgotPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { username } = req.body as { username: string };
  // Deliberately ignore whether the account exists or has an email address.
  await requestPasswordReset(username);
  await recordAudit({
    actorUsername: username,
    action: 'auth.password_reset.requested',
    request: req,
    detail: {},
  });
  sendSuccess(res, { sent: true });
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body as { token: string; password: string };
  const result = await resetPasswordWithToken(token, password);
  await recordAudit({
    actorUsername: result.username,
    action: 'auth.password_reset.success',
    targetType: 'user',
    targetId: result.id,
    request: req,
    detail: {},
  });
  clearAuthCookies(res);
  sendSuccess(res, { reset: true });
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
