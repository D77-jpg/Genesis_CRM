import integrationWebhookRoutes from './integration-webhook.routes';
import { Router } from 'express';
import integrationManagementRoutes from './integration-management.routes';
import { requireAuth, requireProject, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamsSchema } from '../validators/common';
import { createProjectSchema, updateProjectSchema } from '../validators/project.validator';
import { createProjectHandler, deleteProjectHandler, listProjectsHandler, updateProjectHandler } from '../controllers/project.controller';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { completeOnboarding, getOnboardingStatus } from '../services/onboarding.service';
import { recordAudit } from '../services/audit.service';

const router = Router();
router.use(requireAuth);
router.use('/integrations', integrationManagementRoutes);
router.use('/integrations', integrationWebhookRoutes);
router.get('/', listProjectsHandler);
// Keep these before /:id so "onboarding" is not parsed as a project id.
router.get('/onboarding', requireProject, asyncHandler(async (req, res) => {
  sendSuccess(res, await getOnboardingStatus(req.user!.projectId!, req.user!));
}));
router.post('/onboarding/complete', requireProject, asyncHandler(async (req, res) => {
  const status = await completeOnboarding(req.user!.projectId!, req.user!);
  await recordAudit({
    actor: req.user, action: 'project.onboarding.completed', targetType: 'project',
    targetId: req.user!.projectId!, projectId: req.user!.projectId!, request: req,
  });
  sendSuccess(res, status);
}));
router.post('/', requireRole('admin'), validate({ body: createProjectSchema }), createProjectHandler);
router.put('/:id', requireRole('admin', 'project_admin'), validate({ params: idParamsSchema, body: updateProjectSchema }), updateProjectHandler);
router.delete('/:id', requireRole('admin'), validate({ params: idParamsSchema }), deleteProjectHandler);
export default router;
