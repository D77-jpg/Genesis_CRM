/**
 * 报价单接口（V2 报价管理）
 * ------------------------------------------------------------------
 * GET    /api/quotations                                     报价单列表（分页 / 按状态 / 按客户筛选）
 * GET    /api/quotations/:id                                 单份报价单详情
 * POST   /api/quotations                                     新建报价单（body 需带 customerId）
 * GET    /api/customers/:id/quotations                       某客户的报价单列表
 * POST   /api/customers/:id/quotations                       给某客户新建报价单
 * GET    /api/customers/:id/quotations/:quotationId          某客户的单份报价单详情
 * PUT    /api/customers/:id/quotations/:quotationId          编辑报价单
 * PUT    /api/customers/:id/quotations/:quotationId/status   更新报价单状态
 * DELETE /api/customers/:id/quotations/:quotationId          删除报价单
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { getCustomerByIdOrThrow } from '../services/customer.service';
import {
  createQuotation,
  deleteQuotation,
  getCustomerQuotation,
  getQuotation,
  listCustomerQuotations,
  listQuotations,
  updateQuotation,
  updateQuotationStatus,
} from '../services/quotation.service';
import type {
  CreateQuotationInput,
  ListQuotationsQuery,
  UpdateQuotationInput,
  UpdateQuotationStatusInput,
} from '../validators/quotation.validator';

/* ---------- 顶层 ---------- */

/** GET /api/quotations —— 报价单列表（分页 / 筛选） */
export const listQuotationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListQuotationsQuery;
  const data = await listQuotations(query, req.user);
  sendSuccess(res, data);
});

/** GET /api/quotations/:id —— 单份详情（服务层做客户归属校验） */
export const getQuotationHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getQuotation(req.params.id, req.user);
  sendSuccess(res, data);
});

/** POST /api/quotations —— customerId 必须在 body 中 */
export const createQuotationHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateQuotationInput;
  if (!input.customerId) {
    throw ApiError.badRequest('缺少 customerId，无法确定报价客户');
  }
  const data = await createQuotation(input.customerId, input, req.user);
  sendSuccess(res, data, 201);
});

/* ---------- 嵌套在客户下 ---------- */

/** GET /api/customers/:id/quotations —— 客户详情页的报价单列表 */
export const listCustomerQuotationsHandler = asyncHandler(async (req: Request, res: Response) => {
  // 归属校验：业务员只能查看自己名下客户的报价单
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const query = req.query as unknown as ListQuotationsQuery;
  const data = await listCustomerQuotations(req.params.id, query.limit);
  sendSuccess(res, data);
});

/** POST /api/customers/:id/quotations —— customerId 从路径取（服务层做归属校验） */
export const createQuotationForCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateQuotationInput;
  const data = await createQuotation(req.params.id, input, req.user);
  sendSuccess(res, data, 201);
});

/** GET /api/customers/:id/quotations/:quotationId —— 单份详情 */
export const getCustomerQuotationHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const data = await getCustomerQuotation(req.params.id, req.params.quotationId);
  sendSuccess(res, data);
});

/** PUT /api/customers/:id/quotations/:quotationId —— 编辑报价单 */
export const updateQuotationHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpdateQuotationInput;
  const data = await updateQuotation(req.params.id, req.params.quotationId, input, req.user);
  sendSuccess(res, data);
});

/** PUT /api/customers/:id/quotations/:quotationId/status —— 更新状态（可带客户状态联动） */
export const updateQuotationStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpdateQuotationStatusInput;
  const data = await updateQuotationStatus(req.params.id, req.params.quotationId, input, req.user);
  sendSuccess(res, data);
});

/** DELETE /api/customers/:id/quotations/:quotationId —— 删除报价单 */
export const deleteQuotationHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await deleteQuotation(req.params.id, req.params.quotationId, req.user);
  sendSuccess(res, data);
});
