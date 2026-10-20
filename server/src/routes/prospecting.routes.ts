import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamsSchema } from '../validators/common';
import { prospectingConfigSchema, rejectProspectSchema, runProspectingSchema } from '../validators/prospecting.validator';
import {
  approveHandler, configHandler, rejectHandler, reportHandler, runHandler, todayHandler, updateConfigHandler,
} from '../controllers/prospecting.controller';

const router = Router();
router.use(requireAuth);
router.get('/today', todayHandler);
router.get('/report', reportHandler);
router.get('/config', configHandler);
router.put('/config', requireRole('admin'), validate({ body: prospectingConfigSchema }), updateConfigHandler);
router.post('/run', requireRole('admin'), validate({ body: runProspectingSchema }), runHandler);
router.post('/:id/approve', validate({ params: idParamsSchema }), approveHandler);
router.post('/:id/reject', validate({ params: idParamsSchema, body: rejectProspectSchema }), rejectHandler);
export default router;
