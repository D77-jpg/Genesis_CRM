import { createLogger } from '../../config/logger';
import { Project } from '../../models/Project';
import { ProspectingConfig } from '../../models/ProspectingConfig';
import { ProspectingRun } from '../../models/ProspectingRun';
import { User } from '../../models/User';
import type { AuthUser } from '../../types/express';
import { dayIn, recentBounceRisk, startProspecting } from './prospecting.service';

const logger = createLogger('prospecting-scheduler');
const active = new Set<string>();
let timer: NodeJS.Timeout | undefined;

export function localMinutes(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** Fires between runAt and runAt + catchUpMinutes; the DB check guarantees once per day. */
export function dueNow(now: Date, runAt: string, timeZone: string, catchUpMinutes = 180): boolean {
  const [hour, minute] = runAt.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const target = hour * 60 + minute;
  const current = localMinutes(now, timeZone);
  return current >= target && current <= target + catchUpMinutes;
}

export async function tickProspectingScheduler(now = new Date()): Promise<void> {
  const configs = await ProspectingConfig.find({ enabled: true }).lean();
  for (const config of configs) {
    if (!dueNow(now, config.runAt, config.timezone)) continue;
    const day = dayIn(config.timezone);
    const key = `${String(config.projectId)}:${day}`;
    if (active.has(key)) continue;
    if (await ProspectingRun.exists({ projectId: config.projectId, day })) continue;
    const risk = await recentBounceRisk(config.projectId);
    if (risk.risky) {
      logger.warn(`退信保护：24h 发出 ${risk.sent}、退信 ${risk.bounced}，暂停项目 ${String(config.projectId)} 的自动生成`);
      await ProspectingConfig.updateOne({ _id: config._id }, { $set: { enabled: false } });
      continue;
    }
    const ownerId = config.ownerId
      ?? (await Project.findById(config.projectId).select('createdBy').lean())?.createdBy
      ?? (await User.findOne({ role: 'admin', status: 'active' }).select('_id').lean())?._id;
    if (!ownerId) { logger.warn('跳过自动开发：项目没有可用负责人'); continue; }
    active.add(key);
    try {
      const actor: AuthUser = {
        id: String(ownerId), projectId: String(config.projectId), role: 'admin',
        username: 'scheduler', displayName: '自动开发',
      };
      await startProspecting(actor, {});
      logger.info(`已启动每日自动开发：项目 ${String(config.projectId)}，${day}`);
    } catch (error) {
      logger.warn('自动开发启动失败', error instanceof Error ? error.message : String(error));
    } finally {
      active.delete(key);
    }
  }
}

export function startProspectingScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tickProspectingScheduler().catch((error) => logger.warn('调度检查失败', error instanceof Error ? error.message : String(error)));
  }, 60_000);
  timer.unref?.();
}

export function stopProspectingScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
