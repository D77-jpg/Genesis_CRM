/**
 * Structured error capture. This is intentionally provider-neutral: the
 * bounded in-process ring can be scraped by an operator, while the counters
 * are exported through /api/metrics. Swap `captureError` for Sentry/OTel
 * without touching the error middleware.
 */
import { createLogger } from '../config/logger';
import { recordErrorMetric } from './metrics.service';

const logger = createLogger('error-monitor');
const MAX_RECENT = 100;

export interface CapturedError {
  at: string;
  name: string;
  code?: string;
  status: number;
  method?: string;
  route?: string;
  message: string;
  stack?: string;
}

const recent: CapturedError[] = [];

function sanitize(value: string): string {
  return value
    .replace(/((?:password|passwd|secret|token|authorization|cookie))\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .slice(0, 2000);
}

export function captureError(error: unknown, context: { status?: number; method?: string; route?: string } = {}): CapturedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const code = (err as Error & { code?: string }).code;
  const item: CapturedError = {
    at: new Date().toISOString(),
    name: err.name || 'Error',
    ...(code ? { code } : {}),
    status: context.status ?? 500,
    ...(context.method ? { method: context.method } : {}),
    ...(context.route ? { route: context.route } : {}),
    message: sanitize(err.message),
    ...(err.stack ? { stack: sanitize(err.stack) } : {}),
  };
  recent.push(item);
  if (recent.length > MAX_RECENT) recent.shift();
  recordErrorMetric(item.code || item.name);
  logger.error('未处理请求错误', { status: item.status, code: item.code, route: item.route });
  return item;
}

export function recentErrors(): CapturedError[] {
  return [...recent].reverse();
}
