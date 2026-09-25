import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import env from '../../config/env';
import {
  AgentAction,
  AgentCustomerPreview,
  AgentRun,
  Customer,
  AGENT_CUSTOMER_FIELDS,
  Scratchpad,
  type AgentCustomerPreviewDocument,
  type AgentCustomerPreviewFields,
  type AgentCustomerUncertainty,
} from '../../models';
import type { AuthUser } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { customerScope, requireProjectId } from '../../utils/access';
import { escapeRegExp } from '../../utils/text';
import { createCustomer } from '../customer.service';
import { MailMessage } from '../../models/MailMessage';
import { detectProtectedMailSignal } from './mail-thread-analysis.service';
import { createCustomerSchema } from '../../validators/customer.validator';
import {
  agentCustomerFieldsSchema,
  agentCustomerUncertaintySchema,
  type ConfirmAgentCustomerPreviewBody,
  type CreateAgentCustomerPreviewBody,
  type CreateAgentMailCustomerPreviewBody,
  type UpdateAgentCustomerPreviewBody,
} from '../../validators/agent.validator';
import { MockAgentProvider } from './mock-provider';
import { OpenAIResponsesProvider } from './openai-provider';
import { AgentProviderError, type AgentProvider } from './provider';
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
  if (error instanceof AgentProviderError) return error.code.slice(0, 80);
  if (error instanceof ApiError) return error.code.slice(0, 80);
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000) return 'DUPLICATE_KEY';
  return 'AGENT_CUSTOMER_WORKFLOW_ERROR';
}

function nullable(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function dto(doc: AgentCustomerPreviewDocument) {
  const raw = doc.toObject();
  return {
    id: doc.id,
    sourceVersion: doc.sourceVersion,
    sourceKind: doc.sourceKind ?? 'scratchpad',
    sourceMailId: doc.sourceMailId ? String(doc.sourceMailId) : undefined,
    facts: doc.facts ?? [],
    inferences: doc.inferences ?? [],
    fields: raw.fields,
    uncertainties: doc.uncertainties.map((item) => ({ field: item.field, reason: item.reason, confidence: item.confidence })),
    duplicates: doc.duplicates.map((item) => ({
      customerId: String(item.customerId), name: item.name, company: item.company, email: item.email, phone: item.phone, reasons: item.reasons,
    })),
    status: doc.status,
    version: doc.version,
    createdCustomerId: doc.createdCustomerId ? String(doc.createdCustomerId) : undefined,
    lastError: doc.lastError,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizedPhone(value: string): string {
  return value.replace(/\D/g, '');
}

async function findDuplicates(fields: AgentCustomerPreviewFields, actor: AuthUser) {
  const conditions: Record<string, unknown>[] = [];
  if (fields.email) conditions.push({ email: fields.email.toLowerCase() });
  if (fields.phone) {
    const digits = normalizedPhone(fields.phone);
    if (digits.length >= 6) conditions.push({ phone: new RegExp(`^\\D*${digits.split('').join('\\D*')}\\D*$`) });
  }
  if (fields.company) conditions.push({ company: new RegExp(`^${escapeRegExp(fields.company)}$`, 'i') });
  const domain = fields.email.split('@')[1]?.toLowerCase();
  if (domain && !/^(gmail|yahoo|outlook|hotmail|icloud|qq|163|126|protonmail)\./i.test(domain)) {
    conditions.push({ email: new RegExp(`@${escapeRegExp(domain)}$`, 'i') });
    conditions.push({ website: new RegExp(`^(?:https?:\\/\\/)?(?:www\\.)?${escapeRegExp(domain)}(?:[\\/:?#]|$)`, 'i') });
  }
  if (fields.name) conditions.push({ name: new RegExp(`^${escapeRegExp(fields.name)}$`, 'i') });
  if (conditions.length === 0) return [];
  const docs = await Customer.find({ ...customerScope(actor), $or: conditions }).select('name company email phone website').limit(10).lean();
  return docs.map((item) => {
    const reasons: string[] = [];
    if (fields.email && item.email?.toLowerCase() === fields.email.toLowerCase()) reasons.push('邮箱相同');
    if (domain && !/^(gmail|yahoo|outlook|hotmail|icloud|qq|163|126|protonmail)\./i.test(domain) &&
      (item.email?.toLowerCase().endsWith(`@${domain}`) || new RegExp(`^(?:https?:\\/\\/)?(?:www\\.)?${escapeRegExp(domain)}(?:[\\/:?#]|$)`, 'i').test(item.website ?? ''))) reasons.push('企业域名相同');
    if (fields.phone && item.phone && normalizedPhone(item.phone) === normalizedPhone(fields.phone)) reasons.push('电话相同');
    if (fields.company && item.company?.localeCompare(fields.company, undefined, { sensitivity: 'base' }) === 0) reasons.push('公司相同');
    if (fields.name && item.name.localeCompare(fields.name, undefined, { sensitivity: 'base' }) === 0) reasons.push('联系人相同');
    return { customerId: item._id, name: item.name, company: item.company, email: item.email, phone: item.phone, reasons };
  }).filter((item) => item.reasons.length > 0);
}

function requireMailAdmin(actor: AuthUser): void {
  if (actor.role !== 'admin') throw ApiError.notFound('邮件不存在或无权访问');
}

function mailSourceHash(mail: { from: string; fromName?: string | null; subject: string; text: string }): string {
  return createHash('sha256').update(JSON.stringify([mail.from, mail.fromName ?? '', mail.subject, mail.text])).digest('hex');
}

function assertSafeMail(mail: { from: string; subject: string; text: string }): void {
  const content = `${mail.from}\n${mail.subject}\n${mail.text}`;
  if (detectProtectedMailSignal(mail).classification !== 'normal' ||
    /\bspam\b|垃圾邮件|广告垃圾|junk mail|unsolicited bulk/i.test(content) || containsPromptInjection(content)) {
    throw ApiError.conflict('邮件包含退订、退信、拒绝、垃圾邮件或指令注入信号，禁止提议创建客户');
  }
}

async function getMailSource(mailId: string, actor: AuthUser) {
  requireMailAdmin(actor);
  const mail = await MailMessage.findOne({ _id: mailId, projectId: requireProjectId(actor), deleted: { $ne: true }, customerId: null });
  if (!mail) throw ApiError.notFound('邮件不存在或无权访问');
  const thread = await MailMessage.find({ projectId: requireProjectId(actor), threadId: mail.threadId, deleted: { $ne: true } })
    .select('from subject text').limit(201).lean();
  if (thread.length > 200) throw ApiError.conflict('邮件会话过长，无法完整复核历史安全信号，请人工处理');
  // Historical stop-contact signals remain binding even when a newer message looks benign.
  for (const message of thread) assertSafeMail(message);
  assertSafeMail(mail);
  return mail;
}

async function getPreviewOrThrow(id: string, actor: AuthUser) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('预览 ID 格式不正确');
  const preview = await AgentCustomerPreview.findOne({ _id: id, ...scope(actor) });
  if (!preview) throw ApiError.notFound('客户预览不存在或无权访问');
  if (preview.sourceKind === 'mail') {
    requireMailAdmin(actor);
    if (!preview.sourceMailId) throw ApiError.notFound('邮件不存在或无权访问');
    const mail = await getMailSource(String(preview.sourceMailId), actor);
    if (preview.sourceHash !== mailSourceHash(mail)) throw ApiError.conflict('来源邮件已更新，请重新提取客户预览');
  }
  return preview;
}

export async function createScratchpadCustomerPreview(input: CreateAgentCustomerPreviewBody, actor: AuthUser) {
  const identifiers = scope(actor);
  const existing = await AgentCustomerPreview.findOne({ ...identifiers, requestKey: input.idempotencyKey });
  if (existing) {
    if (existing.sourceKind === 'mail') throw ApiError.conflict('幂等键已用于邮件客户预览');
    return dto(existing);
  }
  const scratchpad = await Scratchpad.findOne(identifiers).lean();
  const content = scratchpad?.content ?? '';
  if (!content.trim()) throw ApiError.badRequest('随手记为空，请先填写客户信息');

  const activeProvider = provider();
  const limited = limitRecentItems([content], (value) => value, (_value, next) => next);
  const run = await AgentRun.create({
    ...identifiers, provider: activeProvider.name, model: activeProvider.model, kind: 'scratchpad', status: 'running',
    inputCharacters: limited.inputCharacters, inputTruncated: limited.truncated, promptInjectionDetected: containsPromptInjection(content),
  });
  const startedAt = Date.now();
  let reservation: AgentQuotaReservation | undefined;
  try {
    if (!activeProvider.isAvailable()) throw new AgentProviderError('AGENT_NOT_CONFIGURED');
    reservation = await reserveAgentQuota(actor, limited.inputCharacters);
    const safetyIdentifier = agentSafetyIdentifier(actor);
    const extracted = await activeProvider.extractCustomer({ content: limited.items[0] ?? '', safetyIdentifier });
    const fields = agentCustomerFieldsSchema.parse(extracted.fields);
    const uncertainties = extracted.uncertainties.map((item) => agentCustomerUncertaintySchema.parse(item)) as AgentCustomerUncertainty[];
    const duplicates = await findDuplicates(fields, actor);
    let preview: AgentCustomerPreviewDocument;
    try {
      preview = await AgentCustomerPreview.create({
        ...identifiers,
        requestKey: input.idempotencyKey,
        sourceHash: createHash('sha256').update(content).digest('hex'),
        sourceVersion: scratchpad?.version ?? 0,
        fields,
        uncertainties,
        duplicates,
        status: 'preview',
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000) {
        const raced = await AgentCustomerPreview.findOne({ ...identifiers, requestKey: input.idempotencyKey });
        if (raced) {
          if (raced.sourceKind === 'mail') throw ApiError.conflict('幂等键已用于邮件客户预览');
          await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: {
            workflowId: raced._id, status: 'completed', inputTokens: extracted.usage.inputTokens,
            outputTokens: extracted.usage.outputTokens, totalTokens: extracted.usage.totalTokens,
            estimatedCostUsd: estimateAgentCostUsd(extracted.usage, activeProvider.name), durationMs: Date.now() - startedAt,
          } });
          await settleAgentQuota(reservation, extracted.usage);
          return dto(raced);
        }
      }
      throw error;
    }
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: {
      workflowId: preview._id, status: 'completed', inputTokens: extracted.usage.inputTokens,
      outputTokens: extracted.usage.outputTokens, totalTokens: extracted.usage.totalTokens,
      estimatedCostUsd: estimateAgentCostUsd(extracted.usage, activeProvider.name), durationMs: Date.now() - startedAt,
    } });
    await AgentAction.create({
      ...identifiers, runId: run._id, workflowId: preview._id, toolName: 'extract_scratchpad_customer', riskLevel: 'read',
      arguments: { sourceVersion: preview.sourceVersion, sourceHash: preview.sourceHash.slice(0, 12) }, requiresApproval: false,
      approvalStatus: 'not_required', executionStatus: 'succeeded', resultSummary: `已提取客户预览，发现 ${duplicates.length} 个可能重复项`, executedAt: new Date(),
    });
    await settleAgentQuota(reservation, extracted.usage);
    return dto(preview);
  } catch (error) {
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: { status: 'failed', errorCode: safeErrorCode(error), durationMs: Date.now() - startedAt } });
    await settleAgentQuota(reservation);
    if (error instanceof ApiError) throw error;
    if (error instanceof AgentProviderError) throw new ApiError(503, 'Agent 提取服务暂时不可用，随手记和 CRM 数据均未改动', 'INTERNAL_ERROR');
    throw error;
  }
}

export async function createMailCustomerPreview(input: CreateAgentMailCustomerPreviewBody, actor: AuthUser) {
  requireMailAdmin(actor);
  const identifiers = scope(actor);
  // Authorize the requested mail before returning an idempotent result: no guessed ID can reveal a preview.
  const mail = await getMailSource(input.mailId, actor);
  const existing = await AgentCustomerPreview.findOne({ ...identifiers, requestKey: input.idempotencyKey });
  if (existing) {
    if (existing.sourceKind !== 'mail' || String(existing.sourceMailId) !== input.mailId) throw ApiError.conflict('幂等键已用于其他来源');
    if (existing.sourceHash !== mailSourceHash(mail)) throw ApiError.conflict('来源邮件已更新，请重新提取');
    return dto(existing);
  }
  const header = mail.from.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i)?.[1]?.toLowerCase() ?? '';
  if (!header) throw ApiError.badRequest('发件人邮箱无法识别，请人工核对');
  const fromName = String(mail.fromName ?? '').trim();
  const content = `发件人: ${mail.from}\n联系人: ${fromName}\n主题: ${mail.subject}\n${mail.text ?? ''}`;
  const activeProvider = provider();
  const limited = limitRecentItems([content], (value) => value, (_value, next) => next);
  const run = await AgentRun.create({ ...identifiers, provider: activeProvider.name, model: activeProvider.model,
    kind: 'scratchpad', status: 'running', inputCharacters: limited.inputCharacters, inputTruncated: limited.truncated,
    promptInjectionDetected: containsPromptInjection(content) });
  const startedAt = Date.now();
  let reservation: AgentQuotaReservation | undefined;
  try {
    if (!activeProvider.isAvailable()) throw new AgentProviderError('AGENT_NOT_CONFIGURED');
    reservation = await reserveAgentQuota(actor, limited.inputCharacters);
    const extracted = await activeProvider.extractCustomer({ content: limited.items[0] ?? '', safetyIdentifier: agentSafetyIdentifier(actor) });
    // A provider may hallucinate sender details; the email address comes only from the persisted header.
    const fields = agentCustomerFieldsSchema.parse({ ...extracted.fields, email: header, leadSource: '邮件' });
    const facts: NonNullable<AgentCustomerPreviewDocument['facts']> = [
      { field: 'email', value: header, mailId: input.mailId },
      ...(fromName && fields.name === fromName
        ? [{ field: 'name' as const, value: fields.name, mailId: input.mailId }] : []),
    ];
    const inferences: NonNullable<AgentCustomerPreviewDocument['inferences']> = AGENT_CUSTOMER_FIELDS
      .filter((field) => field !== 'email' && field !== 'leadSource' && field !== 'priority' && Boolean(fields[field]) && !(field === 'name' && fromName && fields.name === fromName))
      .map((field) => ({ field, value: fields[field], reason: '模型根据不可信邮件内容提取，需人工核对', mailId: input.mailId }));
    const uncertainties = extracted.uncertainties.map((item) => agentCustomerUncertaintySchema.parse(item)) as AgentCustomerUncertainty[];
    for (const field of AGENT_CUSTOMER_FIELDS) {
      if (field === 'email' || field === 'leadSource' || uncertainties.some((item) => item.field === field)) continue;
      uncertainties.push({ field, reason: field === 'priority' ? '优先级为模型建议，需人工确认' : '邮件内容或提取结果需人工核对', confidence: fields[field] ? 0.4 : 0.2 });
    }
    const duplicates = await findDuplicates(fields, actor);
    // Reject if the source was linked, deleted, modified, or marked unsafe during model inference.
    const fresh = await getMailSource(input.mailId, actor);
    if (mailSourceHash(fresh) !== mailSourceHash(mail)) throw ApiError.conflict('邮件已更新，请重新提取');
    let preview: AgentCustomerPreviewDocument;
    try {
      preview = await AgentCustomerPreview.create({ ...identifiers, requestKey: input.idempotencyKey,
        sourceKind: 'mail', sourceMailId: mail._id, sourceHash: mailSourceHash(mail), sourceVersion: 0,
        facts, inferences, fields, uncertainties, duplicates, status: 'preview' });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const raced = await AgentCustomerPreview.findOne({ ...identifiers, requestKey: input.idempotencyKey });
      if (!raced || raced.sourceKind !== 'mail' || String(raced.sourceMailId) !== input.mailId || raced.sourceHash !== mailSourceHash(mail)) throw error;
      preview = raced;
    }
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: { workflowId: preview._id, status: 'completed',
      inputTokens: extracted.usage.inputTokens, outputTokens: extracted.usage.outputTokens, totalTokens: extracted.usage.totalTokens,
      estimatedCostUsd: estimateAgentCostUsd(extracted.usage, activeProvider.name), durationMs: Date.now() - startedAt } });
    await AgentAction.create({ ...identifiers, runId: run._id, workflowId: preview._id, toolName: 'extract_mail_customer',
      riskLevel: 'read', arguments: { mailId: input.mailId }, requiresApproval: false, approvalStatus: 'not_required',
      executionStatus: 'succeeded', resultSummary: `已生成邮件客户预览，发现 ${duplicates.length} 个可能重复项`, executedAt: new Date() });
    await settleAgentQuota(reservation, extracted.usage);
    return dto(preview);
  } catch (error) {
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: { status: 'failed', errorCode: safeErrorCode(error), durationMs: Date.now() - startedAt } });
    await settleAgentQuota(reservation);
    if (error instanceof ApiError) throw error;
    if (error instanceof AgentProviderError) throw new ApiError(503, '邮件提取服务暂时不可用，未创建客户', 'INTERNAL_ERROR');
    throw error;
  }
}

export async function getScratchpadCustomerPreview(id: string, actor: AuthUser) {
  return dto(await getPreviewOrThrow(id, actor));
}

export async function updateScratchpadCustomerPreview(id: string, input: UpdateAgentCustomerPreviewBody, actor: AuthUser) {
  const current = await getPreviewOrThrow(id, actor);
  if (current.status !== 'preview' && current.status !== 'failed') throw ApiError.conflict('当前预览已无法编辑');
  if (current.version !== input.expectedVersion) throw ApiError.conflict('预览已在其他页面更新，请重新载入');
  const changed = (Object.keys(input.fields) as (keyof AgentCustomerPreviewFields)[])
    .filter((field) => current.fields[field] !== input.fields[field]);
  const uncertainties = current.uncertainties.filter((item) => !changed.includes(item.field));
  const duplicates = await findDuplicates(input.fields, actor);
  const updated = await AgentCustomerPreview.findOneAndUpdate(
    { _id: current._id, ...scope(actor), version: input.expectedVersion, status: { $in: ['preview', 'failed'] } },
    { $set: { fields: input.fields, uncertainties, duplicates, status: 'preview' }, $unset: { lastError: 1 }, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  if (!updated) throw ApiError.conflict('预览已在其他页面更新，请重新载入');
  await AgentAction.create({
    ...scope(actor), workflowId: updated._id, toolName: 'update_scratchpad_customer_preview', riskLevel: 'write',
    arguments: { previewId: updated.id, changedFields: changed }, requiresApproval: false,
    approvalStatus: 'not_required', executionStatus: 'succeeded', resultSummary: `已保存预览并重新查重（${changed.length} 个字段）`, executedAt: new Date(),
  });
  return dto(updated);
}

function customerPayload(fields: AgentCustomerPreviewFields) {
  return {
    name: fields.name,
    company: nullable(fields.company), email: nullable(fields.email), phone: nullable(fields.phone), country: nullable(fields.country),
    industry: nullable(fields.industry), requirementNotes: nullable(fields.requirementNotes), leadSource: nullable(fields.leadSource),
    priority: fields.priority, status: 'pending' as const, tags: [],
  };
}

export async function confirmScratchpadCustomerPreview(id: string, input: ConfirmAgentCustomerPreviewBody, actor: AuthUser) {
  const identifiers = scope(actor);
  const current = await getPreviewOrThrow(id, actor);
  if (current.status === 'created' && current.createdCustomerId) {
    return { preview: dto(current), customerId: String(current.createdCustomerId), idempotent: true };
  }
  if (current.status === 'cancelled') throw ApiError.conflict('该预览已取消，未创建客户');
  if (current.status === 'creating') throw ApiError.conflict('客户正在创建，请勿重复提交');
  if (current.version !== input.expectedVersion) throw ApiError.conflict('预览已更新，请核对最新内容后再次确认');

  const parsed = createCustomerSchema.safeParse(customerPayload(current.fields));
  if (!parsed.success) {
    throw ApiError.validation(parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })), '请先修正客户预览中的字段');
  }
  const duplicates = await findDuplicates(current.fields, actor);
  if (duplicates.length > 0 && !input.duplicateAcknowledged) throw ApiError.conflict('发现可能重复客户，请核对并明确勾选后再创建');

  const locked = await AgentCustomerPreview.findOneAndUpdate(
    { _id: current._id, ...identifiers, version: input.expectedVersion, status: { $in: ['preview', 'failed'] } },
    { $set: { status: 'creating', confirmationKey: input.idempotencyKey, duplicates }, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  if (!locked) throw ApiError.conflict('预览状态已变化，请重新载入');
  const creationKey = `agent-preview:${locked.id}`;
  const action = await AgentAction.create({
    ...identifiers, workflowId: locked._id, toolName: 'create_customer_from_scratchpad', riskLevel: 'write',
    arguments: { previewId: locked.id, expectedVersion: input.expectedVersion }, requiresApproval: true,
    approvalStatus: 'approved', executionStatus: 'pending', approvedBy: new Types.ObjectId(actor.id), approvedAt: new Date(),
  });
  try {
    let customerId: string;
    try {
      if (locked.sourceKind === 'mail' && locked.sourceMailId) {
        const source = await getMailSource(String(locked.sourceMailId), actor);
        if (mailSourceHash(source) !== locked.sourceHash) throw ApiError.conflict('来源邮件已变更，禁止创建客户');
      }
      const customer = await createCustomer(parsed.data, actor, { agentCreationKey: creationKey });
      customerId = customer.id;
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000)) throw error;
      const existing = await Customer.findOne({ projectId: identifiers.projectId, agentCreationKey: creationKey }).select('+agentCreationKey _id').lean();
      if (!existing) throw error;
      customerId = String(existing._id);
    }
    const completed = await AgentCustomerPreview.findOneAndUpdate(
      { _id: locked._id, ...identifiers, confirmationKey: input.idempotencyKey },
      { $set: { status: 'created', createdCustomerId: new Types.ObjectId(customerId) }, $unset: { lastError: 1 }, $inc: { version: 1 } },
      { new: true },
    );
    if (!completed) throw ApiError.conflict('客户已创建，但预览状态同步失败，请刷新后重试');
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: {
      executionStatus: 'succeeded', resultSummary: `已确认创建客户 ${customerId}`, executedAt: new Date(),
    } });
    return { preview: dto(completed), customerId, idempotent: false };
  } catch (error) {
    await AgentCustomerPreview.updateOne({ _id: locked._id, ...identifiers, status: 'creating' }, { $set: { status: 'failed', lastError: safeErrorCode(error) }, $inc: { version: 1 } });
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'failed', resultSummary: '客户创建失败，随手记未改动', executedAt: new Date() } });
    throw error;
  }
}

export async function cancelScratchpadCustomerPreview(id: string, actor: AuthUser) {
  const identifiers = scope(actor);
  const current = await getPreviewOrThrow(id, actor);
  if (current.status === 'created') throw ApiError.conflict('客户已创建，无法取消该预览');
  if (current.status === 'creating') throw ApiError.conflict('客户正在创建，无法取消');
  if (current.status === 'cancelled') return dto(current);
  const cancelled = await AgentCustomerPreview.findOneAndUpdate(
    { _id: current._id, ...identifiers, status: { $in: ['preview', 'failed'] } },
    { $set: { status: 'cancelled' }, $inc: { version: 1 } }, { new: true },
  );
  if (!cancelled) throw ApiError.conflict('预览状态已变化，请重新载入');
  await AgentAction.create({
    ...identifiers, workflowId: cancelled._id, toolName: 'create_customer_from_scratchpad', riskLevel: 'write',
    arguments: { previewId: cancelled.id }, requiresApproval: true, approvalStatus: 'rejected', executionStatus: 'rejected',
    resultSummary: '用户取消，未创建客户且随手记未改动', executedAt: new Date(),
  });
  return dto(cancelled);
}
