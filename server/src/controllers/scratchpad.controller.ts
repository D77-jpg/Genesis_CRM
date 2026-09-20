import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { getScratchpad, updateScratchpad } from '../services/scratchpad.service';
import type { UpdateScratchpadInput } from '../validators/scratchpad.validator';

export const getScratchpadHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getScratchpad(req.user?.id, req.user?.projectId);
  sendSuccess(res, data);
});

export const updateScratchpadHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await updateScratchpad(req.body as UpdateScratchpadInput, req.user?.id, req.user?.projectId);
  sendSuccess(res, data);
});
