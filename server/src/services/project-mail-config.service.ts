import env from '../config/env';
import { Project } from '../models';

export interface ProjectMailConfig {
  projectId?: string;
  profileKey: string;
  transport: 'mock' | 'smtp';
  mailFrom: string;
  smtp: {
    /** 旧版配置在启动时已做完整性判定；也用于测试中阻止意外连接真实邮箱。 */
    configured?: boolean;
    host?: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    user?: string;
    pass?: string;
  };
  imap: {
    enabled: boolean;
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    mailbox: string;
  };
}

type RawProfile = {
  transport?: 'mock' | 'smtp'; mailFrom?: string;
  smtp?: Partial<ProjectMailConfig['smtp']>;
  imap?: Partial<ProjectMailConfig['imap']>;
};

let cachedRaw: Record<string, RawProfile> | null = null;
function rawProfiles(): Record<string, RawProfile> {
  if (cachedRaw) return cachedRaw;
  try {
    const parsed = JSON.parse(env.PROJECT_MAIL_CONFIGS_JSON) as unknown;
    cachedRaw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, RawProfile> : {};
  } catch {
    cachedRaw = {};
  }
  return cachedRaw;
}

function legacyConfig(): ProjectMailConfig {
  return {
    profileKey: 'genesis-bags', transport: env.MAIL_TRANSPORT, mailFrom: env.MAIL_FROM,
    smtp: { configured: env.smtpConfigured, host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
      requireTLS: env.SMTP_REQUIRE_TLS, user: env.SMTP_USER, pass: env.SMTP_PASS },
    imap: { enabled: env.IMAP_ENABLED, host: env.IMAP_HOST, port: env.IMAP_PORT, secure: env.IMAP_SECURE,
      user: env.IMAP_USER, password: env.IMAP_PASSWORD, mailbox: env.IMAP_MAILBOX },
  };
}

export async function getProjectMailConfig(projectId?: string): Promise<ProjectMailConfig> {
  if (!projectId) return legacyConfig();
  const project = await Project.findById(projectId).lean();
  if (!project) return { ...legacyConfig(), projectId, transport: 'mock', imap: { ...legacyConfig().imap, enabled: false } };
  const key = project.mailProfileKey || project.slug;
  const raw = rawProfiles()[key];
  if (!raw && project.isDefault) return { ...legacyConfig(), projectId, profileKey: key, mailFrom: project.mailFrom || env.MAIL_FROM };
  const base = legacyConfig();
  return {
    projectId, profileKey: key, transport: raw?.transport ?? 'mock',
    mailFrom: raw?.mailFrom || project.mailFrom || `${project.senderName || project.name} <noreply@localhost>`,
    smtp: { host: raw?.smtp?.host, port: Number(raw?.smtp?.port || 587), secure: Boolean(raw?.smtp?.secure),
      requireTLS: raw?.smtp?.requireTLS !== false, user: raw?.smtp?.user, pass: raw?.smtp?.pass },
    imap: { enabled: Boolean(raw?.imap?.enabled), host: raw?.imap?.host, port: Number(raw?.imap?.port || 993),
      secure: raw?.imap?.secure !== false, user: raw?.imap?.user, password: raw?.imap?.password,
      mailbox: raw?.imap?.mailbox || base.imap.mailbox },
  };
}

export function smtpConfigured(config: ProjectMailConfig): boolean {
  const credentialsPresent = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
  return config.transport === 'smtp' && (config.smtp.configured ?? credentialsPresent) && credentialsPresent;
}

export function imapConfigured(config: ProjectMailConfig): boolean {
  return config.imap.enabled && Boolean(config.imap.host && config.imap.user && config.imap.password);
}
