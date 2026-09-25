import { Types } from 'mongoose';
import { z } from 'zod';
import env from '../../config/env';
import {
  AgentAction, AgentMailThreadAnalysis, AgentRun, DevelopmentLetter,
  type AgentMailSafety, type AgentMailThreadAnalysisDocument,
} from '../../models';
import { MailMessage } from '../../models/MailMessage';
import type { AuthUser } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { customerRefScope, requireProjectId } from '../../utils/access';
import { escapeHtml } from '../../utils/text';
import type {
  ConfirmAgentAnalysisActionBody, CreateAgentMailAnalysisBody, UpdateAgentMailAnalysisBody,
} from '../../validators/agent.validator';
import { getCustomerByIdOrThrow, updateCustomer } from '../customer.service';
import { createFollowUp } from '../followup.service';
import { sendLetter } from '../letter.service';
import { MockAgentProvider } from './mock-provider';
import { OpenAIResponsesProvider } from './openai-provider';
import { AgentProviderError, type AgentProvider, type MailThreadAnalysisInput } from './provider';
import {
  agentSafetyIdentifier,
  containsPromptInjection,
  estimateAgentCostUsd,
  limitRecentItems,
  reserveAgentQuota,
  settleAgentQuota,
  type AgentQuotaReservation,
} from './runtime-guard';

function scope(actor: AuthUser) {
  return { projectId: requireProjectId(actor), userId: new Types.ObjectId(actor.id) };
}
function provider(): AgentProvider {
  return env.AI_PROVIDER === 'openai' ? new OpenAIResponsesProvider() : new MockAgentProvider();
}
function safeErrorCode(error: unknown): string {
  if (error instanceof AgentProviderError || error instanceof ApiError) return error.code.slice(0, 80);
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000) return 'DUPLICATE_KEY';
  return 'AGENT_MAIL_ANALYSIS_ERROR';
}
function clipped(value: unknown, max = 12000): string { return String(value ?? '').trim().slice(0, max); }

export function detectProtectedMailSignal(input: { from?: string; subject?: string; text?: string }): { classification: AgentMailSafety; reason: string } {
  const from = `${input.from ?? ''}`.toLowerCase();
  const content = `${input.subject ?? ''}\n${input.text ?? ''}`.toLowerCase();
  if (/mailer-daemon|postmaster/.test(from) || /undeliverable|delivery status notification|mail delivery failed|returned mail|退信|无法投递|投递失败/.test(content)) {
    return { classification: 'bounce', reason: '最新来信显示邮件退信或无法投递，禁止继续建议营销发送。' };
  }
  if (/unsubscribe|remove me|stop emailing|do not contact|opt[ -]?out|退订|取消订阅|不要再发|停止联系/.test(content)) {
    return { classification: 'unsubscribe', reason: '客户明确要求退订或停止联系，禁止继续建议营销发送。' };
  }
  if (/not interested|no longer interested|do not need|we decline|not a fit|不感兴趣|不需要|拒绝|暂不考虑/.test(content)) {
    return { classification: 'rejection', reason: '客户明确拒绝或表示不感兴趣，禁止继续建议营销发送。' };
  }
  if (/\[spam\]|\bspam\b|垃圾邮件|\bjunk mail\b/.test(content)) {
    return { classification: 'spam', reason: '来信标记为垃圾邮件，禁止继续建议营销发送。' };
  }
  return { classification: 'normal', reason: '' };
}

type ThreadMessage = MailThreadAnalysisInput['messages'][number];
async function buildThreadInput(mailId: string, direction: 'inbound' | 'outbound', actor: AuthUser) {
  const visible = await customerRefScope(actor);
  const root = direction === 'inbound'
    ? await MailMessage.findOne({ _id: mailId, deleted: { $ne: true }, ...visible })
    : await DevelopmentLetter.findOne({ _id: mailId, ...visible });
  if (!root) throw ApiError.notFound('邮件不存在或无权访问');
  const threadId = root.threadId || String(root._id);
  const filter = { ...visible, customerId: root.customerId || null, threadId };
  const [inbound, outbound] = await Promise.all([
    MailMessage.find({ ...filter, deleted: { $ne: true } }).sort({ sentAt: -1 }).limit(200),
    DevelopmentLetter.find({ ...filter, status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(200),
  ]);
  const messages: ThreadMessage[] = [
    ...inbound.map((item) => ({ messageId: String(item._id), direction: 'inbound' as const, subject: clipped(item.subject, 300), from: clipped(item.from, 300), to: item.to, text: clipped(item.text), sentAt: item.sentAt.toISOString() })),
    ...outbound.map((item) => ({ messageId: String(item._id), direction: 'outbound' as const, subject: clipped(item.subject, 300), from: clipped(item.senderAddress, 300), to: [item.recipientEmail], text: clipped(item.contentText), sentAt: (item.sentAt ?? item.createdAt).toISOString() })),
  ].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  if (!messages.some((item) => item.messageId === mailId)) {
    const sentAt = direction === 'inbound' ? (root as InstanceType<typeof MailMessage>).sentAt : ((root as InstanceType<typeof DevelopmentLetter>).sentAt ?? (root as InstanceType<typeof DevelopmentLetter>).createdAt);
    messages.push({
      messageId: mailId, direction, subject: clipped(root.subject, 300),
      from: direction === 'inbound' ? clipped((root as InstanceType<typeof MailMessage>).from, 300) : clipped((root as InstanceType<typeof DevelopmentLetter>).senderAddress, 300),
      to: direction === 'inbound' ? (root as InstanceType<typeof MailMessage>).to : [(root as InstanceType<typeof DevelopmentLetter>).recipientEmail],
      text: direction === 'inbound' ? clipped((root as InstanceType<typeof MailMessage>).text) : clipped((root as InstanceType<typeof DevelopmentLetter>).contentText),
      sentAt: sentAt.toISOString(),
    });
  }
  const customer = root.customerId ? await getCustomerByIdOrThrow(String(root.customerId), actor) : null;
  const latestInbound = [...messages].reverse().find((item) => item.direction === 'inbound');
  // Safety is independent of the bounded model context: an older opt-out cannot
  // disappear when a later neutral message arrives or the thread exceeds 200 items.
  const protectedInbound = await MailMessage.findOne({ ...filter, deleted: { $ne: true },
    $or: [
      { from: /mailer-daemon|postmaster/i },
      { subject: /undeliverable|delivery status notification|mail delivery failed|returned mail|退信|无法投递|投递失败|unsubscribe|remove me|stop emailing|do not contact|opt[ -]?out|退订|取消订阅|不要再发|停止联系|not interested|no longer interested|do not need|we decline|not a fit|不感兴趣|不需要|拒绝|暂不考虑|\[spam\]|\bspam\b|垃圾邮件|\bjunk mail\b/i },
      { text: /undeliverable|delivery status notification|mail delivery failed|returned mail|退信|无法投递|投递失败|unsubscribe|remove me|stop emailing|do not contact|opt[ -]?out|退订|取消订阅|不要再发|停止联系|not interested|no longer interested|do not need|we decline|not a fit|不感兴趣|不需要|拒绝|暂不考虑|\[spam\]|\bspam\b|垃圾邮件|\bjunk mail\b/i },
    ],
  }).sort({ sentAt: -1 });
  return {
    root, threadId, messages, latestInbound, protectedInbound: protectedInbound ? {
      messageId: String(protectedInbound._id), from: protectedInbound.from,
      subject: protectedInbound.subject, text: protectedInbound.text,
    } : undefined,
    customer: customer ? { id: customer.id, name: customer.name, company: customer.company, email: customer.email, status: customer.status } : undefined,
  };
}

const evidenceValue = z.object({ value: z.string().max(1200), evidenceMessageIds: z.array(z.string()).max(20) }).strict();
const generatedSchema = z.object({
  summary: z.string().trim().min(1).max(5000),
  intent: z.object({ category: z.enum(['inquiry', 'quotation_request', 'negotiation', 'sample_request', 'order', 'support', 'positive', 'neutral', 'unsubscribe', 'bounce', 'rejection', 'spam', 'other']), label: z.string().trim().min(1).max(120), confidence: z.number().min(0).max(1), evidenceMessageIds: z.array(z.string()).max(20) }).strict(),
  extracted: z.object({ products: z.array(evidenceValue).max(20), quantity: evidenceValue, price: evidenceValue, delivery: evidenceValue, questions: z.array(z.object({ text: z.string().trim().min(1).max(1200), evidenceMessageIds: z.array(z.string()).max(20) }).strict()).max(20) }).strict(),
  safety: z.object({ classification: z.enum(['normal', 'unsubscribe', 'bounce', 'rejection', 'spam']), reason: z.string().max(1200), evidenceMessageIds: z.array(z.string()).max(20) }).strict(),
  replyDraft: z.object({ subject: z.string().max(300), bodyText: z.string().max(20000) }).strict(),
  statusSuggestion: z.object({ status: z.enum(['pending', 'contacted', 'replied', 'interested', 'quoting', 'negotiating', 'won', 'lost']), reason: z.string().trim().min(1).max(1200) }).strict(),
  followUpSuggestion: z.object({ method: z.enum(['email', 'whatsapp', 'phone', 'chat', 'other']), content: z.string().trim().min(1).max(5000), result: z.enum(['no_reply', 'replied', 'interested', 'quoted', 'negotiating', 'won', 'no_need', 'other']), nextFollowUpAt: z.string() }).strict(),
}).strict();

function verifiedIds(ids: string[], known: Set<string>): string[] { return [...new Set(ids)].filter((id) => known.has(id)); }
function dto(doc: AgentMailThreadAnalysisDocument) {
  return {
    id: doc.id, rootMailId: doc.rootMailId, rootDirection: doc.rootDirection, threadId: doc.threadId,
    customerId: doc.customerId ? String(doc.customerId) : undefined,
    sources: doc.sources, summary: doc.summary, intent: doc.intent, extracted: doc.extracted, safety: doc.safety,
    replyDraft: { subject: doc.replyDraft.subject, bodyText: doc.replyDraft.bodyText },
    statusSuggestion: { status: doc.statusSuggestion.status, reason: doc.statusSuggestion.reason },
    followUpSuggestion: { method: doc.followUpSuggestion.method, content: doc.followUpSuggestion.content, result: doc.followUpSuggestion.result, nextFollowUpAt: doc.followUpSuggestion.nextFollowUpAt ?? null },
    replyStatus: doc.replyStatus, customerStatusUpdate: doc.customerStatusUpdate, followUpStatus: doc.followUpStatus,
    createdLetterId: doc.createdLetterId ? String(doc.createdLetterId) : undefined,
    createdFollowUpId: doc.createdFollowUpId ? String(doc.createdFollowUpId) : undefined,
    version: doc.version, lastError: doc.lastError, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}
async function getOrThrow(id: string, actor: AuthUser) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('邮件分析 ID 格式不正确');
  const doc = await AgentMailThreadAnalysis.findOne({ _id: id, ...scope(actor) });
  if (!doc) throw ApiError.notFound('邮件分析不存在或无权访问');
  if (doc.customerId) await getCustomerByIdOrThrow(String(doc.customerId), actor);
  return doc;
}

export async function createMailThreadAnalysis(input: CreateAgentMailAnalysisBody, actor: AuthUser) {
  const identifiers = scope(actor);
  const existing = await AgentMailThreadAnalysis.findOne({ ...identifiers, requestKey: input.idempotencyKey });
  if (existing) return dto(existing);
  const activeProvider = provider();
  const run = await AgentRun.create({ ...identifiers, provider: activeProvider.name, model: activeProvider.model, kind: 'mail_analysis', status: 'running' });
  const startedAt = Date.now();
  let reservation: AgentQuotaReservation | undefined;
  try {
    if (!activeProvider.isAvailable()) throw new AgentProviderError('AGENT_NOT_CONFIGURED');
    const context = await buildThreadInput(input.mailId, input.direction, actor);
    if (!context.messages.length) throw ApiError.badRequest('当前邮件线程没有可分析的内容');
    const limited = limitRecentItems(context.messages, (message) => message.text, (message, text) => ({ ...message, text }));
    reservation = await reserveAgentQuota(actor, limited.inputCharacters);
    const safetyIdentifier = agentSafetyIdentifier(actor);
    const response = await activeProvider.analyzeMailThread({ input: { customer: context.customer, messages: limited.items }, safetyIdentifier });
    const { usage: _usage, ...providerOutput } = response;
    const generated = generatedSchema.parse(providerOutput);
    void _usage;
    const known = new Set(limited.items.map((item) => item.messageId));
    generated.intent.evidenceMessageIds = verifiedIds(generated.intent.evidenceMessageIds, known);
    generated.safety.evidenceMessageIds = verifiedIds(generated.safety.evidenceMessageIds, known);
    generated.extracted.products = generated.extracted.products.map((item) => ({ ...item, evidenceMessageIds: verifiedIds(item.evidenceMessageIds, known) }));
    for (const key of ['quantity', 'price', 'delivery'] as const) generated.extracted[key].evidenceMessageIds = verifiedIds(generated.extracted[key].evidenceMessageIds, known);
    generated.extracted.questions = generated.extracted.questions.map((item) => ({ ...item, evidenceMessageIds: verifiedIds(item.evidenceMessageIds, known) }));
    const safetySource = context.protectedInbound ?? context.latestInbound;
    const deterministic = safetySource ? detectProtectedMailSignal(safetySource) : { classification: 'normal' as const, reason: '' };
    const classification = deterministic.classification !== 'normal' ? deterministic.classification : generated.safety.classification;
    const marketingBlocked = classification !== 'normal';
    const evidenceMessageIds = marketingBlocked && safetySource ? [safetySource.messageId] : generated.safety.evidenceMessageIds;
    const currentStatus = context.customer?.status ?? 'pending';
    if (marketingBlocked) {
      generated.replyDraft = { subject: '', bodyText: '' };
      generated.statusSuggestion = { status: classification === 'bounce' ? currentStatus as typeof generated.statusSuggestion.status : 'lost', reason: deterministic.reason || generated.safety.reason || '检测到受保护信号，建议停止营销。' };
      generated.followUpSuggestion = {
        method: 'email', result: classification === 'bounce' ? 'no_reply' : 'no_need', nextFollowUpAt: '',
        content: `${classification === 'unsubscribe' ? '客户退订' : classification === 'bounce' ? '邮件退信' : classification === 'spam' ? '垃圾邮件' : '客户明确拒绝'}：${deterministic.reason || generated.safety.reason}`,
      };
    }
    const nextFollowUpAt = !marketingBlocked && generated.followUpSuggestion.nextFollowUpAt && !Number.isNaN(Date.parse(generated.followUpSuggestion.nextFollowUpAt))
      ? new Date(generated.followUpSuggestion.nextFollowUpAt) : undefined;
    let analysis: AgentMailThreadAnalysisDocument;
    try {
      analysis = await AgentMailThreadAnalysis.create({
        ...identifiers, rootMailId: input.mailId, rootDirection: input.direction, threadId: context.threadId,
        customerId: context.customer ? new Types.ObjectId(context.customer.id) : undefined,
        replyToMailId: context.latestInbound ? new Types.ObjectId(context.latestInbound.messageId) : undefined,
        requestKey: input.idempotencyKey,
        sources: limited.items.map((item) => ({ messageId: item.messageId, direction: item.direction, subject: item.subject, sentAt: new Date(item.sentAt), label: `${item.direction === 'inbound' ? '收件' : '发件'} · ${item.subject || '无主题'}` })),
        summary: generated.summary, intent: generated.intent, extracted: generated.extracted,
        safety: { classification, marketingBlocked, reason: deterministic.reason || generated.safety.reason, evidenceMessageIds },
        replyDraft: generated.replyDraft, statusSuggestion: generated.statusSuggestion,
        followUpSuggestion: { ...generated.followUpSuggestion, nextFollowUpAt }, replyStatus: marketingBlocked ? 'blocked' : 'editable',
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const raced = await AgentMailThreadAnalysis.findOne({ ...identifiers, requestKey: input.idempotencyKey });
      if (!raced) throw error;
      analysis = raced;
    }
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: {
      workflowId: analysis._id, status: 'completed', inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens, inputCharacters: limited.inputCharacters, inputTruncated: limited.truncated,
      promptInjectionDetected: limited.items.some((item) => containsPromptInjection(item.text)),
      estimatedCostUsd: estimateAgentCostUsd(response.usage, activeProvider.name), durationMs: Date.now() - startedAt,
    } });
    await AgentAction.create({
      ...identifiers, runId: run._id, workflowId: analysis._id, toolName: 'analyze_mail_thread', riskLevel: 'read',
      arguments: { mailId: input.mailId, direction: input.direction, messageCount: limited.items.length, inputTruncated: limited.truncated }, requiresApproval: false,
      approvalStatus: 'not_required', executionStatus: 'succeeded', resultSummary: marketingBlocked ? `已识别${classification}信号并阻断营销建议` : `已分析 ${limited.items.length} 封邮件并生成回复草稿`, executedAt: new Date(),
    });
    await settleAgentQuota(reservation, response.usage);
    return dto(analysis);
  } catch (error) {
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: { status: 'failed', errorCode: safeErrorCode(error), durationMs: Date.now() - startedAt } });
    await settleAgentQuota(reservation);
    if (error instanceof ApiError) throw error;
    if (error instanceof AgentProviderError) throw new ApiError(503, 'Agent 邮件分析服务暂时不可用，CRM 数据未改动', 'INTERNAL_ERROR');
    throw error;
  }
}

export async function getMailThreadAnalysis(id: string, actor: AuthUser) { return dto(await getOrThrow(id, actor)); }

export async function updateMailThreadAnalysis(id: string, input: UpdateAgentMailAnalysisBody, actor: AuthUser) {
  const current = await getOrThrow(id, actor);
  if (current.version !== input.expectedVersion) throw ApiError.conflict('审批内容已更新，请重新载入');
  if (current.safety.marketingBlocked && input.replyDraft) throw ApiError.conflict('该线程已触发停止营销保护，不能编辑或保存回复草稿');
  if (current.replyStatus === 'saved' && input.replyDraft) throw ApiError.conflict('回复草稿已保存，不能继续修改');
  if (current.customerStatusUpdate === 'updated' && input.statusSuggestion) throw ApiError.conflict('客户状态已更新，不能继续修改');
  if (current.followUpStatus === 'saved' && input.followUpSuggestion) throw ApiError.conflict('跟进记录已保存，不能继续修改');
  const patch: Record<string, unknown> = {};
  if (input.replyDraft) patch.replyDraft = input.replyDraft;
  if (input.statusSuggestion) patch.statusSuggestion = input.statusSuggestion;
  if (input.followUpSuggestion) patch.followUpSuggestion = {
    ...input.followUpSuggestion,
    nextFollowUpAt: current.safety.marketingBlocked ? undefined : (input.followUpSuggestion.nextFollowUpAt || undefined),
  };
  const updated = await AgentMailThreadAnalysis.findOneAndUpdate(
    { _id: current._id, ...scope(actor), version: input.expectedVersion },
    { $set: patch, $unset: { lastError: 1 }, $inc: { version: 1 } }, { new: true, runValidators: true },
  );
  if (!updated) throw ApiError.conflict('审批内容已更新，请重新载入');
  await AgentAction.create({ ...scope(actor), workflowId: updated._id, toolName: 'edit_mail_thread_approval', riskLevel: 'write', arguments: { analysisId: updated.id, fields: Object.keys(patch) }, requiresApproval: false, approvalStatus: 'not_required', executionStatus: 'succeeded', resultSummary: '已保存邮件会话审批卡片的编辑内容', executedAt: new Date() });
  return dto(updated);
}

async function approvedAction(identifiers: ReturnType<typeof scope>, workflowId: Types.ObjectId, toolName: string, args: Record<string, unknown>) {
  return AgentAction.create({ ...identifiers, workflowId, toolName, riskLevel: 'write', arguments: args, requiresApproval: true, approvalStatus: 'approved', executionStatus: 'pending', approvedBy: identifiers.userId, approvedAt: new Date() });
}

export async function saveMailReplyDraft(id: string, input: ConfirmAgentAnalysisActionBody, actor: AuthUser) {
  const identifiers = scope(actor); const current = await getOrThrow(id, actor);
  if (current.safety.marketingBlocked || current.replyStatus === 'blocked') throw ApiError.conflict('检测到退订、退信或拒绝信号，禁止继续营销发送或保存回复草稿');
  if (!current.customerId || !current.replyToMailId) throw ApiError.badRequest('当前线程未关联客户或没有可回复的客户来信');
  if (!current.replyDraft.subject.trim() || !current.replyDraft.bodyText.trim()) throw ApiError.badRequest('请先完善回复主题和正文');
  if (current.replyStatus === 'saved' && current.createdLetterId) return { analysis: dto(current), letterId: String(current.createdLetterId), idempotent: true };
  if (current.version !== input.expectedVersion) throw ApiError.conflict('回复草稿已更新，请核对后再次确认');
  const locked = await AgentMailThreadAnalysis.findOneAndUpdate(
    { _id: current._id, ...identifiers, version: input.expectedVersion, replyStatus: { $in: ['editable', 'failed'] } },
    { $set: { replyStatus: 'saving', replyConfirmationKey: input.idempotencyKey }, $inc: { version: 1 } }, { new: true },
  );
  if (!locked) throw ApiError.conflict('回复草稿状态已变化，请重新载入');
  const action = await approvedAction(identifiers, locked._id, 'save_mail_reply_draft', { analysisId: locked.id, customerId: String(locked.customerId) });
  try {
    const result = await sendLetter({ customerId: String(locked.customerId), replyToId: String(locked.replyToMailId), subject: locked.replyDraft.subject, content: `<p>${escapeHtml(locked.replyDraft.bodyText).replace(/\r?\n/g, '<br>')}</p>`, markAsDeveloped: false, saveAsDraft: true, requestKey: `agent-mail-reply:${locked.id}` }, actor);
    if (result.letter.status !== 'draft' || result.delivered) throw ApiError.internal('回复草稿安全校验失败');
    const completed = await AgentMailThreadAnalysis.findOneAndUpdate({ _id: locked._id, ...identifiers, replyConfirmationKey: input.idempotencyKey }, { $set: { replyStatus: 'saved', createdLetterId: new Types.ObjectId(result.letter.id) }, $unset: { lastError: 1 }, $inc: { version: 1 } }, { new: true });
    if (!completed) throw ApiError.conflict('草稿已保存，但审批状态同步失败，请刷新');
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'succeeded', resultSummary: '已保存线程回复草稿，未发送', executedAt: new Date() } });
    return { analysis: dto(completed), letterId: result.letter.id, idempotent: false };
  } catch (error) {
    await AgentMailThreadAnalysis.updateOne({ _id: locked._id, ...identifiers, replyStatus: 'saving' }, { $set: { replyStatus: 'failed', lastError: safeErrorCode(error) }, $inc: { version: 1 } });
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'failed', resultSummary: '回复草稿保存失败，未发送邮件', executedAt: new Date() } });
    throw error;
  }
}

export async function applyMailCustomerStatus(id: string, input: ConfirmAgentAnalysisActionBody, actor: AuthUser) {
  const identifiers = scope(actor); const current = await getOrThrow(id, actor);
  if (!current.customerId) throw ApiError.badRequest('当前线程未关联客户');
  if (current.customerStatusUpdate === 'updated') return { analysis: dto(current), idempotent: true };
  if (current.version !== input.expectedVersion) throw ApiError.conflict('客户状态建议已更新，请核对后再次确认');
  const locked = await AgentMailThreadAnalysis.findOneAndUpdate({ _id: current._id, ...identifiers, version: input.expectedVersion, customerStatusUpdate: { $in: ['editable', 'failed'] } }, { $set: { customerStatusUpdate: 'updating', statusConfirmationKey: input.idempotencyKey }, $inc: { version: 1 } }, { new: true });
  if (!locked) throw ApiError.conflict('客户状态审批已变化，请重新载入');
  const action = await approvedAction(identifiers, locked._id, 'apply_mail_customer_status', { analysisId: locked.id, customerId: String(locked.customerId), status: locked.statusSuggestion.status });
  try {
    await updateCustomer(String(locked.customerId), { status: locked.statusSuggestion.status }, actor);
    const completed = await AgentMailThreadAnalysis.findOneAndUpdate({ _id: locked._id, ...identifiers, statusConfirmationKey: input.idempotencyKey }, { $set: { customerStatusUpdate: 'updated' }, $unset: { lastError: 1 }, $inc: { version: 1 } }, { new: true });
    if (!completed) throw ApiError.conflict('客户状态已更新，但审批状态同步失败，请刷新');
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'succeeded', resultSummary: `已更新客户状态为 ${locked.statusSuggestion.status}`, executedAt: new Date() } });
    return { analysis: dto(completed), idempotent: false };
  } catch (error) {
    await AgentMailThreadAnalysis.updateOne({ _id: locked._id, ...identifiers, customerStatusUpdate: 'updating' }, { $set: { customerStatusUpdate: 'failed', lastError: safeErrorCode(error) }, $inc: { version: 1 } });
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'failed', resultSummary: '客户状态更新失败', executedAt: new Date() } });
    throw error;
  }
}

export async function saveMailFollowUp(id: string, input: ConfirmAgentAnalysisActionBody, actor: AuthUser) {
  const identifiers = scope(actor); const current = await getOrThrow(id, actor);
  if (!current.customerId) throw ApiError.badRequest('当前线程未关联客户');
  if (current.followUpStatus === 'saved' && current.createdFollowUpId) return { analysis: dto(current), followUpId: String(current.createdFollowUpId), idempotent: true };
  if (current.version !== input.expectedVersion) throw ApiError.conflict('跟进建议已更新，请核对后再次确认');
  if (current.safety.marketingBlocked && current.followUpSuggestion.nextFollowUpAt) throw ApiError.conflict('受保护邮件不能安排后续营销跟进');
  const locked = await AgentMailThreadAnalysis.findOneAndUpdate({ _id: current._id, ...identifiers, version: input.expectedVersion, followUpStatus: { $in: ['editable', 'failed'] } }, { $set: { followUpStatus: 'saving', followUpConfirmationKey: input.idempotencyKey }, $inc: { version: 1 } }, { new: true });
  if (!locked) throw ApiError.conflict('跟进记录审批已变化，请重新载入');
  const action = await approvedAction(identifiers, locked._id, 'save_mail_followup_record', { analysisId: locked.id, customerId: String(locked.customerId), protectedSignal: locked.safety.classification });
  try {
    const record = await createFollowUp(String(locked.customerId), {
      method: locked.followUpSuggestion.method, content: locked.followUpSuggestion.content, result: locked.followUpSuggestion.result,
      followUpAt: new Date(), nextFollowUpAt: locked.safety.marketingBlocked ? undefined : locked.followUpSuggestion.nextFollowUpAt,
    }, actor.id, actor.projectId, { agentActionKey: `agent-mail-followup:${locked.id}` });
    const completed = await AgentMailThreadAnalysis.findOneAndUpdate({ _id: locked._id, ...identifiers, followUpConfirmationKey: input.idempotencyKey }, { $set: { followUpStatus: 'saved', createdFollowUpId: new Types.ObjectId(record.id) }, $unset: { lastError: 1 }, $inc: { version: 1 } }, { new: true });
    if (!completed) throw ApiError.conflict('跟进记录已保存，但审批状态同步失败，请刷新');
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'succeeded', resultSummary: locked.safety.marketingBlocked ? '已记录退订/退信/拒绝结果，未安排营销跟进' : '已保存邮件跟进记录', executedAt: new Date() } });
    return { analysis: dto(completed), followUpId: record.id, idempotent: false };
  } catch (error) {
    await AgentMailThreadAnalysis.updateOne({ _id: locked._id, ...identifiers, followUpStatus: 'saving' }, { $set: { followUpStatus: 'failed', lastError: safeErrorCode(error) }, $inc: { version: 1 } });
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'failed', resultSummary: '跟进记录保存失败', executedAt: new Date() } });
    throw error;
  }
}
