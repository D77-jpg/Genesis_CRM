/**
 * 鉴权服务
 * ------------------------------------------------------------------
 * - JWT 签发 / 校验
 * - 登录校验（mock 用户：admin / password，账号来源于 .env）
 * - 启动时确保默认管理员存在（bootstrapAdminUser）
 */
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import env from '../config/env';
import { createLogger } from '../config/logger';
import { AuthChallenge, AuthSession, User, hashPassword, type UserDocument, type UserRole } from '../models';
import { ensureDefaultOrganization } from './organization.service';
import { ApiError } from '../utils/ApiError';
import type { AuthUser, JwtPayload } from '../types/express';

const logger = createLogger('auth');

/** Account lockout policy. Keep these values visible for tests and operations. */
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;
const LOGIN_LOCK_MS = LOGIN_LOCK_MINUTES * 60 * 1000;
export const TWO_FACTOR_CODE_TTL_MINUTES = 10;
export const TWO_FACTOR_MAX_ATTEMPTS = 5;

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export interface AuthenticatedAccount {
  user: AuthUser;
  email?: string;
  twoFactorEnabled: boolean;
}

export interface TwoFactorChallengeResult {
  challengeId: string;
  code: string;
  expiresAt: string;
}

export interface AuthSessionResult {
  sessionId: string;
  refreshToken: string;
  expiresAt: string;
}

/** Hash refresh tokens before they touch MongoDB. */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Create a server-side session and return the opaque refresh cookie value. */
export async function createAuthSession(
  user: AuthUser,
  metadata: { ip?: string; userAgent?: string; authenticated?: boolean; twoFactor?: boolean } = {},
): Promise<AuthSessionResult> {
  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  const identity = metadata.authenticated ? await User.findById(user.id).select('+oauthSecurityVersion') : null;
  const authenticatedAt = identity ? new Date() : undefined;
  const session = await AuthSession.create({
    authenticatedAt,
    ...(identity ? { amr: metadata.twoFactor ? ['pwd', 'otp'] : ['pwd'], securityVersionAtLogin: identity.oauthSecurityVersion ?? 0 } : {}),
    ...(identity && metadata.twoFactor ? { mfaVerifiedAt: authenticatedAt } : {}),
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
    userAgent: metadata.userAgent?.slice(0, 512),
    ip: metadata.ip?.slice(0, 64),
  });
  return { sessionId: session._id.toString(), refreshToken, expiresAt: expiresAt.toISOString() };
}

/** Return the active user behind a refresh token, or null when it is invalid. */
export async function findUserByRefreshToken(refreshToken: string): Promise<AuthUser | null> {
  const session = await AuthSession.findOne({
    tokenHash: hashRefreshToken(refreshToken),
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).select('+tokenHash userId');
  if (!session) return null;
  const user = await User.findById(session.userId);
  if (!user || user.status === 'disabled') return null;
  return toAuthUser(user as UserDocument);
}

/** Revoke a refresh session. Logout is idempotent. */
export async function revokeAuthSession(refreshToken: string): Promise<void> {
  if (!refreshToken) return;
  await AuthSession.updateOne(
    { tokenHash: hashRefreshToken(refreshToken), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

/** Rotate a refresh token in place, invalidating the previous token immediately. */
export async function rotateAuthSession(
  refreshToken: string,
  metadata: { ip?: string; userAgent?: string } = {},
): Promise<{ user: AuthUser; sessionId: string; refreshToken: string; expiresAt: string }> {
  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();
  const session = await AuthSession.findOne({
    tokenHash,
    revokedAt: { $exists: false },
    expiresAt: { $gt: now },
  }).select('+tokenHash userId');
  if (!session) throw ApiError.unauthorized('登录已过期，请重新登录');

  const user = await User.findById(session.userId);
  if (!user || user.status === 'disabled') {
    await AuthSession.updateOne({ _id: session._id }, { $set: { revokedAt: now } });
    throw ApiError.unauthorized('账号不存在或已停用，请重新登录');
  }

  const nextToken = newRefreshToken();
  const expiresAt = new Date(now.getTime() + env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  const updated = await AuthSession.findOneAndUpdate(
    { _id: session._id, tokenHash, revokedAt: { $exists: false } },
    {
      $set: {
        tokenHash: hashRefreshToken(nextToken),
        expiresAt,
        lastUsedAt: now,
        ip: metadata.ip?.slice(0, 64),
        userAgent: metadata.userAgent?.slice(0, 512),
      },
    },
    { new: true },
  );
  if (!updated) throw ApiError.unauthorized('登录已过期，请重新登录');

  return {
    user: toAuthUser(user as UserDocument),
    sessionId: session._id.toString(),
    refreshToken: nextToken,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Session lookup used by cookie-authenticated requests. */
export async function isAuthSessionActive(sessionId: string, userId: string): Promise<boolean> {
  if (!sessionId || !/^[a-f\d]{24}$/i.test(sessionId)) return false;
  const session = await AuthSession.findOne({
    _id: sessionId,
    userId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).select('_id').lean();
  return Boolean(session);
}

/** Constant-time CSRF token comparison for cookie-authenticated mutations. */
export function safeTokenEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 签发 JWT */
export function signToken(user: {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}, sessionId?: string): { token: string; expiresAt: string } {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    ...(sessionId ? { sid: sessionId } : {}),
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });

  const decoded = jwt.decode(token) as JwtPayload | null;
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000).toISOString()
    : new Date(Date.now() + 15 * 60 * 1000).toISOString();

  return { token, expiresAt };
}

/** 校验 JWT，非法 / 过期时抛出 401 */
export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('登录已过期，请重新登录');
    }
    throw ApiError.unauthorized('登录凭证无效，请重新登录');
  }
}

function toAuthUser(doc: UserDocument): AuthUser {
  return {
    id: doc._id.toString(),
    username: doc.username,
    displayName: doc.displayName || doc.username,
    role: doc.role,
    ...(doc.organizationId ? { organizationId: String(doc.organizationId) } : {}),
    isPlatformAdmin: Boolean(doc.isPlatformAdmin),
  };
}

/** Hash a one-time OTP or password-reset token before storing it. */
function hashChallengeSecret(secret: string): string {
  // HMAC prevents offline enumeration of the small 6-digit OTP space if the
  // challenges collection is ever exposed.
  return createHmac('sha256', env.JWT_SECRET).update(secret).digest('hex');
}

/** Mask an account email for the 2FA screen without revealing the full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}

/** Create a short-lived email OTP challenge after the password step succeeds. */
export async function createLoginTwoFactorChallenge(user: AuthUser): Promise<TwoFactorChallengeResult> {
  await AuthChallenge.updateMany(
    { userId: user.id, purpose: 'login-2fa', consumedAt: { $exists: false } },
    { $set: { consumedAt: new Date() } },
  );

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CODE_TTL_MINUTES * 60 * 1000);
  const challenge = await AuthChallenge.create({
    userId: user.id,
    purpose: 'login-2fa',
    secretHash: hashChallengeSecret(code),
    expiresAt,
  });

  return {
    challengeId: challenge._id.toString(),
    code,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Validate an email OTP and return the account that owns the challenge. */
export async function verifyLoginTwoFactor(challengeId: string, code: string): Promise<AuthUser> {
  if (!/^[a-f\d]{24}$/i.test(challengeId)) throw ApiError.badRequest('验证码已过期，请重新登录');

  const now = new Date();
  const challenge = await AuthChallenge.findOne({
    _id: challengeId,
    purpose: 'login-2fa',
    consumedAt: { $exists: false },
    expiresAt: { $gt: now },
  }).select('+secretHash userId attempts');

  if (!challenge) throw ApiError.badRequest('验证码已过期，请重新登录');
  const attempts = challenge.attempts ?? 0;
  if (attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
    await AuthChallenge.updateOne({ _id: challenge._id }, { $set: { consumedAt: now } });
    throw ApiError.badRequest('验证码错误次数过多，请重新登录');
  }

  if (!safeTokenEqual(hashChallengeSecret(code), challenge.secretHash)) {
    const nextAttempts = attempts + 1;
    await AuthChallenge.updateOne(
      { _id: challenge._id, consumedAt: { $exists: false } },
      {
        $set: {
          attempts: nextAttempts,
          ...(nextAttempts >= TWO_FACTOR_MAX_ATTEMPTS ? { consumedAt: now } : {}),
        },
      },
    );
    throw ApiError.badRequest(
      nextAttempts >= TWO_FACTOR_MAX_ATTEMPTS
        ? '验证码错误次数过多，请重新登录'
        : '验证码错误，请重新输入',
    );
  }

  const user = await User.findById(challenge.userId);
  if (!user || user.status === 'disabled') throw ApiError.forbidden('账号已停用，请联系管理员');
  if (!user.twoFactorEnabled) throw ApiError.badRequest('该账号已关闭双重验证，请重新登录');

  const consumed = await AuthChallenge.updateOne(
    { _id: challenge._id, consumedAt: { $exists: false } },
    { $set: { consumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) throw ApiError.badRequest('验证码已过期，请重新登录');

  return toAuthUser(user as UserDocument);
}

/** 账号密码校验（2FA 登录在密码通过后还需要一次邮件验证码） */
export async function authenticate(username: string, password: string): Promise<AuthenticatedAccount> {
  const normalized = username.trim().toLowerCase();

  // passwordHash / lockout fields are select:false; the auth path opts in explicitly.
  const user = await User.findOne({ username: normalized }).select(
    '+passwordHash +failedLoginAttempts +lockedUntil',
  );
  if (!user) {
    // 统一话术，避免暴露「用户是否存在」
    throw ApiError.unauthorized('用户名或密码错误');
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    throw ApiError.tooManyRequests('登录失败次数过多，账号已临时锁定，请稍后再试');
  }
  // An expired lock must not carry its old failure count into the next window.
  if (user.lockedUntil && user.lockedUntil <= now) {
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } });
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
  }

  const ok = await user.comparePassword(password);
  if (!ok) {
    const failedAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil = failedAttempts >= LOGIN_MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + LOGIN_LOCK_MS)
      : undefined;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLoginAttempts: failedAttempts,
          ...(lockedUntil ? { lockedUntil } : {}),
        },
      },
    );
    if (lockedUntil) {
      throw ApiError.tooManyRequests('登录失败次数过多，账号已临时锁定，请稍后再试');
    }
    throw ApiError.unauthorized('用户名或密码错误');
  }

  // 密码正确但账号已被停用：明确提示（此处已过密码校验，不会泄露账号是否存在）
  if (user.status === 'disabled') {
    throw ApiError.forbidden('账号已停用，请联系管理员');
  }

  // Successful password verification clears the lockout window.
  await User.updateOne(
    { _id: user._id },
    { $set: { lastLoginAt: new Date(), failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } },
  );

  const authUser = toAuthUser(user as UserDocument);
  logger.info(`用户密码校验通过: ${authUser.username}`);

  return {
    user: authUser,
    email: user.email,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  };
}

/** 账号密码登录（兼容旧调用方；2FA 登录由控制器使用 authenticate） */
export async function login(username: string, password: string): Promise<LoginResult> {
  const account = await authenticate(username, password);
  const { token, expiresAt } = signToken(account.user);

  logger.info(`用户登录成功: ${account.user.username}`);
  return { token, expiresAt, user: account.user };
}

/** 按 id 取当前登录用户（用于 /auth/me） */
export async function getUserById(id: string): Promise<AuthUser> {
  const user = await User.findById(id);
  if (!user) throw ApiError.unauthorized('用户不存在或已被删除');
  return toAuthUser(user as UserDocument);
}

/**
 * 确保默认管理员账号存在。
 * 首次启动时按 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD 创建，
 * 已存在则只更新 displayName / role，不覆盖用户改过的密码。
 */
export async function bootstrapAdminUser(): Promise<void> {
  const username = env.ADMIN_USERNAME.trim().toLowerCase();
  const organization = await ensureDefaultOrganization();
  const existing = await User.findOne({ username });

  if (existing) {
    let changed = false;
    if (!existing.organizationId) {
      existing.organizationId = organization._id;
      changed = true;
    }
    // The bootstrap administrator is the platform owner for single-tenant
    // installations; additional organization admins are not platform admins.
    if (!existing.isPlatformAdmin) {
      existing.isPlatformAdmin = true;
      changed = true;
    }
    if (env.ADMIN_EMAIL && !existing.email) {
      // Fill a missing bootstrap email without overwriting an address changed in the UI.
      existing.email = env.ADMIN_EMAIL.trim().toLowerCase();
      changed = true;
      logger.info(`已为默认管理员补充邮箱: ${existing.email}`);
    }
    if (changed) await existing.save({ validateBeforeSave: false });
    logger.debug(`默认管理员已存在: ${username}`);
    return;
  }

  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
  await User.create({
    organizationId: organization._id,
    isPlatformAdmin: true,
    username,
    passwordHash,
    displayName: env.ADMIN_DISPLAY_NAME,
    email: env.ADMIN_EMAIL?.trim().toLowerCase(),
    role: 'admin',
  });
  logger.info(`已创建默认管理员账号: ${username}（密码见 .env 的 ADMIN_PASSWORD，请尽快修改）`);
}
