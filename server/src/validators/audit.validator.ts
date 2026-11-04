import { z } from 'zod';
import { AUDIT_ACTIONS } from '../models';
import { optionalObjectIdSchema } from './common';

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorId: optionalObjectIdSchema,
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
