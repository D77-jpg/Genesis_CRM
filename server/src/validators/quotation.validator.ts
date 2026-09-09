/**
 * Quotation（报价单）相关请求校验
 * ------------------------------------------------------------------
 * 金额可信性：items[].amount 与 totalAmount **不**出现在任何入参 schema 中，
 * zod 默认会剥离未声明字段，因此前端即便传入金额也会被丢弃，最终由服务层重算。
 */
import { z } from 'zod';
import { QUOTATION_CURRENCY, QUOTATION_STATUS } from '../constants';
import { idParamsSchema, isoDateSchema, objectIdSchema, optionalText, paginationQuerySchema } from './common';

const quotationStatusSchema = z.enum(QUOTATION_STATUS, {
  errorMap: () => ({ message: '报价单状态取值非法' }),
});

const quotationCurrencySchema = z.enum(QUOTATION_CURRENCY, {
  errorMap: () => ({ message: '报价币种取值非法' }),
});

/** 状态筛选：全部 + 6 种报价状态 */
const quotationStatusFilterSchema = z.enum(['all', ...QUOTATION_STATUS] as const);

/**
 * 报价编号（用户自定义时）：仅允许字母 / 数字 / 点 / 下划线 / 连字符，
 * 统一转大写以便唯一性判定（QT-2026-001 与 qt-2026-001 视为同一个）。
 * 不传时由服务层自动生成。
 */
const quotationNoInputSchema = z
  .string()
  .trim()
  .max(60, '报价单编号不能超过 60 个字符')
  .regex(/^[A-Za-z0-9._-]+$/, '报价单编号只能包含字母、数字、点、下划线和连字符')
  .transform((v) => v.toUpperCase())
  .optional();

/** 单行报价明细：只接收 productName / model / quantity / unitPrice（amount 由后端算） */
const quotationItemSchema = z.object({
  productName: z.string().trim().min(1, '产品名称为必填项').max(200, '产品名称不能超过 200 个字符'),
  model: optionalText(200),
  quantity: z.coerce.number().positive('数量必须大于 0').max(1_000_000_000, '数量过大'),
  unitPrice: z.coerce.number().min(0, '单价不能为负数').max(1_000_000_000, '单价过大'),
});

/** 报价明细数组：至少一行，最多 200 行 */
const quotationItemsSchema = z.array(quotationItemSchema).min(1, '报价明细至少需要一行产品').max(200, '报价明细最多 200 行');

/**
 * 有效期（编辑用）：保留 null（显式清除）与「不传」（保持原值）的区别。
 */
const validityDateUpdateSchema = z
  .union([z.literal(''), z.null(), isoDateSchema])
  .transform((v) => (v === '' || v === null ? null : v))
  .optional();

/**
 * 有效期（新增用）：空串 / null / 不传一律归一化为 undefined（表示「未设置」）。
 * 先用 union 拦截 '' / null，避免裸 isoDateSchema（z.coerce.date）把 null 强转成
 * 1970-01-01 epoch 而被误存——前端表单在未填有效期时会提交 null。
 */
const validityDateCreateSchema = z
  .union([z.literal(''), z.null(), isoDateSchema])
  .transform((v) => (v === '' || v === null ? undefined : v))
  .optional();

export const createQuotationSchema = z.object({
  /** 目标客户；也可通过 URL /customers/:id/quotations 传入 */
  customerId: objectIdSchema.optional(),
  /** 报价编号；不传由后端按 QT-YYYYMMDD-NNN 规则生成 */
  quotationNo: quotationNoInputSchema,
  title: z.string().trim().min(1, '报价标题为必填项').max(200, '报价标题不能超过 200 个字符'),
  items: quotationItemsSchema,
  currency: quotationCurrencySchema.default('USD'),
  /** 有效期（空串 / null / 不传均表示未设置） */
  validityDate: validityDateCreateSchema,
  paymentTerms: optionalText(300),
  leadTime: optionalText(200),
  moq: optionalText(120),
  notes: optionalText(5000),
  status: quotationStatusSchema.default('draft'),
  /**
   * 显式联动：为 true 时，创建后把客户销售状态推进到「报价中」（仅语义升级，
   * 不降级已报价中 / 谈判中 / 成交 / 流失的客户）。普通编辑不触发此联动。
   */
  markCustomerAsQuoting: z.boolean().default(false),
});

/**
 * 编辑报价单：所有字段可选，只更新明确提供的字段（partial + 至少一个字段）。
 * 刻意不含 markCustomerAsQuoting —— 普通编辑不应擅自改动客户销售状态。
 */
export const updateQuotationSchema = z
  .object({
    quotationNo: quotationNoInputSchema,
    title: z.string().trim().min(1, '报价标题为必填项').max(200, '报价标题不能超过 200 个字符'),
    items: quotationItemsSchema,
    currency: quotationCurrencySchema,
    validityDate: validityDateUpdateSchema,
    paymentTerms: optionalText(300),
    leadTime: optionalText(200),
    moq: optionalText(120),
    notes: optionalText(5000),
    status: quotationStatusSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: '请至少提供一个需要修改的字段',
  });

/** 更新报价单状态（独立接口）；可携带显式客户状态联动 */
export const updateQuotationStatusSchema = z.object({
  status: quotationStatusSchema,
  markCustomerAsQuoting: z.boolean().default(false),
});

export const listQuotationsQuerySchema = paginationQuerySchema.extend({
  /** 按客户过滤 */
  customerId: objectIdSchema.optional(),
  /** 关键字：报价编号 / 标题 */
  search: z.string().trim().max(200).optional(),
  status: quotationStatusFilterSchema.optional(),
  currency: quotationCurrencySchema.optional(),
});

/** 路径参数：客户 id + 报价单 id（嵌套单条操作用） */
export const quotationIdParamsSchema = z.object({
  id: objectIdSchema,
  quotationId: objectIdSchema,
});

export { idParamsSchema, quotationStatusSchema, quotationCurrencySchema };

export type QuotationItemInput = z.infer<typeof quotationItemSchema>;
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;
export type UpdateQuotationStatusInput = z.infer<typeof updateQuotationStatusSchema>;
export type ListQuotationsQuery = z.infer<typeof listQuotationsQuerySchema>;
