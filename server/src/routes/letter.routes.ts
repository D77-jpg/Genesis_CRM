/**
 * 开发信路由
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { draftFollowUpLetter } from '../services/follow-up-draft.service';
import { requireAuth } from '../middleware/auth.middleware';
import {
  bulkDeleteLettersSchema,
  idParamsSchema,
  listLettersQuerySchema,
  resendLetterSchema,
  reviewLetterSchema,
  sendLetterSchema,
} from '../validators/letter.validator';
import { z } from 'zod';
import { objectIdSchema } from '../validators/common';
import {
  bulkDeleteLettersHandler,
  deleteLetterHandler,
  exportLettersHandler,
  getLetterHandler,
  listLettersHandler,
  previewLetterHandler,
  resendLetterHandler,
  reviewLetterHandler,
  sendLetterHandler,
} from '../controllers/letter.controller';

const router = Router();

router.use(requireAuth);

/** 预览接口的独立校验：允许 subject 为空（用户可能先写正文） */
const previewSchema = z.object({
  customerId: objectIdSchema,
  subject: z.string().trim().max(300).default(''),
  content: z.string().max(100000).default(''),
  recipientEmail: z
    .string()
    .trim()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, { message: '收件人邮箱格式不正确' })
    .optional(),
});

/* ---------- 静态路径（必须在 /:id 之前） ---------- */
router.get('/export', validate({ query: listLettersQuerySchema }), exportLettersHandler);
router.post('/preview', validate({ body: previewSchema }), previewLetterHandler);
/** 一键生成第 2 / 3 封跟进草稿：读上一封的实际内容，AI 写；AI 不可用或越界时回退模板 */
router.post('/follow-up-draft', validate({ body: z.object({ customerId: objectIdSchema }).strict() }), asyncHandler(async (req, res) => {
  sendSuccess(res, await draftFollowUpLetter(String(req.body.customerId), req.user!));
}));
router.post('/bulk/delete', validate({ body: bulkDeleteLettersSchema }), bulkDeleteLettersHandler);

/* ---------- 集合级操作 ---------- */
router.get('/', validate({ query: listLettersQuerySchema }), listLettersHandler);
router.post('/', validate({ body: sendLetterSchema }), sendLetterHandler);

/* ---------- 单条操作 ---------- */
router.get('/:id', validate({ params: idParamsSchema }), getLetterHandler);
router.post('/:id/resend', validate({ params: idParamsSchema, body: resendLetterSchema }), resendLetterHandler);
router.post('/:id/review', validate({ params: idParamsSchema, body: reviewLetterSchema }), reviewLetterHandler);
router.delete('/:id', validate({ params: idParamsSchema }), deleteLetterHandler);

export default router;
