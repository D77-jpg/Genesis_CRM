/**
 * 通用校验片段
 */
import { z } from 'zod';
import { MAX_PAGE_SIZE } from '../constants';

/** Mongo ObjectId（24 位十六进制） */
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, { message: '无效的 ID 格式' });

export const idParamsSchema = z.object({ id: objectIdSchema });

export const idsBodySchema = z.object({
  ids: z.array(objectIdSchema).min(1, '请至少选择一条记录').max(MAX_PAGE_SIZE * 5, '单次操作条数过多'),
});

/** 与模型层保持一致的邮箱正则（比 z.string().email() 宽松，兼容各种企业邮箱） */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, { message: '邮箱格式不正确' });

/** 可选邮箱：允许空串 / 未填，但填了就必须合法 */
export const optionalEmailSchema = z
  // zod 4 里 union 内部放 z.undefined() 不再让「字段缺失」通过校验，
  // 改成先 .optional() 再 transform，语义与原来一致（空串 / null / 未填 → undefined）。
  .union([z.literal(''), z.null(), emailSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

/** 可选字符串：空串归一化为 undefined，避免出现 "" 存进数据库 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `长度不能超过 ${max} 个字符` })
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** 布尔字符串（query string 场景） */
export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v)))
  .optional();

export const paginationQuerySchema = z.object({
  page: z.coerce.number({ error: '页码必须是数字' }).int('页码必须是整数').min(1, '页码从 1 开始').default(1),
  limit: z.coerce.number({ error: '每页条数必须是数字' }).int('每页条数必须是整数').min(1, '每页至少 1 条').max(MAX_PAGE_SIZE, `每页最多 ${MAX_PAGE_SIZE} 条`).default(20),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc'], { error: '排序方向只能是正序或倒序' }).default('desc'),
});

/** ISO 日期字符串 → Date */
export const isoDateSchema = z.coerce.date({ error: '日期格式不正确' });
