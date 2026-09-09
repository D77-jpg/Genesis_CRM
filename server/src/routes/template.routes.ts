/**
 * 开发信模板路由
 * ------------------------------------------------------------------
 * 独立挂载在 /api/templates，与 /api/letters 完全隔离，
 * 避免与开发信的 /letters/:id 动态路由产生匹配冲突。
 */
import { Router } from 'express';
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

/* ---------- 集合级操作 ---------- */
router.get('/', validate({ query: listTemplatesQuerySchema }), listTemplatesHandler);
router.post('/', validate({ body: createTemplateSchema }), createTemplateHandler);

/* ---------- 单条操作 ---------- */
router.get('/:id', validate({ params: idParamsSchema }), getTemplateHandler);
router.put('/:id', validate({ params: idParamsSchema, body: updateTemplateSchema }), updateTemplateHandler);
router.post('/:id/duplicate', validate({ params: idParamsSchema }), duplicateTemplateHandler);
router.delete('/:id', validate({ params: idParamsSchema }), deleteTemplateHandler);

export default router;
