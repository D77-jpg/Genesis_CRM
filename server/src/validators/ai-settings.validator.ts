import { z } from 'zod';
import { objectIdSchema } from './common';

export const aiSettingsSchema = z.object({
  provider: z.enum(['mock', 'openai']),
  model: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url().max(500),
  /** Omit or leave blank to keep the current encrypted key (or server-env fallback). */
  apiKey: z.string().trim().max(512).optional(),
}).strict();

export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

/** 多服务商配置；openai 兼容服务需要接口地址和模型名，mock 不需要。 */
const aiProviderBaseSchema = z.object({
  name: z.string().trim().min(1, '请填写服务名称').max(60),
  kind: z.enum(['openai', 'mock']),
  model: z.string().trim().max(120).default(''),
  baseUrl: z.string().trim().max(500).default(''),
  /** 编辑时留空表示保留原密钥。 */
  apiKey: z.string().trim().max(512).optional(),
});

function refineProvider(value: z.infer<typeof aiProviderBaseSchema>, ctx: z.RefinementCtx): void {
  if (value.kind !== 'openai') return;
  if (!value.model) {
    ctx.addIssue({ code: 'custom', path: ['model'], message: '请填写模型名称' });
  }
  if (!value.baseUrl) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: '请填写接口地址' });
  }
}

export const aiProviderSchema = aiProviderBaseSchema.strict().superRefine(refineProvider);

export const aiProviderTestSchema = aiProviderBaseSchema.extend({
  /** 编辑已有服务时传入 id，未填新密钥则复用已保存密钥。 */
  id: objectIdSchema.optional(),
}).strict().superRefine(refineProvider);

export type AiProviderInput = z.infer<typeof aiProviderSchema>;
export type AiProviderTestInput = z.infer<typeof aiProviderTestSchema>;
