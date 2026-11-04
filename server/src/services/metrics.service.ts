/**
 * Small dependency-free Prometheus-compatible metrics registry.
 *
 * Request labels use the matched Express route rather than the raw URL to
 * keep cardinality bounded (customer IDs, tokens and query strings never
 * become labels).
 */
import type { Request, Response, NextFunction } from 'express';

type Labels = Record<string, string>;

interface Counter {
  name: string;
  help: string;
  values: Map<string, number>;
}

interface Histogram {
  name: string;
  help: string;
  count: number;
  sum: number;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

function labelKey(labels: Labels): string {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
}

export function incrementCounter(name: string, help: string, labels: Labels = {}, value = 1): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = { name, help, values: new Map() };
    counters.set(name, counter);
  }
  const key = labelKey(labels);
  counter.values.set(key, (counter.values.get(key) ?? 0) + value);
}

export function observeHistogram(name: string, help: string, value: number): void {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = { name, help, count: 0, sum: 0 };
    histograms.set(name, histogram);
  }
  histogram.count += 1;
  histogram.sum += value;
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const counter of counters.values()) {
    lines.push(`# HELP ${counter.name} ${counter.help}`, `# TYPE ${counter.name} counter`);
    for (const [labels, value] of counter.values) lines.push(`${counter.name}${labels ? `{${labels}}` : ''} ${value}`);
  }
  for (const histogram of histograms.values()) {
    lines.push(`# HELP ${histogram.name} ${histogram.help}`, `# TYPE ${histogram.name} summary`);
    lines.push(`${histogram.name}_sum ${histogram.sum}`, `${histogram.name}_count ${histogram.count}`);
  }
  lines.push('# HELP crm_process_uptime_seconds Process uptime', '# TYPE crm_process_uptime_seconds gauge', `crm_process_uptime_seconds ${process.uptime()}`);
  lines.push('# HELP crm_process_resident_memory_bytes Resident memory', '# TYPE crm_process_resident_memory_bytes gauge', `crm_process_resident_memory_bytes ${process.memoryUsage().rss}`);
  return `${lines.join('\n')}\n`;
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - started) / 1e9;
    // Never use the raw URL as a label: it can contain IDs, tokens and other
    // unbounded values. Unmatched requests are aggregated under one label.
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const method = req.method;
    const status = String(res.statusCode);
    incrementCounter('crm_http_requests_total', 'HTTP requests processed', { method, status });
    incrementCounter('crm_http_route_requests_total', 'HTTP requests by matched route', { method, route, status });
    observeHistogram('crm_http_request_duration_seconds', 'HTTP request duration in seconds', duration);
  });
  next();
}

/** Public package export used by the error handler. */
export function recordErrorMetric(errorType: string): void {
  incrementCounter('crm_errors_total', 'Application errors', { type: errorType });
}
