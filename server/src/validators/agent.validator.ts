import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, '资源 ID 格式不正确');

export const agentContextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('customer'), resourceId: objectId }).strict(),
  z.object({ type: z.literal('mail'), resourceId: objectId, direction: z.enum(['inbound', 'outbound']) }).strict(),
]);

export const createAgentSessionSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  context: agentContextSchema.default({ type: 'global' }),
}).strict();

export const sendAgentMessageSchema = z.object({
  content: z.string().trim().min(1, '请输入问题').max(8000, '单次消息不能超过 8000 字'),
}).strict();

export const agentSessionParamsSchema = z.object({
  id: objectId,
}).strict();

export type CreateAgentSessionBody = z.infer<typeof createAgentSessionSchema>;
export type SendAgentMessageBody = z.infer<typeof sendAgentMessageSchema>;
