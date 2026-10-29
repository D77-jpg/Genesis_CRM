import {ensureCustomerResearch,type CustomerResearchStatus} from '../website/customer-research';
import {websiteCustomerEvidence} from '../website/research.service';
import {prepareSalesEvidence,assertSalesEvidenceCurrent,salesMailKind,salesSubjects,type SalesMailKind} from './sales-evidence';
import {workflowStage,type EvidenceWorkflow} from './evidence-workflow';
import {verifyGroundedEmail,providerFactVerifier} from './fact-verifier';
import {knowledgeForModel,knowledgeForAudit,knowledgeSourceForModel} from './knowledge-types';
import type {KnowledgeBundle} from './knowledge-types';
import {inboundAgentScope} from './mail-access';
import {draftHash,knowledgeFreshness,customerProfileOf,safeGeneratedSubject} from './knowledge-grounding';
import {customerAttachmentEvidence} from './attachment-text.service';
import {chargeTaskBudget} from './task-budget';
import { Types } from 'mongoose';
import { z } from 'zod';
import env from '../../config/env';
import { agentFailure } from './agent-errors';
import { getCurrentMailSender } from '../mail-account.service';
import type { AgentProvider } from './provider';
import {
  Project,
  Customer,
  AgentAction,
  AgentCustomerAnalysis,
  AgentRun,
  DevelopmentLetter,
  FollowUp,
  type AgentAnalysisClaim,
  type AgentAnalysisSource,
  type AgentCustomerAnalysisDocument,
} from '../../models';
import { MailMessage } from '../../models/MailMessage';
import type { AuthUser } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { requireProjectId } from '../../utils/access';
import { renderLetterContent, type LetterSignature } from '../letter-signature';
import { projectPromptContext, resolveProjectSalesProfile } from '../project-profile';
import { resolveSignerName } from '../signer.service';
import { getCustomerByIdOrThrow, updateCustomer } from '../customer.service';
import { sendLetter } from '../letter.service';
import { getCustomerTimeline } from '../timeline.service';
import type {
  ConfirmAgentAnalysisActionBody,
  CreateAgentCustomerAnalysisBody,
  UpdateAgentCustomerAnalysisBody,
} from '../../validators/agent.validator';
import { hasProtectedCustomerMail } from './mail-thread-analysis.service';
import { resolveAgentProvider } from './ai-settings.service';
import { AgentProviderError, type CustomerAnalysisInput } from './provider';
import {
  agentSafetyIdentifier,
  containsPromptInjection,
  estimateAgentCostUsd,
  reserveAgentQuota,
  settleAgentQuota,
  type AgentQuotaReservation,
} from './runtime-guard';

function scope(actor: AuthUser) {
  return { projectId: requireProjectId(actor), userId: new Types.ObjectId(actor.id) };
}

function safeErrorCode(error: unknown): string {
  if (error instanceof AgentProviderError) return error.code.slice(0, 80);
  if (error instanceof ApiError) return error.code.slice(0, 80);
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000) return 'DUPLICATE_KEY';
  return 'AGENT_CUSTOMER_ANALYSIS_ERROR';
}

function sourceDto(source: AgentAnalysisSource) {
  return { sourceId: source.sourceId, kind: source.kind, recordId: source.recordId, label: source.label, occurredAt: source.occurredAt };
}

function dto(doc: AgentCustomerAnalysisDocument) {
  return {
    id: doc.id,
    knowledgeReview: doc.knowledgeReview,
    customerId: String(doc.customerId),
    sources: doc.sources.map(sourceDto),
    facts: doc.facts.map((item) => ({ text: item.text, sourceIds: item.sourceIds })),
    gaps: doc.gaps.map((item) => ({ text: item.text, sourceIds: item.sourceIds })),
    recommendations: doc.recommendations.map((item) => ({ text: item.text, rationale: item.rationale ?? '', sourceIds: item.sourceIds })),
    firstOutreach: Boolean(doc.firstOutreach),
    outreachStep: doc.outreachStep,
    emailDraft: { subject: doc.emailDraft.subject, bodyText: doc.emailDraft.bodyText },
    followUpPlan: {
      method: doc.followUpPlan.method, content: doc.followUpPlan.content, dueAt: doc.followUpPlan.dueAt,
      reason: doc.followUpPlan.reason ?? '', sourceIds: doc.followUpPlan.sourceIds ?? [],
      manuallyEdited: doc.followUpPlan.manuallyEdited ?? false,
    },
    emailStatus: doc.emailStatus,
    followUpStatus: doc.followUpStatus,
    createdLetterId: doc.createdLetterId ? String(doc.createdLetterId) : undefined,
    scheduledAt: doc.scheduledAt,
    version: doc.version,
    lastError: doc.lastError,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function getAnalysisOrThrow(id: string, actor: AuthUser) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('客户分析 ID 格式不正确');
  const analysis = await AgentCustomerAnalysis.findOne({ _id: id, ...scope(actor) });
  if (!analysis) throw ApiError.notFound('客户分析不存在或无权访问');
  await getCustomerByIdOrThrow(String(analysis.customerId), actor);
  return analysis;
}

function clipped(value: unknown, max = 3000): string {
  return String(value ?? '').trim().slice(0, max);
}

async function buildAnalysisInput(customerId: string, actor: AuthUser, knowledgeIds?:string[], goal='', workflow?:EvidenceWorkflow, taskKind?:SalesMailKind, outreachStep?:number, previousOutreach?:CustomerAnalysisInput['previousOutreach']): Promise<{ input: CustomerAnalysisInput; sources: AgentAnalysisSource[]; knowledgeBundle:KnowledgeBundle; signature: LetterSignature }> {
  const customer = await getCustomerByIdOrThrow(customerId, actor);
  const projectId = requireProjectId(actor);
  const project = await Project.findById(projectId).select('code slug name industry companyName website mailFrom senderName').lean();
  const salesProfile = resolveProjectSalesProfile(project);
  const oid = new Types.ObjectId(customerId);
  const [timeline, inbound, outbound, followups] = await Promise.all([
    getCustomerTimeline(customerId, 30, actor),
    MailMessage.find({ ...await inboundAgentScope(actor), customerId: oid, projectId, deleted: false }).sort({ sentAt: -1 }).limit(20).select('_id subject from fromName text sentAt').lean(),
    DevelopmentLetter.find({ customerId: oid, projectId, status: { $in: ['sent', 'opened'] } }).sort({ sentAt: -1 }).limit(20).select('_id subject recipientEmail contentText sentAt').lean(),
    FollowUp.find({ customerId: oid, projectId }).sort({ followUpAt: -1 }).limit(20).select('_id method result content followUpAt nextFollowUpAt').lean(),
  ]);

  const sources: AgentAnalysisSource[] = [];
  const sourceCatalog: CustomerAnalysisInput['sourceCatalog'] = [];
  const add = (source: AgentAnalysisSource, content: unknown) => {
    sources.push(source);
    sourceCatalog.push({ sourceId: source.sourceId, kind: source.kind, label: source.label, content });
  };
  add({ sourceId: `profile:${customerId}`, kind: 'profile', recordId: customerId, label: '客户档案' }, {
    name: customer.name, company: customer.company, email: customer.email, phone: customer.phone, country: customer.country,
    website:customer.website,industry: customer.industry, status: customer.status, priority: customer.priority, interestedProducts: customer.interestedProducts,
    productModel: customer.productModel, productCategory: customer.productCategory, expectedQuantity: customer.expectedQuantity,
    targetPrice: customer.targetPrice, moq: customer.moq, requirementNotes: customer.requirementNotes, notes: customer.notes,
    nextFollowUpAt: customer.nextFollowUpAt,
  });
  for (const item of timeline.items.slice(0, 30)) add({
    sourceId: `timeline:${item.id}`, kind: 'timeline', recordId: item.id, label: `时间线 · ${item.type}`, occurredAt: item.at,
  }, item);
  for (const mail of inbound) add({
    sourceId: `mail-in:${String(mail._id)}`, kind: 'mail', recordId: String(mail._id), label: `收件 · ${clipped(mail.subject, 100)}`, occurredAt: mail.sentAt,
  }, { direction: 'inbound', subject: mail.subject, from: mail.fromName || mail.from, text: clipped(mail.text), sentAt: mail.sentAt });
  for (const mail of outbound) add({
    sourceId: `mail-out:${String(mail._id)}`, kind: 'mail', recordId: String(mail._id), label: `发件 · ${clipped(mail.subject, 100)}`, occurredAt: mail.sentAt ?? undefined,
  }, { direction: 'outbound', subject: mail.subject, to: mail.recipientEmail, text: clipped(mail.contentText), sentAt: mail.sentAt });
  for (const followup of followups) add({
    sourceId: `followup:${String(followup._id)}`, kind: 'followup', recordId: String(followup._id), label: `跟进 · ${followup.method}`, occurredAt: followup.followUpAt,
  }, { method: followup.method, result: followup.result, content: clipped(followup.content), followUpAt: followup.followUpAt, nextFollowUpAt: followup.nextFollowUpAt });
  const websiteSources=await websiteCustomerEvidence(customerId,actor);
  for(const item of websiteSources)add({sourceId:item.sourceId,kind:'website',recordId:item.recordId,label:item.label,occurredAt:item.occurredAt},item.content);
  await workflowStage(workflow,'read_context',{customerId,sourceCatalog},async()=>({projectId:actor.projectId,customerId,sourceCatalog}),{tool:'crm'});
  const websiteHint=[...new Set(websiteSources.map(item=>item.content.productHint).filter(Boolean))].join(' ');
  const productHint=([customer.interestedProducts,customer.productCategory,customer.industry,websiteHint].filter(Boolean).join(' ').trim().slice(0,600)
    || [project?.industry,project?.companyName,salesProfile.offerSummary].filter(Boolean).join(' ').slice(0,300));
  const prepared=await prepareSalesEvidence(actor,{request:goal,history:inbound.slice().reverse().map(m=>m.text).join('\n'),productHint,kind:taskKind??salesMailKind(goal),customerId,ids:knowledgeIds},workflow);
  const knowledgeContext=prepared.bundle;
  const knowledge=knowledgeContext.sources;
  // The catalog repeats every source for citation lookup; provenance diagnostics
  // (per-chunk refs, ranking indexes) are not facts and doubled the model input.
  for(const item of knowledge){
    // sourceCatalog is a citation index; sending the full publication twice
    // (once in knowledgeContext, once here) can push large projects over the model input limit.
    const modelKnowledge=knowledgeSourceForModel(item) as unknown as Record<string,unknown>;
    add({sourceId:item.sourceId,kind:item.kind,recordId:item.knowledgeId??item.quotationId??item.agreementId!,label:`已发布产品知识 · ${item.title} · v${item.version}`},{...modelKnowledge,content:clipped(modelKnowledge.content,300)});
  }
  for(const item of await customerAttachmentEvidence(customerId,actor))add({sourceId:item.sourceId,kind:'attachment',recordId:item.id,label:`客户附件 · ${item.name} · ${item.status}`},{...item,text:item.text.slice(0,3000)});
  return { input: { customerName: customer.name, customerEmail: customer.email, sourceCatalog,salesRequirements:prepared.requirements,taskType:taskKind??salesMailKind(goal),knowledgeContext:knowledgeForModel(knowledgeContext),projectProfile:projectPromptContext(salesProfile),
    ...(outreachStep ? { outreachStep: (Math.min(3, Math.max(1, outreachStep)) as 1|2|3) } : {}),
    ...(previousOutreach?.length ? { previousOutreach } : {}) }, sources, knowledgeBundle:knowledgeForAudit(knowledgeContext), signature:salesProfile.signature };
}

const outputSchema = z.object({
  facts: z.array(z.object({ text: z.string().trim().min(1).max(1200), sourceIds: z.array(z.string()).min(1).max(8) }).strict()).max(12),
  gaps: z.array(z.object({ text: z.string().trim().min(1).max(1200), sourceIds: z.array(z.string()).min(1).max(8) }).strict()).max(10),
  recommendations: z.array(z.object({ text: z.string().trim().min(1).max(1200), rationale: z.string().trim().min(1).max(1200), sourceIds: z.array(z.string()).min(1).max(8) }).strict()).max(10),
  emailDraft: z.object({ subject: z.string().trim().min(1).max(300), bodyText: z.string().trim().min(1).max(20000) }).strict(),
  followUpPlan: z.object({ method: z.enum(['email', 'whatsapp', 'phone', 'chat', 'other']), content: z.string().trim().min(1).max(5000), dueAt: z.coerce.date() }).strict(),
}).strict();

function verifiedClaims(items: AgentAnalysisClaim[], known: Set<string>): AgentAnalysisClaim[] {
  return items.map((item) => ({ ...item, sourceIds: [...new Set(item.sourceIds)].filter((id) => known.has(id)) }))
    .filter((item) => item.sourceIds.length > 0);
}

function recommendationEvidence(recommendations: AgentAnalysisClaim[]): { reason: string; sourceIds: string[] } {
  const recommendation = recommendations.find((item) => item.rationale?.trim() && item.sourceIds.length > 0);
  if (!recommendation) throw new AgentProviderError('OPENAI_UNVERIFIED_SOURCES');
  return { reason: recommendation.rationale!.trim(), sourceIds: recommendation.sourceIds };
}

export async function createCustomerAnalysis(input: CreateAgentCustomerAnalysisBody, actor: AuthUser, options?: { firstOutreach?: boolean; userRequest?: string; provider?: AgentProvider; knowledgeIds?:string[]; taskId?:string;workflow?:EvidenceWorkflow;taskKind?:SalesMailKind;customerResearch?:CustomerResearchStatus;outreachStep?:number;previousOutreach?:CustomerAnalysisInput['previousOutreach'] }) {
  const identifiers = scope(actor);
  await getCustomerByIdOrThrow(input.customerId, actor);
  const existing = await AgentCustomerAnalysis.findOne({ ...identifiers, requestKey: input.idempotencyKey });
  if (existing) {
    if (String(existing.customerId) !== input.customerId) throw ApiError.conflict('请求标识已用于其他客户');
    return dto(existing);
  }
  const activeProvider = options?.provider ?? await resolveAgentProvider();
  const run = await AgentRun.create({ ...identifiers, provider: activeProvider.name, model: activeProvider.model, kind: 'customer_analysis', status: 'running' });
  const startedAt = Date.now();
  let reservation: AgentQuotaReservation | undefined;
  let finalUsage:{inputTokens:number;outputTokens:number;totalTokens:number}|undefined;
  try {
    if (!activeProvider.isAvailable()) throw new AgentProviderError('AGENT_NOT_CONFIGURED');
    const taskKind=options?.taskKind??(options?.firstOutreach?'first_outreach':options?.userRequest?salesMailKind(options.userRequest):'followup_review');
    const research=options?.customerResearch??await ensureCustomerResearch(input.customerId,actor,{requestKey:input.idempotencyKey});
    const context = await buildAnalysisInput(input.customerId, actor,options?.knowledgeIds,options?.userRequest,options?.workflow,taskKind,options?.outreachStep,options?.previousOutreach);
    context.input.userRequest=options?.userRequest;context.input.customerResearch=research;
    {
      const project = await Project.findById(requireProjectId(actor)).select('companyName website moq senderName');
      const sender = await getCurrentMailSender(String(requireProjectId(actor)), actor.id);
      // 落款跟着「这封信该由谁发」走：客户负责人 → 当前账号 → 项目署名
      const owner = await Customer.findById(input.customerId).select('ownerId').lean();
      const signerName = await resolveSignerName({ projectId: requireProjectId(actor), ownerId: owner?.ownerId, actorId: actor.id });
      context.input.firstOutreach = Boolean(options?.firstOutreach);
      context.input.userRequest = options?.userRequest;
      context.input.seller = { companyName: project?.companyName || 'Company name pending confirmation',
        website: project?.website, senderName: signerName,
        senderEmail: sender.account?.email };
    }
    const serializedInput = JSON.stringify(context.input);
    if (serializedInput.length > env.AI_MAX_INPUT_CHARS) throw new ApiError(413, '客户资料超过 Agent 单次分析上限，请减少历史数据后重试', 'PAYLOAD_TOO_LARGE');
    let generatedNow=false;
    const generated = await workflowStage(options?.workflow,'generate_email',{input:context.input,model:activeProvider.model},async()=>{
      const totals={inputTokens:0,outputTokens:0,totalTokens:0};
      for(let attempt=0;attempt<2;attempt++){
        await options?.workflow?.check();await assertSalesEvidenceCurrent(context.knowledgeBundle,actor,input.customerId);
        const requestInput=attempt?{...context.input,userRequest:(context.input.userRequest??'')+'\n请完整重整一次输出结构：事实、缺口和建议必须引用已有 sourceId，不能使用空引用；文本非空，跟进时间用未来 ISO8601。保持原业务事实、权限和人工发送要求，不能补造内容。'}:context.input;
        const chars=JSON.stringify(requestInput).length;if(chars>env.AI_MAX_INPUT_CHARS)throw new ApiError(413,'客户资料超过单次分析范围','PAYLOAD_TOO_LARGE');
        generatedNow=true;reservation=await reserveAgentQuota(actor,chars);
        let result:Awaited<ReturnType<AgentProvider['analyzeCustomer']>>|undefined;
        try{
          await chargeTaskBudget(options?.taskId,chars,env.AI_MAX_OUTPUT_TOKENS);
          result=await activeProvider.analyzeCustomer({input:requestInput,safetyIdentifier:agentSafetyIdentifier(actor)});
          outputSchema.parse({facts:result.facts,gaps:result.gaps,recommendations:result.recommendations,emailDraft:result.emailDraft,followUpPlan:result.followUpPlan});
          finalUsage=result.usage;for(const key of ['inputTokens','outputTokens','totalTokens'] as const)totals[key]+=result.usage[key];
          return {...result,usage:totals};
        }catch(error){
          await settleAgentQuota(reservation,result?.usage);reservation=undefined;
          if(result?.usage)for(const key of ['inputTokens','outputTokens','totalTokens'] as const)totals[key]+=result.usage[key];
          const shape=(error as {name?:string})?.name==='ZodError'||error instanceof AgentProviderError&&error.code==='OPENAI_INVALID_STRUCTURED_OUTPUT';
          if(!shape||attempt!==0)throw error;
        }
      }
      throw new AgentProviderError('OPENAI_INVALID_STRUCTURED_OUTPUT');
    },{cache:true,tool:'model'});
    const parsed = outputSchema.parse({
      facts: generated.facts, gaps: generated.gaps, recommendations: generated.recommendations,
      emailDraft: generated.emailDraft, followUpPlan: generated.followUpPlan,
    });
    const grounded=await workflowStage(options?.workflow,'audit_claims',{body:parsed.emailDraft.bodyText,bundle:context.knowledgeBundle,model:activeProvider.model},async()=>verifyGroundedEmail(parsed.emailDraft.bodyText,context.knowledgeBundle,{
      taskType:options?.taskKind??context.input.taskType??(options?.firstOutreach?'first_outreach':'followup'),knownRequirements:context.input.salesRequirements?.known,
      customerProfile:customerProfileOf(context.input.sourceCatalog.find(s=>s.kind==='profile')!.content as {name:string;company?:string;country?:string;industry?:string;interestedProducts?:string}),recipientName:context.input.customerName,customerId:input.customerId,request:options?.userRequest,
      customerWebsites:context.input.sourceCatalog.filter(s=>s.kind==='website').map(s=>{const c=s.content as {url:string;text:string;sha256:string;collectedAt:string};return {sourceId:s.sourceId,url:c.url,text:c.text,sha256:c.sha256,collectedAt:c.collectedAt};}),
      customerEvidence:JSON.stringify(context.input.sourceCatalog.filter(item=>item.kind!=='knowledge')),
      seller:context.input.seller,
      signature:context.signature,
      outreachStep:options?.outreachStep,
      previousOutreach:options?.previousOutreach,
    },providerFactVerifier(activeProvider,actor,options?.taskId,options?.workflow?.check,context.input.projectProfile,{outreachStep:options?.outreachStep,previousOutreach:options?.previousOutreach}),actor),{cache:true,tool:'model'});
    await options?.workflow?.check();
    await assertSalesEvidenceCurrent(context.knowledgeBundle,actor,input.customerId);
    if(research.state!=='ready'){grounded.review.issues.push({code:'customer_research_gap',message:research.message});grounded.review.completeness='partial';}
    parsed.emailDraft.bodyText=grounded.bodyText;
    // A generated subject is not an unchecked channel for numeric commitments:
    // keep it only when it is short and free of numbers or currencies.
    parsed.emailDraft.subject = safeGeneratedSubject(parsed.emailDraft.subject ?? '', salesSubjects[taskKind]);
    const known = new Set(context.sources.map((source) => source.sourceId));
    const facts = verifiedClaims(parsed.facts, known);
    const gaps = verifiedClaims(parsed.gaps, known);
    const recommendations = verifiedClaims(parsed.recommendations, known);
    if (!facts.length || !recommendations.length) throw new AgentProviderError('OPENAI_UNVERIFIED_SOURCES');
    const followUpEvidence = recommendationEvidence(recommendations);
    if (parsed.followUpPlan.dueAt.getTime() <= Date.now()) {
      throw ApiError.validation([{ field: 'followUpPlan.dueAt', message: '模型建议时间已过期，请重新生成或人工设置未来时间' }], '跟进建议时间已过期');
    }
    await options?.workflow?.check();
    let analysis: AgentCustomerAnalysisDocument;
    try {
      analysis = await AgentCustomerAnalysis.create({
        ...identifiers, customerId: new Types.ObjectId(input.customerId), requestKey: input.idempotencyKey,
        firstOutreach: Boolean(options?.firstOutreach),
        ...(options?.outreachStep ? { outreachStep: Math.min(3, Math.max(1, options.outreachStep)) } : {}),
        knowledgeReview:grounded.review,sources: context.sources, facts, gaps, recommendations, emailDraft: parsed.emailDraft,
        followUpPlan: {
          ...parsed.followUpPlan,
          ...followUpEvidence, manuallyEdited: false,
        },
      });
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000)) throw error;
      const raced = await AgentCustomerAnalysis.findOne({ ...identifiers, requestKey: input.idempotencyKey });
      if (!raced) throw error;
      analysis = raced;
    }
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: {
      workflowId: analysis._id, status: 'completed', inputTokens: generatedNow?generated.usage.inputTokens:0, outputTokens: generatedNow?generated.usage.outputTokens:0,
      totalTokens: generatedNow?generated.usage.totalTokens:0, inputCharacters: serializedInput.length,
      promptInjectionDetected: containsPromptInjection(serializedInput), estimatedCostUsd: generatedNow?estimateAgentCostUsd(generated.usage, activeProvider.name):0,
      durationMs: Date.now() - startedAt,
    } });
    await AgentAction.create({
      ...identifiers, runId: run._id, workflowId: analysis._id, toolName: 'analyze_customer_and_draft_email', riskLevel: 'read',
      arguments: { customerId: input.customerId, sourceCount: context.sources.length }, requiresApproval: false,
      approvalStatus: 'not_required', executionStatus: 'succeeded', resultSummary: `已生成客户分析与英文邮件草稿（${context.sources.length} 个来源）`, executedAt: new Date(),
    });
    await settleAgentQuota(reservation, finalUsage??generated.usage);
    return dto(analysis);
  } catch (error) {
    await AgentRun.updateOne({ _id: run._id, ...identifiers }, { $set: { status: 'failed', errorCode: safeErrorCode(error), durationMs: Date.now() - startedAt } });
    await settleAgentQuota(reservation,finalUsage);
    if (error instanceof ApiError) throw error;
    if (error instanceof AgentProviderError || (error as { name?: string })?.name === 'ZodError') {
      const failure = agentFailure(error);
      throw new ApiError(503, failure.message, 'INTERNAL_ERROR', [{ field: 'agent', message: failure.code }]);
    }
    throw error;
  }
}

export async function getCustomerAnalysis(id: string, actor: AuthUser) {
  const doc=await getAnalysisOrThrow(id,actor);
  return {...dto(doc),knowledgeFreshness:doc.knowledgeReview?await knowledgeFreshness(doc.knowledgeReview,actor):undefined};
}

export async function updateCustomerAnalysis(id: string, input: UpdateAgentCustomerAnalysisBody, actor: AuthUser) {
  const current = await getAnalysisOrThrow(id, actor);
  if (current.version !== input.expectedVersion) throw ApiError.conflict('分析草稿已更新，请重新载入');
  if(await hasProtectedCustomerMail(String(current.customerId),actor.projectId!))throw ApiError.conflict('客户已有停止营销联系记录，不能准备营销草稿');
  if (current.emailStatus === 'saved' && input.emailDraft) throw ApiError.conflict('开发信草稿已保存，不能继续修改');
  if (current.followUpStatus === 'scheduled' && input.followUpPlan) throw ApiError.conflict('跟进已安排，不能继续修改');
  const patch: Record<string, unknown> = {};
  if (input.emailDraft) patch.emailDraft = input.emailDraft;
  if (input.followUpPlan) {
    if (input.followUpPlan.dueAt.getTime() <= Date.now()) throw ApiError.badRequest('跟进时间必须晚于当前时间');
    // The request schema only accepts editable fields. Preserve the original verified evidence
    // rather than allowing a client to forge source IDs or silently lose provenance on replacement.
    const known = new Set(current.sources.map((source) => source.sourceId));
    const retainedIds = [...new Set(current.followUpPlan.sourceIds ?? [])].filter((sourceId) => known.has(sourceId));
    const evidence = current.followUpPlan.reason?.trim() && retainedIds.length
      ? { reason: current.followUpPlan.reason.trim(), sourceIds: retainedIds }
      : recommendationEvidence(verifiedClaims(current.recommendations, known));
    patch.followUpPlan = { ...input.followUpPlan, ...evidence, manuallyEdited: true };
  }
  const updated = await AgentCustomerAnalysis.findOneAndUpdate(
    { _id: current._id, ...scope(actor), version: input.expectedVersion },
    { $set: patch, $unset: { lastError: 1 }, $inc: { version: 1 } }, { new: true, runValidators: true },
  );
  if (!updated) throw ApiError.conflict('分析草稿已更新，请重新载入');
  await AgentAction.create({
    ...scope(actor), workflowId: updated._id, toolName: 'edit_customer_analysis_draft', riskLevel: 'write',
    arguments: { analysisId: updated.id, fields: Object.keys(patch) }, requiresApproval: false, approvalStatus: 'not_required',
    executionStatus: 'succeeded', resultSummary: '已保存邮件草稿与跟进计划的编辑内容', executedAt: new Date(),
  });
  return dto(updated);
}

export async function saveAnalysisEmailDraft(id: string, input: ConfirmAgentAnalysisActionBody, actor: AuthUser) {
  const identifiers = scope(actor);
  const current = await getAnalysisOrThrow(id, actor);
  if(await hasProtectedCustomerMail(String(current.customerId),actor.projectId!))throw ApiError.conflict('客户已有停止营销联系记录，不能准备营销草稿');
  if (current.emailStatus === 'saved' && current.createdLetterId) return { analysis: dto(current), letterId: String(current.createdLetterId), idempotent: true };
  if (current.emailStatus === 'saving') throw ApiError.conflict('开发信草稿正在保存，请勿重复提交');
  if (current.version !== input.expectedVersion) throw ApiError.conflict('邮件草稿已更新，请核对后再次确认');
  const locked = await AgentCustomerAnalysis.findOneAndUpdate(
    { _id: current._id, ...identifiers, version: input.expectedVersion, emailStatus: { $in: ['editable', 'failed'] } },
    { $set: { emailStatus: 'saving', emailConfirmationKey: input.idempotencyKey }, $inc: { version: 1 } }, { new: true },
  );
  if (!locked) throw ApiError.conflict('邮件草稿状态已变化，请重新载入');
  const action = await AgentAction.create({
    ...identifiers, workflowId: locked._id, toolName: 'save_agent_email_draft', riskLevel: 'write',
    arguments: { analysisId: locked.id, customerId: String(locked.customerId) }, requiresApproval: true,
    approvalStatus: 'approved', executionStatus: 'pending', approvedBy: new Types.ObjectId(actor.id), approvedAt: new Date(),
  });
  try {
    const owner = await Customer.findById(locked.customerId).select('ownerId').lean();
    const signer = await resolveSignerName({ projectId: requireProjectId(actor), ownerId: owner?.ownerId, actorId: actor.id });
    const project = await Project.findById(requireProjectId(actor)).select('code slug name companyName industry website mailFrom senderName').lean();
    const signature = resolveProjectSalesProfile(project).signature;
    const content = renderLetterContent(locked.emailDraft.bodyText, signer, signature, true);
    const result = await sendLetter({
      customerId: String(locked.customerId), subject: locked.emailDraft.subject, content, markAsDeveloped: false,
      saveAsDraft: true, requestKey: `agent-analysis-email:${locked.id}`,
    }, actor);
    if(locked.knowledgeReview)await DevelopmentLetter.updateOne({_id:result.letter.id,projectId:requireProjectId(actor),knowledgeReview:{$exists:false}},{$set:{knowledgeReview:{...locked.knowledgeReview,bodyHash:draftHash(result.letter.contentText)}}});
    if (result.letter.status !== 'draft' || result.delivered) throw ApiError.internal('草稿安全校验失败');
    const completed = await AgentCustomerAnalysis.findOneAndUpdate(
      { _id: locked._id, ...identifiers, emailConfirmationKey: input.idempotencyKey },
      { $set: { emailStatus: 'saved', createdLetterId: new Types.ObjectId(result.letter.id) }, $unset: { lastError: 1 }, $inc: { version: 1 } }, { new: true },
    );
    if (!completed) throw ApiError.conflict('草稿已保存，但分析状态同步失败，请刷新');
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'succeeded', resultSummary: '已保存开发信草稿，未发送', executedAt: new Date() } });
    return { analysis: dto(completed), letterId: result.letter.id, idempotent: false };
  } catch (error) {
    await AgentCustomerAnalysis.updateOne({ _id: locked._id, ...identifiers, emailStatus: 'saving' }, { $set: { emailStatus: 'failed', lastError: safeErrorCode(error) }, $inc: { version: 1 } });
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'failed', resultSummary: '开发信草稿保存失败，未发送邮件', executedAt: new Date() } });
    throw error;
  }
}

export async function scheduleAnalysisFollowUp(id: string, input: ConfirmAgentAnalysisActionBody, actor: AuthUser) {
  const identifiers = scope(actor);
  const current = await getAnalysisOrThrow(id, actor);
  if (current.followUpStatus === 'scheduled' && current.scheduledAt) return { analysis: dto(current), scheduledAt: current.scheduledAt, idempotent: true };
  if (current.followUpStatus === 'scheduling') throw ApiError.conflict('跟进正在安排，请勿重复提交');
  if (current.version !== input.expectedVersion) throw ApiError.conflict('跟进计划已更新，请核对后再次确认');
  if (current.followUpPlan.dueAt.getTime() <= Date.now()) throw ApiError.badRequest('跟进时间必须晚于当前时间');
  if (await hasProtectedCustomerMail(String(current.customerId), String(requireProjectId(actor)))) {
    throw ApiError.conflict('客户存在退订、退信、拒绝或垃圾邮件记录，不能安排未来营销跟进');
  }
  const locked = await AgentCustomerAnalysis.findOneAndUpdate(
    { _id: current._id, ...identifiers, version: input.expectedVersion, followUpStatus: { $in: ['editable', 'failed'] } },
    { $set: { followUpStatus: 'scheduling', followUpConfirmationKey: input.idempotencyKey }, $inc: { version: 1 } }, { new: true },
  );
  if (!locked) throw ApiError.conflict('跟进计划状态已变化，请重新载入');
  const action = await AgentAction.create({
    ...identifiers, workflowId: locked._id, toolName: 'schedule_agent_followup', riskLevel: 'write',
    arguments: { analysisId: locked.id, customerId: String(locked.customerId), dueAt: locked.followUpPlan.dueAt }, requiresApproval: true,
    approvalStatus: 'approved', executionStatus: 'pending', approvedBy: new Types.ObjectId(actor.id), approvedAt: new Date(),
  });
  try {
    if (await hasProtectedCustomerMail(String(locked.customerId), String(requireProjectId(actor)))) {
      throw ApiError.conflict('客户存在停止营销信号，不能安排未来跟进');
    }
    await updateCustomer(String(locked.customerId), { nextFollowUpAt: locked.followUpPlan.dueAt }, actor);
    const completed = await AgentCustomerAnalysis.findOneAndUpdate(
      { _id: locked._id, ...identifiers, followUpConfirmationKey: input.idempotencyKey },
      { $set: { followUpStatus: 'scheduled', scheduledAt: locked.followUpPlan.dueAt }, $unset: { lastError: 1 }, $inc: { version: 1 } }, { new: true },
    );
    if (!completed) throw ApiError.conflict('跟进已安排，但分析状态同步失败，请刷新');
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'succeeded', resultSummary: '已安排下一次跟进并写入客户时间线', executedAt: new Date() } });
    return { analysis: dto(completed), scheduledAt: completed.scheduledAt, idempotent: false };
  } catch (error) {
    await AgentCustomerAnalysis.updateOne({ _id: locked._id, ...identifiers, followUpStatus: 'scheduling' }, { $set: { followUpStatus: 'failed', lastError: safeErrorCode(error) }, $inc: { version: 1 } });
    await AgentAction.updateOne({ _id: action._id, ...identifiers }, { $set: { executionStatus: 'failed', resultSummary: '跟进安排失败', executedAt: new Date() } });
    throw error;
  }
}
