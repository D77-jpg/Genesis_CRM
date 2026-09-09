/**
 * 客户路由
 * ------------------------------------------------------------------
 * 注意：所有「静态路径」必须注册在 /:id 之前，否则会被 :id 吞掉。
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import {
  bulkDeleteSchema,
  bulkUpdateStatusSchema,
  bulkAddTagsSchema,
  bulkRemoveTagsSchema,
  bulkAssignOwnerSchema,
  bulkSetFollowUpSchema,
  createCustomerSchema,
  idParamsSchema,
  importCustomersSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from '../validators/customer.validator';
import { sendLetterSchema, listLettersQuerySchema } from '../validators/letter.validator';
import {
  createFollowUpSchema,
  followUpIdParamsSchema,
  listFollowUpsQuerySchema,
  updateFollowUpSchema,
} from '../validators/followup.validator';
import {
  bulkDeleteHandler,
  bulkStatusHandler,
  bulkAddTagsHandler,
  bulkRemoveTagsHandler,
  bulkAssignOwnerHandler,
  bulkSetFollowUpHandler,
  createCustomerHandler,
  deleteCustomerHandler,
  downloadTemplateHandler,
  exportCustomersHandler,
  getCustomerHandler,
  importCustomersHandler,
  listCustomersHandler,
  listIndustriesHandler,
  listOwnersHandler,
  listTagsHandler,
  updateCustomerHandler,
} from '../controllers/customer.controller';
import {
  listCustomerLettersHandler,
  sendLetterForCustomerHandler,
} from '../controllers/letter.controller';
import {
  createFollowUpHandler,
  deleteFollowUpHandler,
  getCustomerTimelineHandler,
  listFollowUpsHandler,
  updateFollowUpHandler,
} from '../controllers/followup.controller';
import {
  attachmentIdParamsSchema,
  createAttachmentSchema,
} from '../validators/attachment.validator';
import {
  deleteAttachmentHandler,
  downloadAttachmentHandler,
  listAttachmentsHandler,
  uploadAttachmentHandler,
} from '../controllers/attachment.controller';

const router = Router();

// 所有客户接口都需要登录
router.use(requireAuth);

/* ---------- 静态路径（必须在 /:id 之前） ---------- */
router.get('/export', validate({ query: listCustomersQuerySchema }), exportCustomersHandler);
router.get('/template', downloadTemplateHandler);
router.get('/industries', listIndustriesHandler);
router.get('/tags', listTagsHandler);
// 负责人名单本质是「用户花名册」，仅管理员分配客户时需要，对业务员隐藏
router.get('/owners', requireRole('admin'), listOwnersHandler);

/* ---------- 集合级操作 ---------- */
router.get('/', validate({ query: listCustomersQuerySchema }), listCustomersHandler);
router.post('/', validate({ body: createCustomerSchema }), createCustomerHandler);
router.post('/import', validate({ body: importCustomersSchema }), importCustomersHandler);
router.post('/bulk/status', validate({ body: bulkUpdateStatusSchema }), bulkStatusHandler);
router.post('/bulk/delete', validate({ body: bulkDeleteSchema }), bulkDeleteHandler);
router.post('/bulk/tags/add', validate({ body: bulkAddTagsSchema }), bulkAddTagsHandler);
router.post('/bulk/tags/remove', validate({ body: bulkRemoveTagsSchema }), bulkRemoveTagsHandler);
// 分配负责人是管理员专属：严格分配制下业务员不能转移客户归属
router.post('/bulk/owner', requireRole('admin'), validate({ body: bulkAssignOwnerSchema }), bulkAssignOwnerHandler);
router.post('/bulk/follow-up', validate({ body: bulkSetFollowUpSchema }), bulkSetFollowUpHandler);

/* ---------- 单条操作 ---------- */
router.get('/:id', validate({ params: idParamsSchema }), getCustomerHandler);
router.put('/:id', validate({ params: idParamsSchema, body: updateCustomerSchema }), updateCustomerHandler);
router.delete('/:id', validate({ params: idParamsSchema }), deleteCustomerHandler);

/* ---------- 嵌套的开发信资源 ---------- */
router.get('/:id/letters', validate({ params: idParamsSchema, query: listLettersQuerySchema }), listCustomerLettersHandler);
router.post('/:id/letters', validate({ params: idParamsSchema, body: sendLetterSchema }), sendLetterForCustomerHandler);

/* ---------- 嵌套的跟进记录 / 活动时间线 ---------- */
router.get('/:id/timeline', validate({ params: idParamsSchema }), getCustomerTimelineHandler);
router.get('/:id/follow-ups', validate({ params: idParamsSchema, query: listFollowUpsQuerySchema }), listFollowUpsHandler);
router.post('/:id/follow-ups', validate({ params: idParamsSchema, body: createFollowUpSchema }), createFollowUpHandler);
router.put('/:id/follow-ups/:followUpId', validate({ params: followUpIdParamsSchema, body: updateFollowUpSchema }), updateFollowUpHandler);
router.delete('/:id/follow-ups/:followUpId', validate({ params: followUpIdParamsSchema }), deleteFollowUpHandler);

/* ---------- 嵌套的客户附件 ---------- */
router.get('/:id/attachments', validate({ params: idParamsSchema }), listAttachmentsHandler);
router.post('/:id/attachments', validate({ params: idParamsSchema, body: createAttachmentSchema }), uploadAttachmentHandler);
router.get('/:id/attachments/:attachmentId/download', validate({ params: attachmentIdParamsSchema }), downloadAttachmentHandler);
router.delete('/:id/attachments/:attachmentId', validate({ params: attachmentIdParamsSchema }), deleteAttachmentHandler);

export default router;
