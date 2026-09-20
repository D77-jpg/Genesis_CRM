import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamsSchema } from '../validators/common';
import { createProjectSchema, updateProjectSchema } from '../validators/project.validator';
import { createProjectHandler, listProjectsHandler, updateProjectHandler } from '../controllers/project.controller';

const router = Router();
router.use(requireAuth);
router.get('/', listProjectsHandler);
router.post('/', requireRole('admin'), validate({ body: createProjectSchema }), createProjectHandler);
router.put('/:id', requireRole('admin'), validate({ params: idParamsSchema, body: updateProjectSchema }), updateProjectHandler);
export default router;
