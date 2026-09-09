/**
 * 轻量级结构化日志
 * ------------------------------------------------------------------
 * 生产环境可直接替换为 pino / winston，调用方 API 保持不变。
 */
import env from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = env.isProd ? 'info' : 'debug';

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel as Level];
}

function ts(): string {
  return new Date().toISOString();
}

function write(level: Level, scope: string, message: string, meta?: unknown): void {
  if (!shouldLog(level)) return;
  const prefix = `[${ts()}] [${level.toUpperCase()}] [${scope}]`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) {
    out(prefix, message, meta);
  } else {
    out(prefix, message);
  }
}

export const createLogger = (scope: string) => ({
  debug: (msg: string, meta?: unknown) => write('debug', scope, msg, meta),
  info: (msg: string, meta?: unknown) => write('info', scope, msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', scope, msg, meta),
  error: (msg: string, meta?: unknown) => write('error', scope, msg, meta),
});

export const logger = createLogger('app');
export default logger;
