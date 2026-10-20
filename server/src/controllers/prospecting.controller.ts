import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler';
import { requireProjectId } from '../utils/access';
import { sendSuccess } from '../utils/pagination';
import { loadProfile } from '../services/prospecting/profile';
import {
  approveProspect, getProspectingConfig, prospectingReport, prospectingToday, rejectProspect,
  startProspecting, updateProspectingConfig,
} from '../services/prospecting/prospecting.service';

export const todayHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await prospectingToday(req.user!));
});

export const runHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await startProspecting(req.user!, req.body as { queries?: string[]; enrichLimit?: number }), 202);
});

export const approveHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await approveProspect(req.user!, req.params.id));
});

export const rejectHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await rejectProspect(req.user!, req.params.id, (req.body as { reason?: string }).reason));
});

export const reportHandler = asyncHandler(async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
  sendSuccess(res, await prospectingReport(req.user!, days));
});

export const configHandler = asyncHandler(async (req: Request, res: Response) => {  const config = await getProspectingConfig(req.user!);
  const profile = await loadProfile(new Types.ObjectId(requireProjectId(req.user!))).catch(() => null);
  sendSuccess(res, {
    enabled: config.enabled, dailyTarget: config.dailyTarget, queries: config.queries,
    minScore: config.minScore, llmScoring: config.llmScoring ?? true, enrichLimit: config.enrichLimit, cooldownDays: config.cooldownDays,
    hunterLimit: config.hunterLimit ?? 15,
    runAt: config.runAt, reviewAt: config.reviewAt, timezone: config.timezone,
    ownerId: config.ownerId ? String(config.ownerId) : null,
    profileTitle: profile?.title ?? null,
  });
});

export const updateConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const config = await updateProspectingConfig(req.user!, req.body as Record<string, unknown>);
  sendSuccess(res, config);
});
