/**
 * Standalone background worker process.
 *
 * The API process can run with RUN_BACKGROUND_JOBS=false in production; this
 * process owns mail queue, inbox sync, prospecting, outreach, agent and
 * knowledge workers so HTTP latency is never coupled to long jobs.
 */
import http from 'node:http';
import mongoose from 'mongoose';
import env from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';
import { createLogger } from './config/logger';
import { assertMigrationsApplied } from './migrations';
import { startBackgroundJobs, stopBackgroundJobs } from './background/runtime';

const logger = createLogger('worker-bootstrap');

async function main(): Promise<void> {
  await connectDatabase();
  await assertMigrationsApplied();
  startBackgroundJobs();

  const health = http.createServer((req, res) => {
    if (req.url === '/health') {
      const ok = mongoose.connection.readyState === 1;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: ok, data: { worker: true, database: ok ? 'connected' : 'disconnected', pid: process.pid, uptime: process.uptime() } }));
      return;
    }
    res.writeHead(404).end();
  });
  health.listen(env.WORKER_HEALTH_PORT, env.HOST, () => {
    logger.info(`Worker 已启动，健康检查 http://localhost:${env.WORKER_HEALTH_PORT}/health`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Worker 收到 ${signal}，开始停机...`);
    stopBackgroundJobs();
    health.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Worker 未处理 Promise 拒绝', String(reason)));
}

void main().catch((error) => {
  logger.error('Worker 启动失败', error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
