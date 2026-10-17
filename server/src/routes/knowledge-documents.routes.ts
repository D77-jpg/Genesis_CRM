import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { controlParsing, documentDetail, legacyPreview, listDocuments, mapLegacy, originalDocument, reviewInput, saveChunkDraft, uploadDocument, uploadInput } from '../services/knowledge/document.service';

const router = Router();
router.use(requireRole('admin'));
const limiter = rateLimit({ windowMs: 60000, max: 15, standardHeaders: true, legacyHeaders: false });
const params = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) });
const pageQuery = z.object({ page: z.coerce.number().int().min(0).max(60).default(0), revision: z.string().regex(/^[a-f0-9]{24}$/i).optional() });
const beforeQuery = z.object({ before: z.string().regex(/^[a-f0-9]{24}$/i).optional() });
router.get('/', validate({ query: beforeQuery }), asyncHandler(async (req, res) => sendSuccess(res, await listDocuments(req.user!, req.query.before as string | undefined))));
router.post('/', limiter, validate({ body: uploadInput }), asyncHandler(async (req, res) => sendSuccess(res, await uploadDocument(req.body, req.user!), 201)));
router.get('/legacy-preview', validate({ query: beforeQuery }), asyncHandler(async (req, res) => sendSuccess(res, await legacyPreview(req.user!, req.query.before as string | undefined))));
router.post('/legacy/:id', limiter, validate({ params, body: z.object({ version: z.number().int().min(1).max(100) }).strict() }), asyncHandler(async (req, res) => sendSuccess(res, await mapLegacy(req.params.id, req.body.version, req.user!), 201)));
router.post('/parsing/:id/:action', limiter, validate({ params: params.extend({ action: z.enum(['retry', 'cancel']) }), body: z.object({}).strict() }), asyncHandler(async (req, res) => sendSuccess(res, await controlParsing(req.params.id, req.params.action as 'retry' | 'cancel', req.user!))));
router.post('/chunks/:id/draft', limiter, validate({ params: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }), body: reviewInput }), asyncHandler(async (req, res) => sendSuccess(res, await saveChunkDraft(req.params.id, req.body, req.user!), 201)));
router.get('/:id', validate({ params, query: pageQuery }), asyncHandler(async (req, res) => sendSuccess(res, await documentDetail(req.params.id, req.user!, Number(req.query.page),req.query.revision as string|undefined))));
router.get('/:id/original', validate({ params }), asyncHandler(async (req, res) => {
  const source = await originalDocument(req.params.id, req.user!);
  // Always download untrusted originals, never execute/render active content in CRM origin.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(source.name));
  res.setHeader('Cache-Control', 'no-store'); res.send(source.bytes);
}));
export default router;
