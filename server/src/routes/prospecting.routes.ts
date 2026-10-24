import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamsSchema } from '../validators/common';
import {
  enrichPreviewSchema,
  todayQuerySchema,
  importProspectsSchema,
  prospectingConfigSchema,
  rejectProspectSchema,
  runProspectingSchema,
  startEnrichSchema,
} from '../validators/prospecting.validator';
import {
  approveHandler, configHandler, importHandler, rejectHandler, reportHandler, runHandler, todayHandler, updateConfigHandler,syncCustomerHandler,refreshContactHandler,
  enrichPreviewHandler, startEnrichHandler, enrichRunHandler, cancelEnrichHandler,
} from '../controllers/prospecting.controller';

const router = Router();
router.use(requireAuth);
router.get('/today', validate({ query: todayQuerySchema }), todayHandler);
router.get('/report', reportHandler);
router.get('/config', configHandler);
router.put('/config', requireRole('admin'), validate({ body: prospectingConfigSchema }), updateConfigHandler);
router.post('/run', requireRole('admin'), validate({ body: runProspectingSchema }), runHandler);
// Excel 导入线索：任何业务员都能导，导入的线索落自己的项目池
router.post('/import', validate({ body: importProspectsSchema }), importHandler);
// 批量补全联系方式（抓官网 / Hunter 找邮箱 / 搜索补官网）：会消耗外部额度，仅管理员
router.get('/enrich/preview', requireRole('admin'), validate({ query: enrichPreviewSchema }), enrichPreviewHandler);
router.post('/enrich', requireRole('admin'), validate({ body: startEnrichSchema }), startEnrichHandler);
router.get('/enrich/:id', requireRole('admin'), validate({ params: idParamsSchema }), enrichRunHandler);
router.post('/enrich/:id/cancel', requireRole('admin'), validate({ params: idParamsSchema }), cancelEnrichHandler);
router.post('/:id/approve', validate({ params: idParamsSchema }), approveHandler);
router.post('/:id/refresh-contact',requireRole('admin'),validate({params:idParamsSchema}),refreshContactHandler);
router.post('/:id/sync-customer',validate({params:idParamsSchema}),syncCustomerHandler);
router.post('/:id/reject', validate({ params: idParamsSchema, body: rejectProspectSchema }), rejectHandler);
export default router;
