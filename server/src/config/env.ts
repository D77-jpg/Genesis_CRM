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
  PORT: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/cdlm'),

  JWT_SECRET: z.string().min(8).default('cdlm-dev-secret-change-me-please'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).default('password'),
  ADMIN_DISPLAY_NAME: z.string().default('Genesis Admin'),

  MAIL_TRANSPORT: z.enum(['mock', 'smtp']).default('mock'),
  MAIL_FROM: z.string().default('Genesis (Xiamen) Bags Co., Ltd. <sales@genesisbags.com>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanish.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

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
  /** SMTP 配置是否完整（不完整时自动降级为 mock 发送） */
  smtpConfigured: Boolean(raw.MAIL_TRANSPORT === 'smtp' && raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASS),
} as const;

export type Env = typeof env;
export default env;
