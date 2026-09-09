/**
 * 报价单路由（顶层）
 * ------------------------------------------------------------------
 * 客户详情页的报价单走嵌套路由 /customers/:id/quotations（见 customer.routes）；
 * 这里提供跨客户的列表 / 详情 / 新建，用于「按状态查询、按客户筛选」等场景。
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import {
  createQuotationSchema,
  idParamsSchema,
  listQuotationsQuerySchema,
} from '../validators/quotation.validator';
import {
  createQuotationHandler,
  getQuotationHandler,
  listQuotationsHandler,
} from '../controllers/quotation.controller';

const router = Router();

router.use(requireAuth);

/* ---------- 集合级操作 ---------- */
router.get('/', validate({ query: listQuotationsQuerySchema }), listQuotationsHandler);
router.post('/', validate({ body: createQuotationSchema }), createQuotationHandler);

/* ---------- 单条操作 ---------- */
router.get('/:id', validate({ params: idParamsSchema }), getQuotationHandler);

export default router;
