import { z } from 'zod';
import { DevelopmentLetter } from '../../models';
import { MailMessage } from '../../models/MailMessage';
import type { AuthUser } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { customerRefScope } from '../../utils/access';
import { getCustomer, getCustomerByIdOrThrow } from '../customer.service';
import { listFollowUps } from '../followup.service';
import { listCustomerQuotations } from '../quotation.service';
import { getSalesWorkspace } from '../stats.service';
import { getCustomerTimeline } from '../timeline.service';
import type { AgentToolSchema } from './provider';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export interface AgentToolContext {
  actor: AuthUser;
}

export interface RegisteredAgentTool {
  name: string;
  description: string;
  riskLevel: 'read';
  parameters: Record<string, unknown>;
  execute: (context: AgentToolContext, input: unknown) => Promise<unknown>;
}

async function getMailThread(actor: AuthUser, input: unknown) {
  const args = z.object({ mailId: objectId, direction: z.enum(['inbound', 'outbound']) }).strict().parse(input);
  const scope = await customerRefScope(actor);
  const root = args.direction === 'outbound'
    ? await DevelopmentLetter.findOne({ _id: args.mailId, ...scope }).lean()
    : await MailMessage.findOne({ _id: args.mailId, deleted: { $ne: true }, ...scope }).lean();
  if (!root) throw ApiError.notFound('邮件不存在或无权访问');
  if (root.customerId) await getCustomerByIdOrThrow(String(root.customerId), actor);
  const threadId = root.threadId || String(root._id);
  const filter = { ...scope, customerId: root.customerId || null, threadId };
  const [received, sent] = await Promise.all([
    MailMessage.find({ ...filter, deleted: { $ne: true } }).sort({ sentAt: 1 }).limit(50).lean(),
    DevelopmentLetter.find({ ...filter, status: { $ne: 'draft' } }).sort({ createdAt: 1 }).limit(50).lean(),
  ]);
  const thread = [
    ...received.map((mail) => ({
      id: String(mail._id), direction: 'inbound', subject: mail.subject, from: mail.from,
      to: mail.to, cc: mail.cc, content: String(mail.text || '').slice(0, 6000), sentAt: mail.sentAt,
    })),
    ...sent.map((mail) => ({
      id: String(mail._id), direction: 'outbound', subject: mail.subject, from: mail.senderAddress,
      to: [mail.recipientEmail], content: String(mail.contentText || '').slice(0, 6000),
      sentAt: mail.sentAt || mail.createdAt, status: mail.status,
    })),
  ].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
  return { threadId, customerId: root.customerId ? String(root.customerId) : null, thread };
}

const tools: RegisteredAgentTool[] = [
  {
    name: 'get_current_customer',
    description: 'Read the current CRM customer profile. Never modifies customer data.',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { customerId: { type: 'string', description: 'CRM customer ObjectId' } }, required: ['customerId'], additionalProperties: false },
    execute: async ({ actor }, input) => {
      const { customerId } = z.object({ customerId: objectId }).strict().parse(input);
      return getCustomer(customerId, actor);
    },
  },
  {
    name: 'get_customer_timeline',
    description: 'Read a customer activity timeline, including mail, follow-ups and quotations.',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { customerId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['customerId', 'limit'], additionalProperties: false },
    execute: async ({ actor }, input) => {
      const { customerId, limit } = z.object({ customerId: objectId, limit: z.number().int().min(1).max(100) }).strict().parse(input);
      await getCustomerByIdOrThrow(customerId, actor);
      return getCustomerTimeline(customerId, limit, actor);
    },
  },
  {
    name: 'get_mail_thread',
    description: 'Read one authorized CRM mail thread as plain text. Never sends or changes mail.',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { mailId: { type: 'string' }, direction: { type: 'string', enum: ['inbound', 'outbound'] } }, required: ['mailId', 'direction'], additionalProperties: false },
    execute: ({ actor }, input) => getMailThread(actor, input),
  },
  {
    name: 'get_customer_followups',
    description: 'Read follow-up records for an authorized customer.',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { customerId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['customerId', 'limit'], additionalProperties: false },
    execute: async ({ actor }, input) => {
      const { customerId, limit } = z.object({ customerId: objectId, limit: z.number().int().min(1).max(100) }).strict().parse(input);
      await getCustomerByIdOrThrow(customerId, actor);
      return { items: await listFollowUps(customerId, limit, actor.projectId) };
    },
  },
  {
    name: 'get_customer_quotations',
    description: 'Read quotation records for an authorized customer.',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { customerId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['customerId', 'limit'], additionalProperties: false },
    execute: async ({ actor }, input) => {
      const { customerId, limit } = z.object({ customerId: objectId, limit: z.number().int().min(1).max(100) }).strict().parse(input);
      await getCustomerByIdOrThrow(customerId, actor);
      return { items: await listCustomerQuotations(customerId, limit, actor) };
    },
  },
  {
    name: 'get_dashboard_summary',
    description: 'Read the current user dashboard summary within the active project.',
    riskLevel: 'read',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    execute: ({ actor }) => getSalesWorkspace(actor),
  },
];

const registry = new Map(tools.map((tool) => [tool.name, tool]));

export function listAgentTools(): RegisteredAgentTool[] {
  return [...tools];
}

export function agentToolSchemas(): AgentToolSchema[] {
  return tools.map(({ name, description, parameters }) => ({ type: 'function', name, description, parameters, strict: true }));
}

export async function executeAgentTool(name: string, context: AgentToolContext, input: unknown): Promise<unknown> {
  const tool = registry.get(name);
  if (!tool || tool.riskLevel !== 'read') throw ApiError.badRequest('Agent 请求了未注册或非只读工具');
  return tool.execute(context, input);
}
