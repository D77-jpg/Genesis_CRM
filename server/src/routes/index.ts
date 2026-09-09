/**
 * API 路由汇总
 *   /api/health          健康检查（无需登录）
 *   /api/meta            前端所需的枚举 / 占位符元数据（无需登录）
 *   /api/auth/*          登录
 *   /api/customers/*     客户
 *   /api/letters/*       开发信
 *   /api/quotations/*    报价单（V2）
 *   /api/stats/*         统计
 *   /api/users/*         用户管理（管理员专属）
 */
import { Router } from 'express';
import env from '../config/env';
import { sendSuccess } from '../utils/pagination';
import { asyncHandler } from '../utils/asyncHandler';
import {
  CUSTOMER_SOURCE,
  CUSTOMER_STATUS,
  CUSTOMER_STATUS_LABEL,
  LETTER_PLACEHOLDERS,
  LETTER_STATUS,
  LETTER_STATUS_LABEL,
  MAX_PAGE_SIZE,
  QUOTATION_CURRENCY,
  QUOTATION_STATUS,
  QUOTATION_STATUS_LABEL,
  TEMPLATE_CATEGORY,
  TEMPLATE_CATEGORY_LABEL,
} from '../constants';
import { getActiveChannel } from '../services/mailer.service';
import { healthHandler, overviewHandler } from '../controllers/stats.controller';
import { requireAuth } from '../middleware/auth.middleware';

import authRoutes from './auth.routes';
import customerRoutes from './customer.routes';
import letterRoutes from './letter.routes';
import quotationRoutes from './quotation.routes';
import templateRoutes from './template.routes';
import userRoutes from './user.routes';

const router = Router();

/* ---------- 公开接口 ---------- */
router.get('/health', healthHandler);

/**
 * 元数据接口：把枚举与占位符定义下发给前端，
 * 避免前后端各写一份、改了一处忘了另一处。
 */
router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      customerStatus: CUSTOMER_STATUS.map((value) => ({ value, label: CUSTOMER_STATUS_LABEL[value] })),
      customerSource: CUSTOMER_SOURCE,
      letterStatus: LETTER_STATUS.map((value) => ({ value, label: LETTER_STATUS_LABEL[value] })),
      quotationStatus: QUOTATION_STATUS.map((value) => ({ value, label: QUOTATION_STATUS_LABEL[value] })),
      quotationCurrency: QUOTATION_CURRENCY,
      templateCategory: TEMPLATE_CATEGORY.map((value) => ({ value, label: TEMPLATE_CATEGORY_LABEL[value] })),
      placeholders: LETTER_PLACEHOLDERS.map(({ key, label }) => ({ key, label, token: `{{${key}}}` })),
      mailChannel: getActiveChannel(),
      maxPageSize: MAX_PAGE_SIZE,
      company: {
        name: env.COMPANY_NAME,
        website: env.COMPANY_WEBSITE,
        moq: env.COMPANY_MOQ,
        senderName: env.SENDER_NAME,
        mailFrom: env.MAIL_FROM,
      },
    });
  }),
);

/* ---------- 需要登录的接口 ---------- */
router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/letters', letterRoutes);
router.use('/quotations', quotationRoutes);
router.use('/templates', templateRoutes);
router.use('/users', userRoutes);
router.get('/stats/overview', requireAuth, overviewHandler);

export default router;
