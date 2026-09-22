import { z } from 'zod';

const smtpHostSchema = z.string().trim().min(1, 'SMTP 服务器不能为空').max(253)
  .refine((value) => !/^https?:\/\//i.test(value), '只填写服务器域名，不要包含 http:// 或 https://');

export const upsertMailAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email('发件邮箱格式不正确').max(200),
  displayName: z.string().trim().max(120).default(''),
  smtpHost: smtpHostSchema,
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean().default(true),
  smtpRequireTls: z.boolean().default(true),
  smtpUsername: z.string().trim().min(1, 'SMTP 用户名不能为空').max(300),
  imapEnabled: z.boolean().default(false),
  imapHost: smtpHostSchema.optional().or(z.literal('')),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  imapUsername: z.string().trim().max(300).optional().or(z.literal('')),
  password: z.string().min(1, '授权码不能为空').max(1000).optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  dailyLimit: z.coerce.number().int().min(1, '每日额度至少为 1').max(5000, '每日额度不能超过 5000').default(100),
}).superRefine((value, context) => {
  if (!value.imapEnabled) return;
  if (!value.imapHost) context.addIssue({ code: z.ZodIssueCode.custom, path: ['imapHost'], message: 'IMAP 服务器不能为空' });
  if (!value.imapUsername) context.addIssue({ code: z.ZodIssueCode.custom, path: ['imapUsername'], message: 'IMAP 用户名不能为空' });
});

export type UpsertMailAccountInput = z.infer<typeof upsertMailAccountSchema>;
