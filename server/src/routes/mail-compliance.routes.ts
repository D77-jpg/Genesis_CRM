import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireProject, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { Project, EmailSuppression } from '../models';
import {
  checkDomainHealth,
  effectiveDailyLimit,
  getProjectComplianceSettings,
  listSuppressions,
  removeSuppression,
  suppressEmail,
} from '../services/mail-compliance.service';
import { domainFromAddress } from '../utils/domain';
import { recordAudit } from '../services/audit.service';

const router = Router();
router.use(requireAuth, requireProject, requireRole('admin', 'project_admin'));

const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);
const listQuery = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const createSchema = z.object({
  email: z.string().trim().email('邮箱格式不正确').max(200),
  reason: z.enum(['unsubscribe', 'hard_bounce', 'complaint', 'spam', 'manual']).default('manual'),
  note: z.string().trim().max(500).optional(),
  global: z.boolean().default(false),
}).strict();
const settingsSchema = z.object({
  warmupEnabled: z.boolean(),
  warmupStartedAt: z.coerce.date().optional(),
  warmupStartLimit: z.number().int().min(1).max(5000),
  warmupDailyIncrement: z.number().int().min(1).max(1000),
  warmupMaxLimit: z.number().int().min(1).max(10000),
  dailySendLimit: z.number().int().min(1).max(10000),
  trackingEnabled: z.boolean().optional(),
}).strict();

router.get('/overview', asyncHandler(async (req, res) => {
  const projectId = req.user!.projectId!;
  const project = await Project.findById(projectId).select('mailFrom').lean();
  const [settings, suppressionCount] = await Promise.all([
    getProjectComplianceSettings(projectId),
    EmailSuppression.countDocuments({ $or: [{ scopeKey: `project:${projectId}` }, { scopeKey: 'global' }] }),
  ]);
  sendSuccess(res, {
    settings,
    suppressionCount,
    mailFrom: project?.mailFrom,
    domain: domainFromAddress(project?.mailFrom),
    domainHealth: null,
    // Project-level cap only; each mailbox still takes the lower of this and
    // its own dailyLimit inside reserveMailAttempt().
    effectiveDailyLimit: effectiveDailyLimit({ mailCompliance: settings }, 100_000).limit,
  });
}));

router.get('/suppressions', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuery>;
  const result = await listSuppressions({ projectId: req.user!.projectId!, ...query });
  sendSuccess(res, { items: result.items, total: result.total, page: query.page, limit: query.limit });
}));

router.post('/suppressions', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof createSchema>;
  if (input.global && req.user!.role !== 'admin') throw ApiError.forbidden('只有系统管理员可以写入全局抑制名单');
  await suppressEmail({ projectId: req.user!.projectId!, email: input.email, reason: input.reason, source: 'admin',
    note: input.note, createdBy: req.user!.id, global: input.global });
  await recordAudit({
    actor: req.user, action: 'mail.suppression.add', targetType: 'email', targetId: input.email,
    projectId: req.user!.projectId!, detail: { reason: input.reason, global: input.global }, request: req,
  });
  sendSuccess(res, { saved: true }, 201);
}));

router.delete('/suppressions/:id', validate({ params: z.object({ id: idSchema }) }), asyncHandler(async (req, res) => {
  await removeSuppression(req.user!.projectId!, req.params.id, req.user!.role === 'admin');
  await recordAudit({
    actor: req.user, action: 'mail.suppression.remove', targetType: 'email_suppression', targetId: req.params.id,
    projectId: req.user!.projectId!, request: req,
  });
  sendSuccess(res, { deleted: true });
}));

router.get('/domain-health', asyncHandler(async (req, res) => {
  const domain = String(req.query.domain || '').trim() || domainFromAddress((await Project.findById(req.user!.projectId).select('mailFrom').lean())?.mailFrom);
  const selector = String(req.query.selector || 'default').trim().slice(0, 80) || 'default';
  sendSuccess(res, await checkDomainHealth(domain, selector));
}));

router.put('/settings', validate({ body: settingsSchema }), asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof settingsSchema>;
  const current = await getProjectComplianceSettings(req.user!.projectId!);
  if (input.warmupEnabled && !input.warmupStartedAt && !current.warmupStartedAt) input.warmupStartedAt = new Date();
  const next = { ...current, ...input };
  await Project.updateOne({ _id: new Types.ObjectId(req.user!.projectId!) }, { $set: { mailCompliance: next } });
  await recordAudit({
    actor: req.user, action: 'mail.compliance.settings', targetType: 'project', targetId: req.user!.projectId!,
    projectId: req.user!.projectId!, detail: { ...input }, request: req,
  });
  sendSuccess(res, await getProjectComplianceSettings(req.user!.projectId!));
}));

export default router;
