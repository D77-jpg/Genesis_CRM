/**
 * 统计 / 健康检查接口
 *   GET /api/stats/overview   仪表盘汇总
 *   GET /api/health           存活 + Mongo 主动探测（兼容旧探针）
 *   GET /api/health/live      仅进程存活，不访问数据库
 *   GET /api/health/ready     严格就绪：Mongo ping 成功且未在停机
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
import { isDraining } from '../services/runtime-state';
import type { ListLettersQuery } from '../validators/letter.validator';

/** 仪表盘「最近发送」固定取最新 6 条 */
const RECENT_LETTER_QUERY = {
  page: 1,
  limit: 6,
  sortBy: 'sentAt',
  sortOrder: 'desc',
} as unknown as ListLettersQuery;

const dbStatusMap: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

interface DatabaseProbe {
  ok: boolean;
  latencyMs: number | null;
  state: string;
}

async function probeDatabase(): Promise<DatabaseProbe> {
  const readyState = mongoose.connection.readyState;
  const state = dbStatusMap[readyState] ?? 'unknown';
  if (readyState !== 1 || !mongoose.connection.db) return { ok: false, latencyMs: null, state };
  const started = performance.now();
  try {
    await mongoose.connection.db.admin().command({ ping: 1, maxTimeMS: 1200 });
    return { ok: true, latencyMs: Math.round((performance.now() - started) * 10) / 10, state };
  } catch {
    return { ok: false, latencyMs: Math.round((performance.now() - started) * 10) / 10, state };
  }
}

function processSnapshot() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Math.round(process.uptime()),
    rssMiB: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
    heapUsedMiB: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
  };
}

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

/** 不依赖数据库的存活探针：容器重启循环不应因为 Mongo 慢查询误杀进程。 */
export const liveHandler = (_req: Request, res: Response) => {
  sendSuccess(res, {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '2.6.0',
  });
};

export const healthHandler = asyncHandler(async (_req: Request, res: Response) => {
  const database = await probeDatabase();
  const draining = isDraining();
  const ready = database.ok && !draining;
  sendSuccess(res, {
    status: ready ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    database: database.state,
    checks: { database: { ok: database.ok, latencyMs: database.latencyMs }, draining },
    process: processSnapshot(),
    mailChannel: getActiveChannel(),
    version: '2.6.0',
  }, ready ? 200 : 503);
});

/** 严格就绪；只返回检查结果，不回显连接串、栈、路径或内部错误。 */
export const readyHandler = asyncHandler(async (_req: Request, res: Response) => {
  const database = await probeDatabase();
  const draining = isDraining();
  const ready = database.ok && !draining;
  sendSuccess(res, {
    status: ready ? 'ok' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks: { database: database.ok ? 'ok' : 'unavailable', draining },
  }, ready ? 200 : 503);
});
