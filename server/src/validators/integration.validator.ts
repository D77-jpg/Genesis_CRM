/**
 * Integration API v1 请求校验（zod）
 * ------------------------------------------------------------------
 * 与 docs/integration/integration-v1.openapi.yaml 保持一致。
 * v1 内只允许向后兼容地新增可选字段。
 */
import { z } from 'zod';

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
