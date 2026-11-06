import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { inquiryBody } from '../validators/integration-inquiry.validator';
import { receiveInquiry, listGlobalSiteInquiries, inquiryNotifications, markInquiryRead, draftInquiryReply } from '../services/integration-inquiry.service';
import { downloadStoredInquiryAttachment } from '../services/integration-inquiry-worker.service';
import { requireScope } from '../middleware/service-token.middleware';
import { integrationCredentialLimit } from '../middleware/integration-limit.middleware';
const id = z.string().regex(/^[a-f0-9]{24}$/);
export function installInquiryRoute(router: Router) {
    router.post('/inquiries', requireScope('inquiries:write'), integrationCredentialLimit, validate({ body: inquiryBody }), asyncHandler(async (req, res) => {
        const key = String(req.headers['idempotency-key'] ?? '').trim();
        if (!key || key.length > 128)
            throw ApiError.badRequest('必须提供1-128字符Idempotency-Key');
        const r = await receiveInquiry({ credentialId: req.integration!.credentialId, projectId: req.project!.id, key, body: req.body });
        sendSuccess(res, r.result, r.statusCode);
    }));
}
const r = Router();
r.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
r.get('/notifications', asyncHandler(async (req, res) => sendSuccess(res, await inquiryNotifications(req.user!))));
r.get('/', validate({ query: z.object({ customerId: id.optional(), cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() }), asyncHandler(async (req, res) => sendSuccess(res, await listGlobalSiteInquiries(req.user!, req.query as any))));
const params = z.object({ inquiryId: id });
r.post('/:inquiryId/read', validate({ params, body: z.object({}).strict() }), asyncHandler(async (req, res) => sendSuccess(res, await markInquiryRead(req.params.inquiryId, req.user!))));
r.post('/:inquiryId/reply-draft', validate({ params, body: z.object({}).strict() }), asyncHandler(async (req, res) => sendSuccess(res, await draftInquiryReply(req.params.inquiryId, req.user!))));
r.get('/:inquiryId/attachments/:attachmentId', validate({ params: params.extend({ attachmentId: z.string().min(1).max(128) }) }), asyncHandler(async (req, res) => {
    const a = await downloadStoredInquiryAttachment(req.params.inquiryId, req.params.attachmentId, req.user!);
    res.set({ 'Content-Type': a.mime, 'Content-Disposition': 'attachment; filename="attachment"; filename*=UTF-8\'\'' + encodeURIComponent(a.name), 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" }).send(a.bytes);
}));
export default r;
