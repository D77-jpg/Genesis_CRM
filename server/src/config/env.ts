/**
 * 环境变量加载与校验
 * ------------------------------------------------------------------
 * 使用 zod 在进程启动阶段一次性校验所有必要配置，
 * 避免运行到一半才发现 .env 缺失导致的诡异错误。
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// 允许在任意工作目录下启动（npm --prefix 场景）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const booleanish = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_ALLOW_PRIVATE_NETWORK: booleanish.default('false'),
  CORS_LAN_PORTS: z.string().default('5173,4173'),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/cdlm'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少需要 32 个字符'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(6, 'ADMIN_PASSWORD 至少需要 6 个字符'),
  ADMIN_DISPLAY_NAME: z.string().default('Genesis Admin'),

  MAIL_TRANSPORT: z.enum(['mock', 'smtp']).default('mock'),
  MAIL_FROM: z.string().default('Genesis (Xiamen) Bags Co., Ltd. <sales@genesisgroup.cn>'),
  /** 按 Project.mailProfileKey 配置独立邮箱；JSON 中的密码仅存在服务端环境变量。 */
  PROJECT_MAIL_CONFIGS_JSON: z.string().default('{}'),
  /** 收件人可访问的 CRM 公网地址，仅用于生成邮件追踪 URL。 */
  TRACKING_BASE_URL: z.string().url().default('http://localhost:5000'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanish.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_REQUIRE_TLS: booleanish.default('true'),
  IMAP_ENABLED: booleanish.default('false'),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  IMAP_USER: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  IMAP_SECURE: booleanish.default('true'),
  IMAP_MAILBOX: z.string().min(1).default('INBOX'),
  IMAP_SYNC_INTERVAL_MS: z.coerce.number().int().min(10000).default(60000),
  IMAP_MAX_MESSAGE_SIZE: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(25 * 1024 * 1024),
  MAIL_WORKER_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  MAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  MAIL_RETRY_DELAY_MS: z.coerce.number().int().min(100).default(30000),

  /** Agent 默认使用 mock，显式切到 openai 后才会读取服务端密钥。 */
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6-luna'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(12).default(6),
  /** 单次送入模型的字符预算；超长历史会优先保留最新内容并记录截断。 */
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(4000).max(500000).default(60000),
  /** CRM 自身的每用户每日保护额度，不替代 OpenAI 项目级限额。 */
  AI_DAILY_RUN_LIMIT: z.coerce.number().int().min(1).max(10000).default(100),
  AI_DAILY_TOKEN_LIMIT: z.coerce.number().int().min(1000).max(100000000).default(500000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(10000).default(3000),
  /** 按每百万 token 的美元成本估算；默认 0 表示尚未配置价格。 */
  AI_INPUT_USD_PER_1M_TOKENS: z.coerce.number().min(0).default(0),
  AI_OUTPUT_USD_PER_1M_TOKENS: z.coerce.number().min(0).default(0),

  COMPANY_NAME: z.string().default('Genesis (Xiamen) Bags Co., Ltd.'),
  COMPANY_WEBSITE: z.string().default('https://www.genesisbags.com'),
  COMPANY_MOQ: z.string().default('100 pcs'),
  SENDER_NAME: z.string().default('Genesis Sales Team'),

  /** 客户附件本地存储目录（默认 server/uploads，已在 .gitignore 忽略） */
  UPLOAD_DIR: z.string().default(path.resolve(__dirname, '../../uploads')),
  /** 单个客户附件大小上限（字节），默认 15MB */
  MAX_ATTACHMENT_SIZE: z.coerce.number().int().positive().default(15 * 1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // 直接把 zod 的路径 + 原因打印出来，方便定位是哪一条配置写错了
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`[env] 环境变量校验失败：\n${details}`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  /** CORS 白名单数组 */
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** 允许访问 CRM 的局域网前端端口；只在 CORS_ALLOW_PRIVATE_NETWORK=true 时生效。 */
  corsLanPorts: raw.CORS_LAN_PORTS.split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535),
  /** SMTP 配置是否完整（显式 smtp 模式配置不完整时返回失败） */
  smtpConfigured: Boolean(raw.MAIL_TRANSPORT === 'smtp' && raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASS),
  /** 只用于服务端状态判断；任何 API 都不得返回 OPENAI_API_KEY。 */
  aiConfigured: raw.AI_PROVIDER === 'mock' || Boolean(raw.OPENAI_API_KEY),
} as const;

export type Env = typeof env;
export default env;
