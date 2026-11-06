/**
 * Self-service password reset.
 *
 * The public request endpoint always returns the same response, whether the
 * account exists, is disabled, or has no email. A one-time token is stored as
 * an HMAC digest and expires after 30 minutes.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { AuthChallenge, AuthSession, User, hashPassword, type UserDocument } from '../models';
import { ApiError } from '../utils/ApiError';
import { createLogger } from '../config/logger';
import env from '../config/env';
import { sendPasswordResetEmail } from './auth-mail.service';

const logger = createLogger('password-reset');
export const PASSWORD_RESET_TTL_MINUTES = 30;
const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_MINUTES * 60 * 1000;

function hashResetToken(token: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(token).digest('hex');
}

/** Request a reset link. Never reveals whether the account exists. */
export async function requestPasswordReset(username: string): Promise<string | undefined> {
  const normalized = username.trim().toLowerCase();
  const user = await User.findOne({ username: normalized }).select('email displayName status');
  if (!user || user.status === 'disabled' || !user.email) return;

  await AuthChallenge.updateMany(
    { userId: user._id, purpose: 'password-reset', consumedAt: { $exists: false } },
    { $set: { consumedAt: new Date() } },
  );

  const token = randomBytes(32).toString('base64url');
  const challenge = await AuthChallenge.create({
    userId: user._id,
    purpose: 'password-reset',
    secretHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });

  let sent = false;
  try {
    sent = await sendPasswordResetEmail(
      user.email,
      user.displayName || user.username,
      token,
      PASSWORD_RESET_TTL_MINUTES,
    );
  } catch {
    sent = false;
  }
  if (!sent) {
    await AuthChallenge.deleteOne({ _id: challenge._id });
    logger.warn(`重置密码邮件发送失败: userId=${user._id.toString()}`);
    return;
  }
  return token;
}

/** Consume a reset token and update the password atomically enough for this flow. */
export async function resetPasswordWithToken(token: string, password: string): Promise<{ id: string; username: string }> {
  const now = new Date();
  const challenge = await AuthChallenge.findOne({
    secretHash: hashResetToken(token),
    purpose: 'password-reset',
    consumedAt: { $exists: false },
    expiresAt: { $gt: now },
  });
  if (!challenge) throw ApiError.badRequest('重置链接无效或已过期，请重新申请');

  const user = await User.findById(challenge.userId);
  if (!user || user.status === 'disabled') {
    await AuthChallenge.updateOne({ _id: challenge._id }, { $set: { consumedAt: now } });
    throw ApiError.badRequest('重置链接无效或已过期，请重新申请');
  }

  const passwordHash = await hashPassword(password);
  const updated = await AuthChallenge.updateOne(
    { _id: challenge._id, consumedAt: { $exists: false } },
    { $set: { consumedAt: now } },
  );
  if (updated.modifiedCount !== 1) throw ApiError.badRequest('重置链接无效或已过期，请重新申请');

  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash, failedLoginAttempts: 0 }, $inc: { oauthSecurityVersion: 1 }, $unset: { lockedUntil: 1 } },
  );
  await AuthSession.updateMany({ userId: user._id }, { $set: { revokedAt: now } });
  await AuthChallenge.updateMany(
    { userId: user._id, _id: { $ne: challenge._id }, consumedAt: { $exists: false } },
    { $set: { consumedAt: now } },
  );
  logger.info(`自助重置密码成功: userId=${user._id.toString()}`);

  return { id: (user as UserDocument)._id.toString(), username: user.username };
}
