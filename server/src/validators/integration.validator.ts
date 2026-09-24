/**
 * Integration API v1 请求校验（zod）
 * ------------------------------------------------------------------
 * 与 docs/integration/integration-v1.openapi.yaml 保持一致。
 * v1 内只允许向后兼容地新增可选字段。
 */
import { z } from 'zod';
import { QUOTATION_CURRENCY } from '../constants';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();

export const upsertCustomerBody = z
  .object({
    schemaVersion: z.string(),
    sourceSystem: trimmed(60),
    externalId: trimmed(128),
    initialStatus: z.enum(['pending', 'contacted', 'interested']).optional(),

    name: optionalTrimmed(120),
    company: optionalTrimmed(200),
    email: z.string().trim().toLowerCase().email('邮箱格式不正确').max(200).optional(),
    phone: optionalTrimmed(60),
    country: optionalTrimmed(120),
    interestedProducts: optionalTrimmed(500),
    leadSource: optionalTrimmed(120),

    productModel: optionalTrimmed(200),
    productCategory: optionalTrimmed(200),
    expectedQuantity: optionalTrimmed(120),
    targetPrice: optionalTrimmed(120),
    moq: optionalTrimmed(120),

    requirementNotes: z.string().trim().max(5000).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  })
  .passthrough(); // v1 兼容策略：忽略未知可选字段，不报错

export type UpsertCustomerBody = z.infer<typeof upsertCustomerBody>;

export const outcomesQuery = z.object({
  cursor: z.string().trim().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type OutcomesQuery = z.infer<typeof outcomesQuery>;

export const externalRefParams = z.object({
  externalRef: z.string().trim().min(1).max(160),
});
export type ExternalRefParams = z.infer<typeof externalRefParams>;

const quotationDraftItem = z
  .object({
    productName: trimmed(200),
    model: optionalTrimmed(200),
    quantity: z.number().positive('数量必须大于 0').max(1_000_000_000, '数量过大'),
    unitPrice: z.number().min(0, '单价不能为负数').max(1_000_000_000, '单价过大'),
  })
  .strict();

const proposalSource = z
  .object({
    kind: z.enum(['lead', 'knowledge', 'customer', 'quotation']),
    referenceId: trimmed(200),
    title: optionalTrimmed(300),
  })
  .strict();

const proposalTrace = z
  .object({
    proposalId: trimmed(128),
    generatedBy: z.literal('autoforce_ai'),
    model: optionalTrimmed(120),
    sources: z.array(proposalSource).min(1).max(50),
  })
  .strict();

/** quotation-draft.v1：只允许建议字段，权威金额、状态和版本不得由调用方提交。 */
export const createQuotationDraftBody = z
  .object({
    schemaVersion: z.literal('1.0'),
    sourceSystem: z.literal('autoforce'),
    title: trimmed(200),
    items: z.array(quotationDraftItem).min(1).max(200),
    currency: z.enum(QUOTATION_CURRENCY),
    validityDate: z.union([z.string().datetime(), z.null()]).optional(),
    paymentTerms: optionalTrimmed(300),
    leadTime: optionalTrimmed(200),
    moq: optionalTrimmed(120),
    notes: optionalTrimmed(5000),
    markCustomerAsQuoting: z.boolean().default(false),
    proposalTrace: proposalTrace.optional(),
  })
  .strict();

export type CreateQuotationDraftBody = z.infer<typeof createQuotationDraftBody>;

export const quotationIdParams = z.object({
  quotationId: z.string().regex(/^[a-f\d]{24}$/i, '报价 ID 格式不正确'),
});

export const quotationExternalRefParams = z.object({
  externalRef: z.string().trim().min(1).max(128),
});
