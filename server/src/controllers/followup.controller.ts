/**
 * 客户跟进记录 / 时间线接口
 * ------------------------------------------------------------------
 * GET    /api/customers/:id/timeline                   客户活动时间线（聚合）
 * GET    /api/customers/:id/follow-ups                 某客户的跟进记录（倒序）
 * POST   /api/customers/:id/follow-ups                 新增跟进记录
 * PUT    /api/customers/:id/follow-ups/:followUpId      编辑一条跟进记录
 * DELETE /api/customers/:id/follow-ups/:followUpId      删除一条跟进记录
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { createFollowUp, deleteFollowUp, listFollowUps, updateFollowUp } from '../services/followup.service';
import { getCustomerTimeline } from '../services/timeline.service';
import { getCustomerByIdOrThrow } from '../services/customer.service';
import type { CreateFollowUpInput, ListFollowUpsQuery, UpdateFollowUpInput } from '../validators/followup.validator';

/** POST /api/customers/:id/follow-ups —— customerId 从路径取 */
export const createFollowUpHandler = asyncHandler(async (req: Request, res: Response) => {
  // 归属校验：业务员只能给自己名下客户新增跟进
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const input = req.body as CreateFollowUpInput;
  const data = await createFollowUp(req.params.id, input, req.user?.id);
  sendSuccess(res, data, 201);
});

/** GET /api/customers/:id/follow-ups —— 客户详情页的跟进历史 */
export const listFollowUpsHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const query = req.query as unknown as ListFollowUpsQuery;
  const data = await listFollowUps(req.params.id, query.limit);
  sendSuccess(res, data);
});

/** PUT /api/customers/:id/follow-ups/:followUpId —— 编辑一条跟进记录 */
export const updateFollowUpHandler = asyncHandler(async (req: Request, res: Response) => {
  // 归属校验：业务员只能编辑自己名下客户的跟进记录
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const input = req.body as UpdateFollowUpInput;
  const data = await updateFollowUp(req.params.id, req.params.followUpId, input);
  sendSuccess(res, data);
});

/** DELETE /api/customers/:id/follow-ups/:followUpId */
export const deleteFollowUpHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const data = await deleteFollowUp(req.params.id, req.params.followUpId);
  sendSuccess(res, data);
});

/** GET /api/customers/:id/timeline —— 客户活动时间线 */
export const getCustomerTimelineHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const data = await getCustomerTimeline(req.params.id);
  sendSuccess(res, data);
});
