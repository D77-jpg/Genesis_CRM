import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { validate } from '../middleware/validate.middleware';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { BillingInvoice } from '../models';
import { planCatalog } from '../constants/plans';
import { toOrganizationDto, resolveOrganization, updateOrganization } from '../services/organization.service';
import { createInvoiceEstimate, getUsageSummary } from '../services/usage.service';

const router = Router();
router.use(requireAuth);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  billingEmail: z.string().email().max(200).optional().or(z.literal('')),
  billingAddress: z.string().trim().max(500).optional(),
  taxId: z.string().trim().max(80).optional(),
  currency: z.string().trim().length(3).optional(),
  locale: z.enum(['zh', 'en']).optional(),
}).strict();

router.get('/current', asyncHandler(async (req, res) => {
  const organization = await resolveOrganization(req.user!);
  const canSeeBilling = req.user!.role === 'admin';
  sendSuccess(res, {
    organization: toOrganizationDto(organization),
    plans: planCatalog(),
    ...(canSeeBilling ? { usage: await getUsageSummary(String(organization._id)) } : {}),
  });
}));

router.put('/current', requireRole('admin'), validate({ body: updateSchema }), asyncHandler(async (req, res) => {
  const organization = await resolveOrganization(req.user!);
  const input = req.body as z.infer<typeof updateSchema>;
  const updated = await updateOrganization(String(organization._id), input, req.user!);
  sendSuccess(res, updated);
}));

router.get('/current/usage', requireRole('admin'), asyncHandler(async (req, res) => {
  const organization = await resolveOrganization(req.user!);
  sendSuccess(res, await getUsageSummary(String(organization._id)));
}));

router.get('/current/invoices', requireRole('admin'), asyncHandler(async (req, res) => {
  const organization = await resolveOrganization(req.user!);
  const invoices = await BillingInvoice.find({ organizationId: organization._id }).sort({ period: -1 }).limit(24);
  sendSuccess(res, invoices.map((invoice) => invoice.toObject()));
}));

router.post('/current/invoices', requireRole('admin'), asyncHandler(async (req, res) => {
  const organization = await resolveOrganization(req.user!);
  sendSuccess(res, await createInvoiceEstimate(String(organization._id)), 201);
}));

router.get('/plans', asyncHandler(async (_req, res) => {
  sendSuccess(res, planCatalog());
}));

export default router;
