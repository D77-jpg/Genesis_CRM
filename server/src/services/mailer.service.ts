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
import { mailError } from './mail-security';
import { Project } from '../models';
import { getProjectMailConfig, smtpConfigured, type ProjectMailConfig } from './project-mail-config.service';

const logger = createLogger('mailer');

export interface SendMailPayload {
  projectId?: string;
  from?: string;
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
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
  retryable?: boolean;
  uncertain?: boolean;
}

const transporters = new Map<string, Transporter>();

/** 当前生效的通道：配置了 MAIL_TRANSPORT=smtp 且参数齐全才启用真实发送 */
export function getActiveChannel(): MailChannel {
  return env.MAIL_TRANSPORT;
}

export async function getProjectActiveChannel(projectId?: string): Promise<MailChannel> {
  return (await getProjectMailConfig(projectId)).transport;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 懒加载 SMTP transporter，避免 mock 模式下无谓地建立连接 */
function getTransporter(config: ProjectMailConfig): Transporter | null {
  if (!smtpConfigured(config)) return null;
  const cached = transporters.get(config.profileKey);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: config.smtp.requireTLS,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 45000,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: { user: config.smtp.user as string, pass: config.smtp.pass as string },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });
  transporters.set(config.profileKey, transporter);
  logger.info(`项目邮箱 ${config.profileKey} 的 SMTP transporter 已初始化: ${config.smtp.host}:${config.smtp.port}`);
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
    messageId: payload.messageId ?? generateMessageId('mock'),
    durationMs: Date.now() - started,
  };
}

async function sendViaSmtp(payload: SendMailPayload, config: ProjectMailConfig): Promise<SendMailResult> {
  const started = Date.now();
  const transport = getTransporter(config);
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
      from: payload.from || config.mailFrom,
      to: payload.toName ? { name: payload.toName, address: payload.to } : payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text || undefined,
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
    });

    logger.info(`[smtp] 开发信发送成功 -> ${payload.to} | messageId=${info.messageId}`);
    return {
      accepted: (info.accepted?.length ?? 0) > 0,
      channel: 'smtp',
      messageId: info.messageId,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = mailError(error, 'SMTP');
    const detail = error as { code?: string; command?: string; responseCode?: number };
    const rejected = Boolean(detail.responseCode && detail.responseCode >= 400);
    const beforeData = ['CONN', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(detail.command ?? '') || ['EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'EAUTH'].includes(detail.code ?? '');
    logger.error(`[smtp] 开发信发送失败 -> ${payload.to}`, message);
    return {
      accepted: false,
      channel: 'smtp',
      error: message,
      retryable: rejected ? detail.responseCode! < 500 : beforeData && detail.code !== 'EAUTH',
      uncertain: !rejected && !beforeData,
      durationMs: Date.now() - started,
    };
  }
}

/** 统一发送入口 */
export async function sendMail(payload: SendMailPayload): Promise<SendMailResult> {
  const config = await getProjectMailConfig(payload.projectId);
  if (!payload.to) {
    return { accepted: false, channel: config.transport, error: '收件人邮箱为空', durationMs: 0 };
  }
  return config.transport === 'smtp' ? sendViaSmtp(payload, config) : sendViaMock(payload);
}

/** 启动时自检 SMTP 连通性（失败只告警，不阻断服务启动） */
export async function verifyMailer(): Promise<void> {
  const projects = await Project.find({ status: 'active' }).select('_id name');
  for (const project of projects) {
    const config = await getProjectMailConfig(String(project._id));
    if (config.transport === 'mock') {
      logger.warn(`${project.name} 邮件通道为 MOCK 模式：只入库、不真实发送`);
      continue;
    }
    if (!smtpConfigured(config)) {
      logger.warn(`${project.name} SMTP 配置不完整，发送任务会明确失败`);
      continue;
    }
    try {
      await getTransporter(config)?.verify();
      logger.info(`${project.name} SMTP 连接自检通过`);
    } catch (error) {
      logger.warn(`${project.name} SMTP 连接自检失败（服务仍会启动）: ${mailError(error, 'SMTP')}`);
    }
  }
}

export default sendMail;

export function closeMailer(): void {
  transporters.forEach((transporter) => transporter.close());
  transporters.clear();
}
