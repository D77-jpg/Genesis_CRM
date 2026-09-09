/**
 * 跟进记录（FollowUp）相关请求校验
 */
import { z } from 'zod';
import { FOLLOW_UP_METHOD, FOLLOW_UP_RESULT } from '../constants';
import { idParamsSchema, isoDateSchema, objectIdSchema } from './common';

const followUpMethodSchema = z.enum(FOLLOW_UP_METHOD, {
  errorMap: () => ({ message: '跟进方式取值非法' }),
});

const followUpResultSchema = z.enum(FOLLOW_UP_RESULT, {
  errorMap: () => ({ message: '跟进结果取值非法' }),
});

/**
 * 下一次跟进时间（写入用）：ISO → Date；'' / null / 未传 一律视为「未设置」。
 */
const nextFollowUpInputSchema = z
  .union([z.literal(''), z.null(), isoDateSchema])
  .transform((v) => (v === '' || v === null ? undefined : v))
  .optional();

/**
 * 编辑用的下一次跟进时间：保留 null（显式清除）与「不传」（保持原值）的区别，
 * 与新增用的 nextFollowUpInputSchema（空值→undefined，即不设置）语义不同。
 */
const nextFollowUpUpdateSchema = z
  .union([z.literal(''), z.null(), isoDateSchema])
  .transform((v) => (v === '' || v === null ? null : v))
  .optional();

export const createFollowUpSchema = z.object({
  method: followUpMethodSchema.default('email'),
  content: z.string().trim().min(1, '跟进内容不能为空').max(5000, '跟进内容不能超过 5000 个字符'),
  result: followUpResultSchema.default('no_reply'),
  /** 本次跟进发生的时间，不传默认当前时间 */
  followUpAt: isoDateSchema.optional(),
  /** 计划的下一次跟进时间，填写后会同步到客户主档 */
  nextFollowUpAt: nextFollowUpInputSchema,
});

/**
 * 编辑跟进记录：所有字段均可选，只更新明确提供的字段（partial + 至少一个字段）。
 * 复用与新增一致的取值约束，保证编辑后的数据同样合法。
 */
export const updateFollowUpSchema = z
  .object({
    method: followUpMethodSchema,
    content: z.string().trim().min(1, '跟进内容不能为空').max(5000, '跟进内容不能超过 5000 个字符'),
    result: followUpResultSchema,
    followUpAt: isoDateSchema,
    nextFollowUpAt: nextFollowUpUpdateSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: '请至少提供一个需要修改的字段',
  });

/** 路径参数：客户 id + 跟进记录 id（删除单条跟进记录用） */
export const followUpIdParamsSchema = z.object({
  id: objectIdSchema,
  followUpId: objectIdSchema,
});

/** 列表查询：单个客户的跟进记录通常不多，给一个宽松的默认上限即可 */
export const listFollowUpsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export { idParamsSchema, followUpMethodSchema, followUpResultSchema };

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;
