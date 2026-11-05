import { Router } from 'express';
import { requireProject, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/pagination';
import { credentialCreateBody, credentialListQuery, credentialLogQuery, credentialParams, credentialRotateBody } from '../validators/integration-management.validator';
import { credentialDto, listIntegrationLogs, listManagedCredentials, manageableCredential, managementScope, managementSettings } from '../services/integration-management.service';
import { createCredential, revokeCredential, rotateCredential } from '../services/integration-credential.service';
import { recordAudit } from '../services/audit.service';

const router = Router();
// Parent project router already requires the current CRM user's authentication.
router.use(requireRole('admin', 'project_admin'), (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  if (!/^[a-f\d]{24}$/i.test(String(req.headers['x-project-id'] ?? ''))) return next(ApiError.badRequest('必须明确指定项目'));
  next();
}, requireProject);
router.get('/settings', asyncHandler(async (req, res) => sendSuccess(res, await managementSettings(req.user!))));
router.get('/credentials', validate({ query: credentialListQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; limit: number };
  const result = await listManagedCredentials(req.user!, q.page, q.limit);
  await recordAudit({ actor: req.user, request: req, action: 'integration.credential.list', detail: {} });
  sendSuccess(res, result);
}));
router.post('/credentials', validate({ body: credentialCreateBody }), asyncHandler(async (req, res) => {
  const s = await managementScope(req.user!);
  const { name, scopes, expiresAt } = req.body;
  const issued = await createCredential({ name, scopes, expiresAt: expiresAt ? new Date(expiresAt) : null,
    projectIds: [String(s.projectId)], createdBy: req.user!.id }, { actor: req.user, request: req });
  sendSuccess(res, { credential: await credentialDto(issued.credential), token: issued.token }, 201);
}));
router.post('/credentials/:credentialId/revoke', validate({ params: credentialParams, body: credentialRotateBody.pick({}).optional().default({}) }), asyncHandler(async (req, res) => {
  const credential = await manageableCredential(req.user!, req.params.credentialId);
  const revoked = await revokeCredential(String(credential._id), { actor: req.user, request: req });
  sendSuccess(res, await credentialDto(revoked));
}));
router.post('/credentials/:credentialId/rotate', validate({ params: credentialParams, body: credentialRotateBody }), asyncHandler(async (req, res) => {
  const credential = await manageableCredential(req.user!, req.params.credentialId);
  const issued = await rotateCredential(String(credential._id), req.body.graceSeconds, { actor: req.user, request: req });
  sendSuccess(res, { credential: await credentialDto(issued.credential), token: issued.token });
}));
router.get('/request-logs', validate({ query: credentialLogQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; limit: number; credentialId?: string };
  const result = await listIntegrationLogs(req.user!, q.page, q.limit, q.credentialId);
  await recordAudit({ actor: req.user, request: req, action: 'integration.logs.view', detail: {} });
  sendSuccess(res, result);
}));
export default router;
