import { z } from 'zod';
import { INTEGRATION_SCOPES } from '../constants';
export const credentialCreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1).max(10).refine(v => new Set(v).size === v.length),
  expiresAt: z.string().datetime().nullable().optional().refine(v => !v || new Date(v).getTime() > Date.now()),
}).strict();
export const credentialRotateBody = z.object({ graceSeconds: z.number().int().min(0).max(604800).default(86400) }).strict();
export const credentialParams = z.object({ credentialId: z.string().regex(/^[a-f\d]{24}$/i) });
export const credentialListQuery = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const credentialLogQuery = credentialListQuery.extend({ credentialId: z.string().regex(/^[a-f\d]{24}$/i).optional() });
