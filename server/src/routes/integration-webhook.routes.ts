import { Router } from 'express';
import { z } from 'zod';
import { requireRole, requireProject } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/pagination';
import { WEBHOOK_EVENTS, getWebhook, saveWebhook, rotateWebhook, listWebhookDeliveries, listWebhookAttempts, retryWebhook } from '../services/integration-webhook.service';
const r = Router(), id = z.string().regex(/^[a-f0-9]{24}$/), empty = z.object({}).strict(), params = z.object({ deliveryId: id }), query = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
r.use(requireRole('admin', 'project_admin'), (req, res, next) => { res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' }); if (!/^[a-f0-9]{24}$/i.test(String(req.headers['x-project-id'] ?? '')))
    return next(ApiError.badRequest('必须明确指定项目')); next(); }, requireProject);
r.get('/webhook', asyncHandler(async (req, res) => sendSuccess(res, await getWebhook(req.user!))));
r.put('/webhook', validate({ body: z.object({ revision: z.number().int().min(0), targetUrl: z.string().trim().url().max(2000), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(4).refine(a => new Set(a).size === a.length), enabled: z.boolean() }).strict() }), asyncHandler(async (req, res) => sendSuccess(res, await saveWebhook(req.user!, req.body))));
r.post('/webhook/rotate-secret', validate({ body: z.object({ revision: z.number().int().min(1) }).strict() }), asyncHandler(async (req, res) => sendSuccess(res, await rotateWebhook(req.user!, req.body.revision))));
r.get('/webhook/deliveries', validate({ query: query.extend({ status: z.enum(['pending', 'running', 'delivered', 'failed', 'cancelled']).optional() }) }), asyncHandler(async (req, res) => sendSuccess(res, await listWebhookDeliveries(req.user!, req.query as any))));
r.get('/webhook/deliveries/:deliveryId/attempts', validate({ params, query }), asyncHandler(async (req, res) => sendSuccess(res, await listWebhookAttempts(req.user!, req.params.deliveryId, req.query as any))));
r.post('/webhook/deliveries/:deliveryId/retry', validate({ params, body: empty }), asyncHandler(async (req, res) => sendSuccess(res, await retryWebhook(req.user!, req.params.deliveryId))));
export default r;
