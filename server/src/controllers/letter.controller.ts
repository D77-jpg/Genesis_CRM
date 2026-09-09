/**
 * 开发信接口
 * ------------------------------------------------------------------
 * GET    /api/letters                       全部开发信记录（分页 / 搜索 / 筛选）
 * GET    /api/letters/export                导出开发信记录 Excel
 * GET    /api/letters/:id                   单封详情
 * POST   /api/letters                       发送（body 需带 customerId）
 * POST   /api/letters/preview               预览占位符替换后的效果
 * POST   /api/letters/:id/resend            重新发送
 * POST   /api/letters/bulk/delete           批量删除
 * DELETE /api/letters/:id                   删除单封
 * GET    /api/customers/:id/letters         某客户的历史记录
 * POST   /api/customers/:id/letters         给某客户发送开发信
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import {
  bulkDeleteLetters,
  deleteLetter,
  getLetter,
  getLetterStats,
  listLetters,
  previewLetter,
  resendLetter,
  sendLetter,
} from '../services/letter.service';
import { buildLettersWorkbook } from '../services/excel.service';
import { getCustomerByIdOrThrow } from '../services/customer.service';
import type {
  ListLettersQuery,
  ResendLetterInput,
  SendLetterInput,
} from '../validators/letter.validator';

export const listLettersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListLettersQuery;
  const data = await listLetters(query, req.user);
  sendSuccess(res, data);
});

export const getLetterHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getLetter(req.params.id, req.user);
  sendSuccess(res, data);
});

/** POST /api/letters —— customerId 必须在 body 中 */
export const sendLetterHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as SendLetterInput;
  if (!input.customerId) {
    throw ApiError.badRequest('缺少 customerId，无法确定收件客户');
  }
  const result = await sendLetter(input, req.user);
  // 记录已入库就算创建成功（201）；是否真的投递成功通过 meta.delivered 告知前端
  sendSuccess(res, result, 201, {
    delivered: result.delivered,
    channel: result.channel,
  });
});

/** POST /api/customers/:id/letters —— customerId 从路径取 */
export const sendLetterForCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = { ...(req.body as SendLetterInput), customerId: req.params.id };
  const result = await sendLetter(input, req.user);
  sendSuccess(res, result, 201, { delivered: result.delivered, channel: result.channel });
});

export const resendLetterHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ResendLetterInput;
  const result = await resendLetter(req.params.id, input, req.user);
  sendSuccess(res, result, 201, { delivered: result.delivered, channel: result.channel });
});

export const previewLetterHandler = asyncHandler(async (req: Request, res: Response) => {
  const { customerId, subject, content, recipientEmail } = req.body as {
    customerId: string;
    subject: string;
    content: string;
    recipientEmail?: string;
  };
  const data = await previewLetter(customerId, subject ?? '', content ?? '', recipientEmail, req.user);
  sendSuccess(res, data);
});

export const deleteLetterHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await deleteLetter(req.params.id, req.user);
  sendSuccess(res, data);
});

export const bulkDeleteLettersHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: string[] };
  const data = await bulkDeleteLetters(ids, req.user);
  sendSuccess(res, { ...data, requested: ids.length });
});

/** GET /api/customers/:id/letters —— 客户详情页的开发信历史 */
export const listCustomerLettersHandler = asyncHandler(async (req: Request, res: Response) => {
  // 归属校验：业务员只能查看自己名下客户的开发信历史
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const query = { ...(req.query as unknown as ListLettersQuery), customerId: req.params.id };
  const data = await listLetters(query, req.user);
  sendSuccess(res, data);
});

/** GET /api/letters/export —— 导出开发信记录 */
export const exportLettersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListLettersQuery;
  const data = await listLetters({ ...query, page: 1, limit: 5000 }, req.user);

  if (data.items.length === 0) {
    throw ApiError.notFound('当前筛选条件下没有可导出的开发信');
  }

  // 补客户名/公司，方便线下核对
  const rows = data.items.map((item) => ({
    recipientName: item.recipientName,
    recipientEmail: item.recipientEmail,
    subject: item.subject,
    contentText: item.contentText,
    status: item.status,
    channel: item.channel,
    sentAt: item.sentAt,
    customerName: item.customer?.name,
    customerCompany: item.customer?.company,
  }));

  const buffer = buildLettersWorkbook(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="letters-${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(`开发信记录-${stamp}.xlsx`)}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
});

export const letterStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getLetterStats(req.user);
  sendSuccess(res, data);
});
