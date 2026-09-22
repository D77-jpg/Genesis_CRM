import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import {
  createAgentSession,
  getAgentStatus,
  getAgentToolCatalog,
  getAgentUsage,
  listAgentActions,
  listAgentMessages,
  listAgentSessions,
  sendAgentMessage,
} from '../services/agent/agent.service';
import { agentSessionParamsSchema, createAgentSessionSchema, sendAgentMessageSchema } from '../validators/agent.validator';
import {
  agentCustomerPreviewParamsSchema,
  confirmAgentCustomerPreviewSchema,
  createAgentCustomerPreviewSchema,
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

const router = Router();
const messageLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('Agent 请求过于频繁，请稍后重试')),
});

router.get('/status', (_req, res) => sendSuccess(res, getAgentStatus()));
router.get('/tools', (_req, res) => sendSuccess(res, getAgentToolCatalog()));
router.get('/sessions', asyncHandler(async (req, res) => sendSuccess(res, await listAgentSessions(req.user!))));
router.post('/sessions', validate({ body: createAgentSessionSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await createAgentSession(req.body, req.user!), 201);
}));
router.get('/sessions/:id/messages', validate({ params: agentSessionParamsSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await listAgentMessages(req.params.id, req.user!));
}));
router.post('/sessions/:id/messages', messageLimiter, validate({ params: agentSessionParamsSchema, body: sendAgentMessageSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await sendAgentMessage(req.params.id, req.body.content, req.user!), 201);
}));
router.get('/usage', asyncHandler(async (req, res) => sendSuccess(res, await getAgentUsage(req.user!))));
router.get('/actions', asyncHandler(async (req, res) => sendSuccess(res, await listAgentActions(req.user!))));
router.get('/approvals', asyncHandler(async (req, res) => sendSuccess(res, await listAgentActions(req.user!))));

router.post('/scratchpad-customer/previews', messageLimiter, validate({ body: createAgentCustomerPreviewSchema }), asyncHandler(async (req, res) => {
  sendSuccess(res, await createScratchpadCustomerPreview(req.body, req.user!), 201);
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
