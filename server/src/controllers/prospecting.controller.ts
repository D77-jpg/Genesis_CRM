import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler';
import { requireProjectId } from '../utils/access';
import { sendSuccess } from '../utils/pagination';
import { loadProfile } from '../services/prospecting/profile';
import {
  approveProspect, getProspectingConfig, prospectingReport, prospectingToday, rejectProspect,
  startProspecting, updateProspectingConfig,syncProspectCustomer,refreshProspectContact,
} from '../services/prospecting/prospecting.service';
import { importProspects } from '../services/prospecting/import-prospects';
import { cancelEnrichRun, getEnrichRun, previewEnrich, startEnrichRun } from '../services/prospecting/enrich.service';

export const todayHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { status?: string; limit?: string; offset?: string };
  const options = {
    status: query.status,
    limit: query.limit === undefined ? undefined : Number(query.limit),
    offset: query.offset === undefined ? undefined : Number(query.offset),
  };
  sendSuccess(res, await prospectingToday(req.user!, options));
});

export const runHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await startProspecting(req.user!, req.body as { profileId?:string;queries?: string[]; enrichLimit?: number }), 202);
});

export const approveHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await approveProspect(req.user!, req.params.id));
});

export const refreshContactHandler=asyncHandler(async(req:Request,res:Response)=>{sendSuccess(res,await refreshProspectContact(req.user!,req.params.id));});
export const syncCustomerHandler=asyncHandler(async(req:Request,res:Response)=>{sendSuccess(res,await syncProspectCustomer(req.user!,req.params.id));});

export const rejectHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await rejectProspect(req.user!, req.params.id, (req.body as { reason?: string }).reason));
});

export const importHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await importProspects(req.user!, req.body as { rows: unknown[]; dryRun?: boolean }));
});

export const enrichPreviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const scope = req.query as { grade?: string; source?: string };
  sendSuccess(res, await previewEnrich(req.user!, scope));
});

export const startEnrichHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { modes: ('site' | 'hunter' | 'discover')[]; scope?: { grade?: string; source?: string }; limit?: number };
  sendSuccess(res, await startEnrichRun(req.user!, body), 202);
});

export const enrichRunHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getEnrichRun(req.user!, req.params.id));
});

export const cancelEnrichHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await cancelEnrichRun(req.user!, req.params.id));
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
    profiles:config.profiles,activeProfileId:config.activeProfileId,version:config.version,
    ownerId: config.ownerId ? String(config.ownerId) : null,
    profileTitle: profile?.title ?? null,
  });
});

export const updateConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const config = await updateProspectingConfig(req.user!, req.body as Record<string, unknown>);
  sendSuccess(res, config);
});
