import { z } from 'zod';

export const searchProfileSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),name:z.string().trim().min(1).max(60),
 queries:z.array(z.string().trim().min(3).max(200)).min(1).max(20),
 enrichLimit:z.number().int().min(1).max(80),hunterLimit:z.number().int().min(0).max(50),
 minScore:z.number().int().min(0).max(100),llmScoring:z.boolean(),
}).strict();
export const runProspectingSchema = z.object({
  profileId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  queries: z.array(z.string().trim().min(3).max(200)).min(1).max(20).optional(),
  enrichLimit: z.number().int().min(1).max(80).optional(),
}).strict();

export const rejectProspectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export const prospectingConfigSchema = z.object({
  version:z.number().int().nonnegative().optional(),
  activeProfileId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  profiles:z.array(searchProfileSchema).min(1).max(20).refine(rows=>new Set(rows.map(p=>p.id)).size===rows.length,'方案标识重复').refine(rows=>new Set(rows.map(p=>p.name.toLowerCase())).size===rows.length,'方案名称不能重复').optional(),
  enabled: z.boolean().optional(),
  dailyTarget: z.number().int().min(1).max(50).optional(),
  queries: z.array(z.string().trim().min(3).max(200)).max(20).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  llmScoring: z.boolean().optional(),
  enrichLimit: z.number().int().min(1).max(80).optional(),
  hunterLimit: z.number().int().min(0).max(50).optional(),
  cooldownDays: z.number().int().min(1).max(365).optional(),
  runAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reviewAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
  ownerId: z.string().regex(/^[0-9a-f]{24}$/i).nullable().optional(),
}).strict();

/**
 * Excel 导入线索：行结构与客户导入一致（前端同一套列映射），
 * 逐行校验在 service 里做，这样一批里混了脏行也能导入其余行。
 */
export const importProspectsSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, '没有可导入的数据')
    .max(3000, '单次最多导入 3000 条线索'),
  /** true 时只做判重与体检，不落库 */
  dryRun: z.boolean().default(false),
});

/** 批量补全范围：按等级 / 来源筛，空串表示不限 */
export const enrichScopeSchema = z.object({
  grade: z.enum(['A', 'B', 'C', '']).optional(),
  source: z.enum(['excel', 'serper', '']).optional(),
});

export const enrichPreviewSchema = enrichScopeSchema;

/** 批量补全：site = 抓官网，hunter = 按域名找邮箱，discover = 搜索补官网 */
export const startEnrichSchema = z.object({
  modes: z
    .array(z.enum(['site', 'hunter', 'discover']))
    .min(1, '至少选择一种补全方式')
    .max(3),
  scope: enrichScopeSchema.optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

/** 线索池列表：按状态筛 + 分页（线索多的时候不可能一次全返回） */
export const todayQuerySchema = z.object({
  status: z.enum(['all', 'ready', 'needs_contact', 'low', 'converted']).optional(),
  limit: z.union([z.string(), z.number()]).optional(),
  offset: z.union([z.string(), z.number()]).optional(),
});
