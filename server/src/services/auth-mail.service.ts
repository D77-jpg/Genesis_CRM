/**
 * System authentication emails.
 *
 * These messages are intentionally sent through the system mail channel
 * (`sendMail` without a project id), not through a sales mailbox. In local
 * mock mode the code/link is also printed to the server console so developers
 * can complete the flow without SMTP credentials.
 */
import env from '../config/env';
import { PRODUCT_NAME } from '../constants/brand';
import { sendMail } from './mailer.service';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] as string));
}

function appBaseUrl(): string {
  const configured = env.APP_BASE_URL || env.CORS_ORIGIN.split(',')[0]?.trim();
  return (configured || 'http://localhost:5173').replace(/\/+$/, '');
}

export function buildPasswordResetUrl(token: string): string {
  return `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

function logMockSecret(label: string, secret: string): void {
  if (env.MAIL_TRANSPORT === 'mock' && env.NODE_ENV !== 'production') {
    // The structured logger deliberately strips free-text messages. In local
    // mock mode print the OTP/reset link so the flow can be completed without
    // SMTP; this branch never runs in production.
    console.warn(`[auth-mail][mock] ${label}: ${secret}`);
  }
}

export async function sendTwoFactorEmail(
  email: string,
  displayName: string,
  code: string,
  expiresMinutes: number,
): Promise<boolean> {
  const safeName = escapeHtml(displayName || '用户');
  const result = await sendMail({
    to: email,
    toName: displayName,
    subject: `${PRODUCT_NAME} 登录验证码`,
    text: `你的 ${PRODUCT_NAME} 登录验证码是：${code}\n验证码 ${expiresMinutes} 分钟内有效。如非本人操作，请忽略本邮件。`,
    html: `<p>${safeName}，你好：</p>
<p>你的 ${PRODUCT_NAME} 登录验证码是：</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
<p>验证码 ${expiresMinutes} 分钟内有效。如非本人操作，请忽略本邮件。</p>`,
  });
  logMockSecret(`登录 OTP（${email}）`, code);
  return result.accepted;
}

export async function sendPasswordResetEmail(
  email: string,
  displayName: string,
  token: string,
  expiresMinutes: number,
): Promise<boolean> {
  const resetUrl = buildPasswordResetUrl(token);
  const safeName = escapeHtml(displayName || '用户');
  const safeUrl = escapeHtml(resetUrl);
  const result = await sendMail({
    to: email,
    toName: displayName,
    subject: `${PRODUCT_NAME} 重置密码`,
    text: `${displayName || '用户'}，你好：\n请在 ${expiresMinutes} 分钟内打开以下链接重置密码：\n${resetUrl}\n如非本人操作，请忽略本邮件。`,
    html: `<p>${safeName}，你好：</p>
<p>请在 ${expiresMinutes} 分钟内打开以下链接重置密码：</p>
<p><a href="${safeUrl}">${safeUrl}</a></p>
<p>如非本人操作，请忽略本邮件。</p>`,
  });
  logMockSecret(`重置密码链接（${email}）`, resetUrl);
  return result.accepted;
}
