import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { validate } from '../middleware/validate.middleware';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.middleware';
import { Organization, Project, UsageRecord, User } from '../models';
import { planCatalog } from '../constants/plans';
import {
  createOrganization,
  listOrganizations,
  toOrganizationDto,
  updateOrganization,
} from '../services/organization.service';
import { createInvoiceEstimate, currentUsagePeriod, getUsageSummary } from '../services/usage.service';
import { recentErrors } from '../services/error-monitor.service';

const router = Router();
router.use(requireAuth, requirePlatformAdmin);

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
  plan: z.enum(['starter', 'growth', 'enterprise']).optional(),
  billingEmail: z.string().email().max(200).optional().or(z.literal('')),
  adminUsername: z.string().trim().toLowerCase().min(3).max(40),
  adminPassword: z.string().min(10).max(128),
  adminDisplayName: z.string().trim().max(80).optional(),
  adminEmail: z.string().email().max(200).optional().or(z.literal('')),
}).strict();

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: z.enum(['active', 'trialing', 'suspended']).optional(),
  plan: z.enum(['starter', 'growth', 'enterprise']).optional(),
  billingEmail: z.string().email().max(200).optional().or(z.literal('')),
  billingAddress: z.string().trim().max(500).optional(),
  taxId: z.string().trim().max(80).optional(),
  currency: z.string().trim().length(3).optional(),
  locale: z.enum(['zh', 'en']).optional(),
  limits: z.object({
    users: z.number().int().positive().optional(),
    projects: z.number().int().positive().optional(),
    monthlyEmails: z.number().int().positive().optional(),
    monthlyAiTokens: z.number().int().positive().optional(),
    storageBytes: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict();

router.get('/overview', asyncHandler(async (_req, res) => {
  const [organizations, projects, users, activeSubscriptions] = await Promise.all([
    Organization.countDocuments({}),
    Project.countDocuments({ status: 'active' }),
    User.countDocuments({ status: { $ne: 'disabled' } }),
    Organization.countDocuments({ status: 'active', subscriptionStatus: { $in: ['active', 'trialing'] } }),
  ]);
  const period = currentUsagePeriod();
  const emailUsage = await UsageRecord.aggregate([
    { $match: { period, metric: 'emails' } },
    { $group: { _id: null, value: { $sum: '$value' } } },
  ]);
  sendSuccess(res, {
    organizations,
    activeSubscriptions,
    projects,
    users,
    period,
    emailsThisMonth: emailUsage[0]?.value ?? 0,
    plans: planCatalog(),
  });
}));

router.get('/errors', asyncHandler(async (_req, res) => {
  sendSuccess(res, recentErrors());
}));

router.get('/organizations', asyncHandler(async (_req, res) => {
  const organizations = await listOrganizations();
  const withUsage = await Promise.all(organizations.map(async (organization) => ({
    ...organization,
    usage: await getUsageSummary(organization.id),
    counts: {
      users: await User.countDocuments({ organizationId: new Types.ObjectId(organization.id), status: { $ne: 'disabled' } }),
      projects: await Project.countDocuments({ organizationId: new Types.ObjectId(organization.id), status: 'active' }),
    },
  })));
  sendSuccess(res, withUsage);
}));

router.post('/organizations', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof createSchema>;
  const organization = await createOrganization({
    ...input,
    billingEmail: input.billingEmail || undefined,
    adminEmail: input.adminEmail || undefined,
  }, req.user!);
  sendSuccess(res, organization, 201);
}));

router.get('/organizations/:id', asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.params.id);
  if (!organization) throw ApiError.notFound('组织不存在');
  sendSuccess(res, {
    organization: toOrganizationDto(organization),
    usage: await getUsageSummary(String(organization._id)),
  });
}));

router.patch('/organizations/:id', validate({ body: updateSchema }), asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof updateSchema>;
  const updated = await updateOrganization(req.params.id, {
    ...input,
    billingEmail: input.billingEmail || undefined,
  }, req.user!);
  sendSuccess(res, updated);
}));

router.get('/organizations/:id/usage', asyncHandler(async (req, res) => {
  sendSuccess(res, await getUsageSummary(req.params.id));
}));

router.post('/organizations/:id/invoices', asyncHandler(async (req, res) => {
  sendSuccess(res, await createInvoiceEstimate(req.params.id), 201);
}));

export default router;
