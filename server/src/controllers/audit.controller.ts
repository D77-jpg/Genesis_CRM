import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { listAuditLogs } from '../services/audit.service';
import type { ListAuditLogsQuery } from '../validators/audit.validator';

export const listAuditLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAuditLogsQuery;
  const data = await listAuditLogs(query);
  sendSuccess(res, data);
});
