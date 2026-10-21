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
