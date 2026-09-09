/**
 * 统计 / 健康检查接口
 *   GET /api/stats/overview   仪表盘汇总
 *   GET /api/health           存活与依赖检查
 */
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import env from '../config/env';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { getCustomerStats } from '../services/customer.service';
import { getLetterStats, listLetters } from '../services/letter.service';
import { getSalesWorkspace } from '../services/stats.service';
import { getActiveChannel } from '../services/mailer.service';
import type { ListLettersQuery } from '../validators/letter.validator';

/** 仪表盘「最近发送」固定取最新 6 条 */
const RECENT_LETTER_QUERY = {
  page: 1,
  limit: 6,
  sortBy: 'sentAt',
  sortOrder: 'desc',
} as unknown as ListLettersQuery;

export const overviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const [customer, letter, recentResult, workspace] = await Promise.all([
    getCustomerStats(req.user),
    getLetterStats(req.user),
    listLetters(RECENT_LETTER_QUERY, req.user),
    getSalesWorkspace(req.user),
  ]);

  const developmentRate = customer.total > 0 ? Number(((customer.developed / customer.total) * 100).toFixed(1)) : 0;

  sendSuccess(res, {
    customer,
    letter,
    developmentRate,
    recentLetters: recentResult.items,
    workspace,
  });
});

export const healthHandler = asyncHandler(async (_req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  const payload = {
    status: dbState === 1 ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    database: dbStatusMap[dbState] ?? 'unknown',
    mailChannel: getActiveChannel(),
    version: '2.0.0',
  };

  // 数据库不可用时返回 503，方便容器探针识别
  sendSuccess(res, payload, dbState === 1 ? 200 : 503);
});
