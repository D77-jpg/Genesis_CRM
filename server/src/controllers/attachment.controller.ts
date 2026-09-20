/**
 * 客户附件接口
 * ------------------------------------------------------------------
 * GET    /api/customers/:id/attachments                          附件列表
 * POST   /api/customers/:id/attachments                          上传附件（base64 JSON）
 * GET    /api/customers/:id/attachments/:attachmentId/download   下载附件
 * DELETE /api/customers/:id/attachments/:attachmentId            删除附件
 *
 * 归属校验：所有接口先经 getCustomerByIdOrThrow 校验「当前用户是否可见该客户」，
 * 业务员只能操作自己名下客户的附件；service 层再用 { _id, customerId } 双条件兜底。
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { getCustomerByIdOrThrow } from '../services/customer.service';
import {
  createAttachment,
  deleteAttachment,
  getAttachmentForDownload,
  listAttachments,
} from '../services/attachment.service';
import type { CreateAttachmentInput } from '../validators/attachment.validator';

/** 构造兼容中文文件名的 Content-Disposition（RFC 5987），并强制以附件形式下载 */
function setDownloadHeaders(res: Response, originalName: string, mimeType: string): void {
  const asciiFallback = originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
  );
  // 禁止浏览器嗅探类型（避免把上传的 html/svg 当页面执行）
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
}

/** GET /api/customers/:id/attachments */
export const listAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const data = await listAttachments(req.params.id, req.user?.projectId);
  sendSuccess(res, data);
});

/** POST /api/customers/:id/attachments —— 上传附件 */
export const uploadAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const input = req.body as CreateAttachmentInput;
  const data = await createAttachment(req.params.id, input, req.user?.id, req.user?.projectId);
  sendSuccess(res, data, 201);
});

/** GET /api/customers/:id/attachments/:attachmentId/download —— 下载附件 */
export const downloadAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const file = await getAttachmentForDownload(req.params.id, req.params.attachmentId, req.user?.projectId);
  setDownloadHeaders(res, file.originalName, file.mimeType);
  res.setHeader('Content-Length', String(file.buffer.length));
  res.send(file.buffer);
});

/** DELETE /api/customers/:id/attachments/:attachmentId */
export const deleteAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  await getCustomerByIdOrThrow(req.params.id, req.user);
  const data = await deleteAttachment(req.params.id, req.params.attachmentId, req.user?.projectId);
  sendSuccess(res, data);
});
