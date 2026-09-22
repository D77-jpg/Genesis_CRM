import { Router } from 'express';
import { requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { objectIdSchema } from '../validators/common';
import { upsertMailAccountSchema } from '../validators/mail-account.validator';
import {
  currentMailSenderHandler,
  getUserMailAccountHandler,
  upsertUserMailAccountHandler,
  verifyUserMailAccountHandler,
} from '../controllers/mail-account.controller';
import { z } from 'zod';

const userParams = z.object({ userId: objectIdSchema });
const router = Router();

router.get('/current', currentMailSenderHandler);
router.get('/users/:userId', requireRole('admin'), validate({ params: userParams }), getUserMailAccountHandler);
router.put('/users/:userId', requireRole('admin'), validate({ params: userParams, body: upsertMailAccountSchema }), upsertUserMailAccountHandler);
router.post('/users/:userId/verify', requireRole('admin'), validate({ params: userParams }), verifyUserMailAccountHandler);

export default router;
