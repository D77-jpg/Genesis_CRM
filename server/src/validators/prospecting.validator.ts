import { z } from 'zod';

export const runProspectingSchema = z.object({
  queries: z.array(z.string().trim().min(3).max(200)).max(10).optional(),
  enrichLimit: z.number().int().min(1).max(80).optional(),
}).strict();

export const rejectProspectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export const prospectingConfigSchema = z.object({
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
