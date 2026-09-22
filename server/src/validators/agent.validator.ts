import { z } from 'zod';
import { AGENT_CUSTOMER_FIELDS } from '../models';
import { CUSTOMER_PRIORITY, CUSTOMER_STATUS, FOLLOW_UP_METHOD, FOLLOW_UP_RESULT } from '../constants';

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

export const updateAgentSessionSchema = z.object({
  title: z.string().trim().min(1, '会话名称不能为空').max(80, '会话名称不能超过 80 个字符').optional(),
  status: z.literal('archived').optional(),
}).strict().refine((value) => Boolean(value.title || value.status), { message: '至少需要更新一项内容' });

export const sendAgentMessageSchema = z.object({
  content: z.string().trim().min(1, '请输入问题').max(8000, '单次消息不能超过 8000 字'),
  idempotencyKey: z.string().trim().min(16).max(128).regex(/^[a-zA-Z0-9._:-]+$/, '幂等键格式不正确').optional(),
}).strict();

export const agentSessionParamsSchema = z.object({
  id: objectId,
}).strict();

export const agentDiagnosticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
}).strict();

const idempotencyKey = z.string().trim().min(16).max(128).regex(/^[a-zA-Z0-9._:-]+$/, '幂等键格式不正确');

export const agentCustomerFieldsSchema = z.object({
  company: z.string().trim().max(200),
  name: z.string().trim().max(120),
  email: z.string().trim().toLowerCase().max(200),
  phone: z.string().trim().max(60),
  country: z.string().trim().max(120),
  industry: z.string().trim().max(120),
  requirementNotes: z.string().trim().max(5000),
  leadSource: z.string().trim().max(120),
  priority: z.enum(CUSTOMER_PRIORITY),
}).strict();

export const agentCustomerUncertaintySchema = z.object({
  field: z.enum(AGENT_CUSTOMER_FIELDS),
  reason: z.string().trim().min(1).max(300),
  confidence: z.number().min(0).max(1),
}).strict();

export const createAgentCustomerPreviewSchema = z.object({ idempotencyKey }).strict();
export const updateAgentCustomerPreviewSchema = z.object({
  expectedVersion: z.number().int().min(1),
  fields: agentCustomerFieldsSchema,
}).strict();
export const confirmAgentCustomerPreviewSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey,
  duplicateAcknowledged: z.boolean().default(false),
}).strict();
export const agentCustomerPreviewParamsSchema = z.object({ id: objectId }).strict();

export const createAgentCustomerAnalysisSchema = z.object({
  customerId: objectId,
  idempotencyKey,
}).strict();
export const updateAgentCustomerAnalysisSchema = z.object({
  expectedVersion: z.number().int().min(1),
  emailDraft: z.object({
    subject: z.string().trim().min(1, '邮件主题不能为空').max(300),
    bodyText: z.string().trim().min(1, '邮件正文不能为空').max(20000),
  }).strict().optional(),
  followUpPlan: z.object({
    method: z.enum(['email', 'whatsapp', 'phone', 'chat', 'other']),
    content: z.string().trim().min(1, '跟进目的不能为空').max(5000),
    dueAt: z.coerce.date(),
  }).strict().optional(),
}).strict().refine((value) => Boolean(value.emailDraft || value.followUpPlan), { message: '至少需要更新一项内容' });
export const confirmAgentAnalysisActionSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey,
}).strict();
export const agentCustomerAnalysisParamsSchema = z.object({ id: objectId }).strict();

export const createAgentMailAnalysisSchema = z.object({
  mailId: objectId,
  direction: z.enum(['inbound', 'outbound']),
  idempotencyKey,
}).strict();
export const updateAgentMailAnalysisSchema = z.object({
  expectedVersion: z.number().int().min(1),
  replyDraft: z.object({ subject: z.string().trim().max(300), bodyText: z.string().trim().max(20000) }).strict().optional(),
  statusSuggestion: z.object({ status: z.enum(CUSTOMER_STATUS), reason: z.string().trim().min(1).max(1200) }).strict().optional(),
  followUpSuggestion: z.object({
    method: z.enum(FOLLOW_UP_METHOD), content: z.string().trim().min(1).max(5000), result: z.enum(FOLLOW_UP_RESULT),
    nextFollowUpAt: z.union([z.literal(''), z.null(), z.coerce.date()]).optional(),
  }).strict().optional(),
}).strict().refine((value) => Boolean(value.replyDraft || value.statusSuggestion || value.followUpSuggestion), { message: '至少需要更新一项内容' });
export const agentMailAnalysisParamsSchema = z.object({ id: objectId }).strict();

export type CreateAgentSessionBody = z.infer<typeof createAgentSessionSchema>;
export type UpdateAgentSessionBody = z.infer<typeof updateAgentSessionSchema>;
export type SendAgentMessageBody = z.infer<typeof sendAgentMessageSchema>;
export type CreateAgentCustomerPreviewBody = z.infer<typeof createAgentCustomerPreviewSchema>;
export type UpdateAgentCustomerPreviewBody = z.infer<typeof updateAgentCustomerPreviewSchema>;
export type ConfirmAgentCustomerPreviewBody = z.infer<typeof confirmAgentCustomerPreviewSchema>;
export type CreateAgentCustomerAnalysisBody = z.infer<typeof createAgentCustomerAnalysisSchema>;
export type UpdateAgentCustomerAnalysisBody = z.infer<typeof updateAgentCustomerAnalysisSchema>;
export type ConfirmAgentAnalysisActionBody = z.infer<typeof confirmAgentAnalysisActionSchema>;
export type CreateAgentMailAnalysisBody = z.infer<typeof createAgentMailAnalysisSchema>;
export type UpdateAgentMailAnalysisBody = z.infer<typeof updateAgentMailAnalysisSchema>;
