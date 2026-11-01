import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { validate } from '../middleware/validate.middleware';
import {
  controlOutreachEnrollment,
  getOutreachAutomationOverview,
  pauseOutreachAutomation,
  resumeOutreachAutomation,
  saveOutreachAutomationConfig,
  startOutreachAutomation,
} from '../services/outreach-automation.service';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID 格式不正确');
const configInput = z.object({
  expectedVersion: z.number().int().min(0),
  dailyLimit: z.number().int().min(1).max(20),
  perDomainLimit: z.number().int().min(1).max(10),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/, '开始时间格式不正确'),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/, '结束时间格式不正确'),
  timezone: z.string().trim().min(1).max(80),
}).strict();
const startInput = z.object({
  customerIds: z.array(objectId).max(500).optional(),
}).strict();
const targetUserId = (req: Request): string | undefined =>
  typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined;

router.get('/', asyncHandler(async (req, res) => {
  sendSuccess(res, await getOutreachAutomationOverview(req.user!, targetUserId(req)));
}));

router.put('/', validate({ body: configInput }), asyncHandler(async (req, res) => {
  sendSuccess(res, await saveOutreachAutomationConfig(req.body, req.user!, targetUserId(req)));
}));

router.post('/start', validate({ body: startInput }), asyncHandler(async (req, res) => {
  sendSuccess(res, await startOutreachAutomation(req.user!, req.body.customerIds, targetUserId(req)));
}));

router.post('/pause', asyncHandler(async (req, res) => {
  sendSuccess(res, await pauseOutreachAutomation(req.user!, targetUserId(req)));
}));

router.post('/resume', asyncHandler(async (req, res) => {
  sendSuccess(res, await resumeOutreachAutomation(req.user!, targetUserId(req)));
}));

for (const action of ['pause', 'resume'] as const) {
  router.post(`/enrollments/:id/${action}`, validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    sendSuccess(res, await controlOutreachEnrollment(req.user!, req.params.id, action, targetUserId(req)));
  }));
}

export default router;
