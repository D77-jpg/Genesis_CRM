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

export default router;
