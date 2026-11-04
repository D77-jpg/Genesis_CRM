import { Router } from 'express';
import { planCatalog } from '../constants/plans';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';

const router = Router();

/** Public, unauthenticated product catalog used by the pricing page. */
router.get('/plans', asyncHandler(async (_req, res) => {
  sendSuccess(res, {
    currency: 'USD',
    annualDiscountMonths: 2,
    plans: planCatalog(),
    trialDays: 14,
  });
}));

export default router;
