/**
 * 开发信模板接口
 * ------------------------------------------------------------------
 * GET    /api/templates            模板列表（可按分类 / 关键词过滤）
 * GET    /api/templates/:id        单个模板
 * POST   /api/templates            新建模板
 * PUT    /api/templates/:id        编辑模板
 * POST   /api/templates/:id/duplicate  复制模板
 * DELETE /api/templates/:id        删除模板
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../services/template.service';
import type {
  CreateTemplateInput,
  ListTemplatesQuery,
  UpdateTemplateInput,
} from '../validators/template.validator';

export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListTemplatesQuery;
  const data = await listTemplates(query);
  sendSuccess(res, data);
});

export const getTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getTemplate(req.params.id);
  sendSuccess(res, data);
});

export const createTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateTemplateInput;
  const data = await createTemplate(input, req.user?.id);
  sendSuccess(res, data, 201);
});

export const updateTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpdateTemplateInput;
  const data = await updateTemplate(req.params.id, input);
  sendSuccess(res, data);
});

export const duplicateTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await duplicateTemplate(req.params.id, req.user?.id);
  sendSuccess(res, data, 201);
});

export const deleteTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await deleteTemplate(req.params.id);
  sendSuccess(res, data);
});
