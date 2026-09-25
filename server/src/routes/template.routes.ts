/**
 * 开发信模板路由
 * ------------------------------------------------------------------
 * 独立挂载在 /api/templates，与 /api/letters 完全隔离，
 * 避免与开发信的 /letters/:id 动态路由产生匹配冲突。
 */
import { Router } from 'express';
import { z } from 'zod';
import { performanceHandler, suggestTemplateHandler, getSuggestionHandler, copySuggestionHandler, cancelSuggestionHandler } from '../controllers/template-feedback.controller';
import { validate } from '../middleware/validate.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import {
  createTemplateSchema,
  idParamsSchema,
  listTemplatesQuerySchema,
  updateTemplateSchema,
} from '../validators/template.validator';
import {
  createTemplateHandler,
  deleteTemplateHandler,
  duplicateTemplateHandler,
  getTemplateHandler,
  listTemplatesHandler,
  updateTemplateHandler,
} from '../controllers/template.controller';

const router = Router();

router.use(requireAuth);

const key = z.string().regex(/^[a-zA-Z0-9_:.\-]{8,128}$/);
const suggestionParams = idParamsSchema.extend({ suggestionId: z.string().regex(/^[a-f\d]{24}$/i) });
const performanceQuery = z.object({ windowDays: z.coerce.number().pipe(z.union([z.literal(30), z.literal(90), z.literal(180)])).default(30),
  sampleThreshold: z.coerce.number().int().min(1).max(10000).default(5) });

/* ---------- 集合级操作 ---------- */
router.get('/performance', validate({ query: performanceQuery }), performanceHandler);
router.get('/', validate({ query: listTemplatesQuerySchema }), listTemplatesHandler);
router.post('/', validate({ body: createTemplateSchema }), createTemplateHandler);

/* ---------- 单条操作 ---------- */
router.get('/:id', validate({ params: idParamsSchema }), getTemplateHandler);
router.put('/:id', validate({ params: idParamsSchema, body: updateTemplateSchema }), updateTemplateHandler);
router.post('/:id/duplicate', validate({ params: idParamsSchema }), duplicateTemplateHandler);
router.post('/:id/suggestions', validate({ params: idParamsSchema, body: z.object({ idempotencyKey: key }).strict() }), suggestTemplateHandler);
router.get('/:id/suggestions/:suggestionId', validate({ params: suggestionParams }), getSuggestionHandler);
router.post('/:id/suggestions/:suggestionId/copy', validate({ params: suggestionParams,
  body: z.object({ expectedVersion: z.number().int().min(1), requestKey: key }).strict() }), copySuggestionHandler);
router.post('/:id/suggestions/:suggestionId/cancel', validate({ params: suggestionParams }), cancelSuggestionHandler);
router.delete('/:id', validate({ params: idParamsSchema }), deleteTemplateHandler);

export default router;
