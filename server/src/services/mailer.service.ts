/**
 * 邮件发送服务
 * ------------------------------------------------------------------
 * 两种通道：
 * - mock：默认。不真实发信，模拟 300ms 网络延迟并返回伪造的 messageId。
 *         开箱即用，本地开发无需配置 SMTP。
 * - smtp：使用 nodemailer 真实发信，需要在 .env 配置 MAIL_TRANSPORT=smtp 及 SMTP_*。
 *
 * 约定：本服务「不抛异常」，统一返回 SendMailResult，
 * 由调用方决定是记录 failed 还是回滚，避免发送失败导致开发信记录丢失。
 */
import crypto from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import env from '../config/env';
import { createLogger } from '../config/logger';
import type { MailChannel } from '../constants';

const logger = createLogger('mailer');

export interface SendMailPayload {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendMailResult {
  /** 是否发送成功 */
  accepted: boolean;
  /** 实际使用的通道 */
  channel: MailChannel;
  /** 邮件服务器返回的 messageId */
  messageId?: string;
  /** 失败原因 */
  error?: string;
  /** 发送耗时（ms） */
  durationMs: number;
}

let transporter: Transporter | null = null;

/** 当前生效的通道：配置了 MAIL_TRANSPORT=smtp 且参数齐全才启用真实发送 */
export function getActiveChannel(): MailChannel {
  return env.smtpConfigured ? 'smtp' : 'mock';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 懒加载 SMTP transporter，避免 mock 模式下无谓地建立连接 */
function getTransporter(): Transporter | null {
  if (!env.smtpConfigured) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER as string, pass: env.SMTP_PASS as string },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });
  logger.info(`SMTP transporter 已初始化: ${env.SMTP_HOST}:${env.SMTP_PORT}`);
  return transporter;
}

/** 生成一个类 messageId 的唯一串 */
function generateMessageId(prefix: string): string {
  return `<${prefix}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}@genesis.local>`;
}

async function sendViaMock(payload: SendMailPayload): Promise<SendMailResult> {
  const started = Date.now();
  // 模拟网络往返，让前端的 loading 状态可感知
  await sleep(300);

  logger.info(`[mock] 模拟发送开发信 -> ${payload.to} | 主题: ${payload.subject}`);

  return {
    accepted: true,
    channel: 'mock',
    messageId: generateMessageId('mock'),
    durationMs: Date.now() - started,
  };
}

async function sendViaSmtp(payload: SendMailPayload): Promise<SendMailResult> {
  const started = Date.now();
  const transport = getTransporter();
  if (!transport) {
    return {
      accepted: false,
      channel: 'smtp',
      error: 'SMTP 未正确配置',
      durationMs: Date.now() - started,
    };
  }

  try {
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to: payload.toName ? `"${payload.toName}" <${payload.to}>` : payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text || undefined,
    });

    logger.info(`[smtp] 开发信发送成功 -> ${payload.to} | messageId=${info.messageId}`);
    return {
      accepted: true,
      channel: 'smtp',
      messageId: info.messageId,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[smtp] 开发信发送失败 -> ${payload.to}`, message);
    return {
      accepted: false,
      channel: 'smtp',
      error: message,
      durationMs: Date.now() - started,
    };
  }
}

/** 统一发送入口 */
export async function sendMail(payload: SendMailPayload): Promise<SendMailResult> {
  if (!payload.to) {
    return { accepted: false, channel: getActiveChannel(), error: '收件人邮箱为空', durationMs: 0 };
  }
  return getActiveChannel() === 'smtp' ? sendViaSmtp(payload) : sendViaMock(payload);
}

/** 启动时自检 SMTP 连通性（失败只告警，不阻断服务启动） */
export async function verifyMailer(): Promise<void> {
  const channel = getActiveChannel();
  if (channel === 'mock') {
    logger.warn('邮件通道为 MOCK 模式：开发信只入库、不真实发送。配置 SMTP_* 后重启即可切换为真实发送。');
    return;
  }
  try {
    await getTransporter()?.verify();
    logger.info('SMTP 连接自检通过');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`SMTP 连接自检失败（服务仍会启动，发送时将返回失败状态）: ${message}`);
  }
}

export default sendMail;
