import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { getCurrentMailSender, getMailAccount, upsertMailAccount, verifyMailAccount } from '../services/mail-account.service';
import type { UpsertMailAccountInput } from '../validators/mail-account.validator';

export const currentMailSenderHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getCurrentMailSender(req.user!.projectId!, req.user!.id));
});

export const getUserMailAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getMailAccount(req.user!.projectId!, req.params.userId));
});

export const upsertUserMailAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await upsertMailAccount(
    req.user!.projectId!,
    req.params.userId,
    req.user!.id,
    req.body as UpsertMailAccountInput,
  );
  sendSuccess(res, data);
});

export const verifyUserMailAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await verifyMailAccount(req.user!.projectId!, req.params.userId, req.user!.id));
});
