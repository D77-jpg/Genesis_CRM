import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { getTemplatePerformanceSummary, type PerformanceWindowDays } from '../services/template-performance.service';
import {
  generateTemplateSuggestion, getTemplateSuggestion, confirmTemplateSuggestionCopy, cancelTemplateSuggestion,
} from '../services/template-suggestion.service';
import type { AuthUser } from '../types/express';

export const performanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const { windowDays, sampleThreshold } = req.query as unknown as { windowDays: PerformanceWindowDays; sampleThreshold: number };
  sendSuccess(res, await getTemplatePerformanceSummary(windowDays, req.user, sampleThreshold));
});
export const suggestTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await generateTemplateSuggestion(req.params.id, req.body as { idempotencyKey: string }, req.user as AuthUser), 201);
});
export const getSuggestionHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getTemplateSuggestion(req.params.id, req.params.suggestionId, req.user as AuthUser));
});
export const copySuggestionHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await confirmTemplateSuggestionCopy(req.params.id, req.params.suggestionId,
    req.body as { expectedVersion: number; requestKey: string }, req.user as AuthUser), 201);
});
export const cancelSuggestionHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await cancelTemplateSuggestion(req.params.id, req.params.suggestionId, req.user as AuthUser));
});
