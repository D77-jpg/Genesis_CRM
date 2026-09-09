/**
 * DevelopmentLetter 相关请求校验
 */
import { z } from 'zod';
import { LETTER_STATUS } from '../constants';
import { idParamsSchema, isoDateSchema, objectIdSchema, paginationQuerySchema } from './common';

const letterStatusSchema = z.enum(LETTER_STATUS);

/**
 * 富文本正文：允许 HTML，但剔除标签后不能是空白。
 * 判空统一交给 refine：它同时盖住「空字符串」与 React Quill 的「<p><br></p>」空壳，
 * 再加一个 min(1) 只会对空串重复报同一条错误。
 */
const htmlContentSchema = z
  .string()
  .max(100000, '开发信正文过长')
  .refine((v) => v.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0, {
    message: '开发信正文不能为空',
  });

export const sendLetterSchema = z.object({
  /** 目标客户；也可通过 URL /customers/:id/letters 传入 */
  customerId: objectIdSchema.optional(),
  subject: z.string().trim().min(1, '邮件主题为必填项').max(300, '邮件主题不能超过 300 个字符'),
  /** 含 {{placeholder}} 的原始 HTML，占位符由后端渲染 */
  content: htmlContentSchema,
  /** 收件人邮箱：不传则使用客户档案里的邮箱 */
  recipientEmail: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, { message: '收件人邮箱格式不正确' })
    .optional(),
  /** 发送成功后是否把客户状态改为「已开发」 */
  markAsDeveloped: z.boolean().default(true),
  /** true 时只存草稿，不触发发送 */
  saveAsDraft: z.boolean().default(false),
});

export const resendLetterSchema = z.object({
  subject: z.string().trim().min(1).max(300).optional(),
  content: htmlContentSchema.optional(),
  recipientEmail: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, { message: '收件人邮箱格式不正确' })
    .optional(),
  markAsDeveloped: z.boolean().default(true),
});

export const listLettersQuerySchema = paginationQuerySchema.extend({
  /** 按客户过滤 */
  customerId: objectIdSchema.optional(),
  /** 关键字：主题 / 收件人 / 收件邮箱 */
  search: z.string().trim().max(200).optional(),
  status: z.enum(['all', 'draft', 'sent', 'failed']).optional(),
  channel: z.enum(['all', 'mock', 'smtp']).optional(),
  sentFrom: isoDateSchema.optional(),
  sentTo: isoDateSchema.optional(),
});

export const bulkDeleteLettersSchema = z.object({
  ids: z.array(objectIdSchema).min(1, '请至少选择一封开发信').max(1000, '单次最多删除 1000 封开发信'),
});

export { idParamsSchema, letterStatusSchema };

export type SendLetterInput = z.infer<typeof sendLetterSchema>;
export type ResendLetterInput = z.infer<typeof resendLetterSchema>;
export type ListLettersQuery = z.infer<typeof listLettersQuerySchema>;
