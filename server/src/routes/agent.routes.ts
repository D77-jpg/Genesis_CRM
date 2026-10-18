import {governanceOverview,versionDiff,previewDisable,commitDisable,bulkInput,draftEvidence} from '../services/agent/knowledge-governance';
import {agreementInput,listCustomerAgreements,saveCustomerAgreement,disableCustomerAgreement} from '../services/agent/customer-agreement.service';
import {regenerateKnowledgeDraft,recheckKnowledgeDraft} from '../services/agent/knowledge-draft.service';
import { Router } from 'express';
import { z } from 'zod';
import { getAgentTask, listAgentTasks, controlAgentTask } from '../services/agent/task.service';
import { rateLimit } from 'express-rate-limit';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { requireRole } from '../middleware/auth.middleware';
import { aiSettingsSchema } from '../validators/ai-settings.validator';
import { getAiSettings, saveAiSettings, testAiSettings } from '../services/agent/ai-settings.service';
import {
  createAgentSession,
  getAgentStatus,
  getAgentToolCatalog,
  getAgentUsage,
  listAgentActions,
  listAgentMessages,
  listAgentSessions,
  sendAgentMessage,
  updateAgentSession,
} from '../services/agent/agent.service';
import { agentDiagnosticsQuerySchema, agentSessionParamsSchema, createAgentSessionSchema, sendAgentMessageSchema, updateAgentSessionSchema } from '../validators/agent.validator';
import { getAgentDiagnostics, listAgentEvaluations, runAgentEvaluation } from '../services/agent/diagnostics.service';
import {
  agentCustomerPreviewParamsSchema,
  confirmAgentCustomerPreviewSchema,
  createAgentCustomerPreviewSchema,
  createAgentMailCustomerPreviewSchema,
  updateAgentCustomerPreviewSchema,
} from '../validators/agent.validator';
import {
  applyMailCustomerStatus,
  createMailThreadAnalysis,
  getMailThreadAnalysis,
  saveMailFollowUp,
  saveMailReplyDraft,
  updateMailThreadAnalysis,
} from '../services/agent/mail-thread-analysis.service';
import {
  agentMailAnalysisParamsSchema,
  createAgentMailAnalysisSchema,
  updateAgentMailAnalysisSchema,
} from '../validators/agent.validator';
import {
  cancelScratchpadCustomerPreview,
  confirmScratchpadCustomerPreview,
  createScratchpadCustomerPreview,
  createMailCustomerPreview,
  getScratchpadCustomerPreview,
  updateScratchpadCustomerPreview,
} from '../services/agent/scratchpad-customer.service';
import {
  createCustomerAnalysis,
  getCustomerAnalysis,
  saveAnalysisEmailDraft,
  scheduleAnalysisFollowUp,
  updateCustomerAnalysis,
} from '../services/agent/customer-analysis.service';
import {
  agentCustomerAnalysisParamsSchema,
  confirmAgentAnalysisActionSchema,
  createAgentCustomerAnalysisSchema,
  updateAgentCustomerAnalysisSchema,
} from '../validators/agent.validator';

import { getAgentActionDetail } from '../services/agent/action-detail.service';

import {appendKnowledge,listKnowledge,archiveKnowledge,knowledgeInput,previewKnowledgeImport,importKnowledge,importPreviewInput,importCommitInput,getKnowledgeHistory} from '../services/agent/knowledge.service';
import {getAgentBatch,listAgentBatches,proposeAgentBatch,controlAgentBatch,batchProposalSchema} from '../services/agent/batch.service';
import {readAgentAttachment} from '../services/agent/attachment-text.service';
import {automationRuleInput,getAutomationRule,saveAutomationRule,listAutomationInbox} from '../services/agent/automation.service';
import {BUSINESS_SKILLS} from '../services/agent/skills';
const router = Router();
const messageLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('Agent 请求过于频繁，请稍后重试')),
});

router.get('/automation-rule',asyncHandler(async(req,res)=>sendSuccess(res,await getAutomationRule(req.user!))));
router.put('/automation-rule',messageLimiter,validate({body:automationRuleInput}),asyncHandler(async(req,res)=>sendSuccess(res,await saveAutomationRule(req.body,req.user!))));
router.get('/inbox',asyncHandler(async(req,res)=>sendSuccess(res,await listAutomationInbox(req.user!))));
router.get('/skills',(_req,res)=>sendSuccess(res,BUSINESS_SKILLS));
router.post('/knowledge/import-preview',requireRole('admin'),validate({body:importPreviewInput}),asyncHandler(async(req,res)=>sendSuccess(res,previewKnowledgeImport(req.body))));
router.post('/knowledge/import',requireRole('admin'),validate({body:importCommitInput}),asyncHandler(async(req,res)=>sendSuccess(res,await importKnowledge(req.body.entries,req.user!),201)));
router.post('/knowledge-drafts/:id/regenerate',messageLimiter,validate({params:agentSessionParamsSchema,body:z.object({requestKey:z.string().uuid()}).strict()}),asyncHandler(async(req,res)=>sendSuccess(res,await regenerateKnowledgeDraft(req.params.id,req.user!,req.body.requestKey),201)));

const agreementParams=z.object({customerId:z.string().regex(/^[a-f\d]{24}$/i),id:z.string().regex(/^[a-f\d]{24}$/i).optional()});
router.get('/customers/:customerId/agreements',validate({params:agreementParams}),asyncHandler(async(req,res)=>sendSuccess(res,await listCustomerAgreements(req.params.customerId,req.user!))));
router.post('/customers/:customerId/agreements',requireRole('admin'),validate({params:agreementParams,body:agreementInput}),asyncHandler(async(req,res)=>sendSuccess(res,{id:await saveCustomerAgreement(req.params.customerId,undefined,req.body,req.user!)},201)));
router.post('/customers/:customerId/agreements/:id/revisions',requireRole('admin'),validate({params:agreementParams,body:agreementInput}),asyncHandler(async(req,res)=>sendSuccess(res,{id:await saveCustomerAgreement(req.params.customerId,req.params.id,req.body,req.user!)})));
router.post('/customers/:customerId/agreements/:id/disable',requireRole('admin'),validate({params:agreementParams,body:z.object({version:z.number().int().positive()}).strict()}),asyncHandler(async(req,res)=>{await disableCustomerAgreement(req.params.customerId,req.params.id,req.body.version,req.user!);sendSuccess(res,{disabled:true});}));
router.post('/knowledge-drafts/:id/recheck',messageLimiter,validate({params:agentSessionParamsSchema,body:z.object({requestKey:z.string().uuid(),bodyText:z.string().max(20000).optional(),subject:z.string().max(300).optional()}).strict()}),asyncHandler(async(req,res)=>sendSuccess(res,await recheckKnowledgeDraft(req.params.id,req.body,req.user!))));
router.get('/knowledge-governance',requireRole('admin'),asyncHandler(async(req,res)=>sendSuccess(res,await governanceOverview(req.user!))));
router.post('/knowledge-governance/disable-preview',requireRole('admin'),messageLimiter,validate({body:bulkInput}),asyncHandler(async(req,res)=>sendSuccess(res,await previewDisable(req.body.ids,req.user!),201)));
router.post('/knowledge-governance/:id/disable',requireRole('admin'),messageLimiter,validate({params:agentSessionParamsSchema,body:z.object({}).strict()}),asyncHandler(async(req,res)=>sendSuccess(res,await commitDisable(req.params.id,req.user!))));
router.get('/knowledge/:id/diff',requireRole('admin'),validate({params:agentSessionParamsSchema,query:z.object({from:z.coerce.number().int().min(1).max(100),to:z.coerce.number().int().min(1).max(100)})}),asyncHandler(async(req,res)=>sendSuccess(res,await versionDiff(req.params.id,Number(req.query.from),Number(req.query.to),req.user!))));
router.get('/knowledge-drafts/:id/evidence',validate({params:agentSessionParamsSchema,query:z.object({sourceId:z.string().min(1).max(200)}).strict()}),asyncHandler(async(req,res)=>sendSuccess(res,await draftEvidence(req.params.id,req.query.sourceId as string,req.user!))));
router.get('/knowledge',asyncHandler(async(req,res)=>sendSuccess(res,await listKnowledge(req.user!))));
router.get('/knowledge/:id',validate({params:agentSessionParamsSchema}),asyncHandler(async(req,res)=>sendSuccess(res,await getKnowledgeHistory(req.params.id,req.user!))));
router.post('/knowledge',requireRole('admin'),validate({body:knowledgeInput}),asyncHandler(async(req,res)=>sendSuccess(res,{id:await appendKnowledge(undefined,req.body,req.user!)},201)));
router.post('/knowledge/:id/revisions',requireRole('admin'),validate({params:agentSessionParamsSchema,body:knowledgeInput}),asyncHandler(async(req,res)=>sendSuccess(res,{id:await appendKnowledge(req.params.id,req.body,req.user!)})));
router.post('/knowledge/:id/archive',requireRole('admin'),validate({params:agentSessionParamsSchema,body:z.object({version:z.number().int().min(1)}).strict()}),asyncHandler(async(req,res)=>{await archiveKnowledge(req.params.id,req.body.version,req.user!);sendSuccess(res,{archived:true});}));
router.get('/customers/:id/attachments/:attachmentId/text',validate({params:z.object({id:z.string().regex(/^[a-f\d]{24}$/i),attachmentId:z.string().regex(/^[a-f\d]{24}$/i)})}),asyncHandler(async(req,res)=>sendSuccess(res,await readAgentAttachment(req.params.id,req.params.attachmentId,req.user!))));
router.get('/batches',asyncHandler(async(req,res)=>sendSuccess(res,await listAgentBatches(req.user!))));
router.get('/batches/:id',validate({params:agentSessionParamsSchema}),asyncHandler(async(req,res)=>sendSuccess(res,await getAgentBatch(req.params.id,req.user!))));
router.post('/batches',messageLimiter,validate({body:batchProposalSchema}),asyncHandler(async(req,res)=>sendSuccess(res,await proposeAgentBatch(req.body,req.user!),201)));
for(const action of ['confirm','pause','resume','cancel'] as const)router.post(`/batches/:id/${action}`,messageLimiter,validate({params:agentSessionParamsSchema,body:z.object({version:z.number().int().min(1)}).strict()}),asyncHandler(async(req,res)=>sendSuccess(res,await controlAgentBatch(req.params.id,action,req.body.version,req.user!))));
router.get('/tasks' , asyncHandler(async (req,res) => sendSuccess(res,await listAgentTasks(req.user!))));
router.get('/tasks/:id', validate({params:agentSessionParamsSchema}),asyncHandler(async (req,res) => sendSuccess(res,await getAgentTask(req.params.id,req.user!))));
for (const action of ['resume','pause','cancel'] as const) router.post(`/tasks/:id/${action}`, messageLimiter, validate({params:agentSessionParamsSchema,
 body:z.object({version:z.number().int().min(0),customerId:z.string().regex(/^[a-f\d]{24}$/i).optional(),query:z.string().trim().min(1).max(120).optional()}).strict()}),
 asyncHandler(async (req,res) => sendSuccess(res,await controlAgentTask(req.params.id,action,req.body,req.user!))));

router.get('/status' , asyncHandler(async (_req, res) => sendSuccess(res, await getAgentStatus())));
router.get('/tools', (_req, res) => sendSuccess(res, getAgentToolCatalog()));
router.get('/sessions', asyncHandler(async (req, res) => sendSuccess(res, await listAgentSessions(req.user!))));
router.post('/sessions', validate({ body: createAgentSessionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await createAgentSession(req.body, req.user!), 201);
}));
router.put('/sessions/:id', validate({ params: agentSessionParamsSchema, body: updateAgentSessionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await updateAgentSession(req.params.id, req.body, req.user!));
}));
router.get('/sessions/:id/messages', validate({ params: agentSessionParamsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await listAgentMessages(req.params.id, req.user!));
}));
router.post('/sessions/:id/messages', messageLimiter, validate({ params: agentSessionParamsSchema, body: sendAgentMessageSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await sendAgentMessage(req.params.id, req.body.content, req.user!, req.body.idempotencyKey), 201);
}));
router.get('/usage', asyncHandler(async (req, res) => sendSuccess(res, await getAgentUsage(req.user!))));
router.get('/actions', asyncHandler(async (req, res) => sendSuccess(res, await listAgentActions(req.user!))));
router.get('/actions/:id', validate({ params: agentSessionParamsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await getAgentActionDetail(req.params.id, req.user!));
}));
router.get('/approvals', asyncHandler(async (req, res) => sendSuccess(res, await listAgentActions(req.user!))));

router.get('/admin/diagnostics', requireRole('admin'), validate({ query: agentDiagnosticsQuerySchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await getAgentDiagnostics(req.user!, req.query.days as unknown as number));
}));
router.get('/admin/ai-settings', requireRole('admin'), asyncHandler(async (req, res) => {
  sendSuccess(res, await getAiSettings(req.user!));
}));
router.post('/admin/ai-settings/test', requireRole('admin'), messageLimiter, validate({ body: aiSettingsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await testAiSettings(req.body, req.user!));
}));
router.put('/admin/ai-settings', requireRole('admin'), messageLimiter, validate({ body: aiSettingsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await saveAiSettings(req.body, req.user!));
}));
router.get('/admin/evaluations', requireRole('admin'), asyncHandler(async (req, res) => {
  sendSuccess(res, await listAgentEvaluations(req.user!));
}));
router.post('/admin/evaluations/run', requireRole('admin'), messageLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await runAgentEvaluation(req.user!), 201);
}));

router.post('/scratchpad-customer/previews', messageLimiter, validate({ body: createAgentCustomerPreviewSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await createScratchpadCustomerPreview(req.body, req.user!), 201);
}));
router.post('/mail-customer/previews', messageLimiter, validate({ body: createAgentMailCustomerPreviewSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await createMailCustomerPreview(req.body, req.user!), 201);
}));
router.get('/scratchpad-customer/previews/:id', validate({ params: agentCustomerPreviewParamsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await getScratchpadCustomerPreview(req.params.id, req.user!));
}));
router.put('/scratchpad-customer/previews/:id', validate({ params: agentCustomerPreviewParamsSchema, body: updateAgentCustomerPreviewSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await updateScratchpadCustomerPreview(req.params.id, req.body, req.user!));
}));
router.post('/scratchpad-customer/previews/:id/confirm', messageLimiter, validate({ params: agentCustomerPreviewParamsSchema, body: confirmAgentCustomerPreviewSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await confirmScratchpadCustomerPreview(req.params.id, req.body, req.user!), 201);
}));
router.post('/scratchpad-customer/previews/:id/cancel', validate({ params: agentCustomerPreviewParamsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await cancelScratchpadCustomerPreview(req.params.id, req.user!));
}));

router.post('/customer-analyses', messageLimiter, validate({ body: createAgentCustomerAnalysisSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await createCustomerAnalysis(req.body, req.user!), 201);
}));
router.get('/customer-analyses/:id', validate({ params: agentCustomerAnalysisParamsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await getCustomerAnalysis(req.params.id, req.user!));
}));
router.put('/customer-analyses/:id', validate({ params: agentCustomerAnalysisParamsSchema, body: updateAgentCustomerAnalysisSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await updateCustomerAnalysis(req.params.id, req.body, req.user!));
}));
router.post('/customer-analyses/:id/save-email-draft', messageLimiter, validate({ params: agentCustomerAnalysisParamsSchema, body: confirmAgentAnalysisActionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await saveAnalysisEmailDraft(req.params.id, req.body, req.user!), 201);
}));
router.post('/customer-analyses/:id/schedule-followup', messageLimiter, validate({ params: agentCustomerAnalysisParamsSchema, body: confirmAgentAnalysisActionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await scheduleAnalysisFollowUp(req.params.id, req.body, req.user!), 201);
}));

router.post('/mail-analyses', messageLimiter, validate({ body: createAgentMailAnalysisSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await createMailThreadAnalysis(req.body, req.user!), 201);
}));
router.get('/mail-analyses/:id', validate({ params: agentMailAnalysisParamsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await getMailThreadAnalysis(req.params.id, req.user!));
}));
router.put('/mail-analyses/:id', validate({ params: agentMailAnalysisParamsSchema, body: updateAgentMailAnalysisSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await updateMailThreadAnalysis(req.params.id, req.body, req.user!));
}));
router.post('/mail-analyses/:id/save-reply-draft', messageLimiter, validate({ params: agentMailAnalysisParamsSchema, body: confirmAgentAnalysisActionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await saveMailReplyDraft(req.params.id, req.body, req.user!), 201);
}));
router.post('/mail-analyses/:id/apply-customer-status', messageLimiter, validate({ params: agentMailAnalysisParamsSchema, body: confirmAgentAnalysisActionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await applyMailCustomerStatus(req.params.id, req.body, req.user!), 201);
}));
router.post('/mail-analyses/:id/save-followup', messageLimiter, validate({ params: agentMailAnalysisParamsSchema, body: confirmAgentAnalysisActionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await saveMailFollowUp(req.params.id, req.body, req.user!), 201);
}));

export default router;
