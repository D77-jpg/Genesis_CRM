import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { listAuditLogsQuerySchema } from '../validators/audit.validator';
import { listAuditLogsHandler } from '../controllers/audit.controller';

const router = Router();

// Audit records can contain usernames and internal identifiers; administrators only.
router.use(requireAuth, requireRole('admin'));
router.get('/', validate({ query: listAuditLogsQuerySchema }), listAuditLogsHandler);

export default router;
