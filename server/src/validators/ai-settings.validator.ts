import { z } from 'zod';

export const aiSettingsSchema = z.object({
  provider: z.enum(['mock', 'openai']),
  model: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url().max(500),
  /** Omit or leave blank to keep the current encrypted key (or server-env fallback). */
  apiKey: z.string().trim().max(512).optional(),
}).strict();

export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;
