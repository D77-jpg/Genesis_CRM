/**
 * P3 load / soak probe.
 *
 * This intentionally uses read-only endpoints so it is safe against a seeded
 * staging environment. Run against an isolated environment with a raised
 * API_RATE_LIMIT_MAX; never point the default 600/min limiter at a stress test.
 *
 *   LOAD_BASE_URL=http://127.0.0.1:5001/api \
 *   LOAD_USERNAME=admin LOAD_PASSWORD=... LOAD_DURATION_SECONDS=60 LOAD_CONCURRENCY=20 \
 *   node --import tsx scripts/load-test.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';

const base = (process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:5001/api').replace(/\/+$/, '');
const username = process.env.LOAD_USERNAME ?? process.env.ADMIN_USERNAME ?? 'admin';
const password = process.env.LOAD_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 30);
const concurrency = Math.max(1, Math.min(200, Number(process.env.LOAD_CONCURRENCY ?? 10)));
const warmupSeconds = Math.max(0, Number(process.env.LOAD_WARMUP_SECONDS ?? 2));
const p95BudgetMs = Number(process.env.LOAD_P95_BUDGET_MS ?? 1000);
const errorBudget = Number(process.env.LOAD_ERROR_BUDGET ?? 0.01);
const reportPath = process.env.LOAD_REPORT_PATH;

if (!password) throw new Error('LOAD_PASSWORD or ADMIN_PASSWORD is required');
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('LOAD_DURATION_SECONDS must be positive');

function cookiesFrom(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = response.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
}

function mergeCookies(response: Response, previous: Record<string, string> = {}): Record<string, string> {
  const jar = { ...previous };
  for (const cookie of cookiesFrom(response)) {
    const pair = cookie.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return jar;
}

async function login(): Promise<Record<string, string>> {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
  const jar = mergeCookies(response);
  if (!jar.cdlm_access) throw new Error('login did not issue an access cookie');
  return jar;
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

async function main(): Promise<void> {
  let jar = await login();
  const headers: Record<string, string> = { cookie: cookieHeader(jar) };
  let refreshPromise: Promise<void> | null = null;
  const refreshSession = async (): Promise<void> => {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const response = await fetch(`${base}/auth/refresh`, {
          method: 'POST',
          headers: { cookie: cookieHeader(jar), 'x-csrf-token': jar.cdlm_csrf ?? '' },
        });
        if (!response.ok) throw new Error(`session refresh failed: HTTP ${response.status}`);
        jar = mergeCookies(response, jar);
        headers.cookie = cookieHeader(jar);
      })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  };
  const me = await fetch(`${base}/auth/me`, { headers });
  if (!me.ok) throw new Error(`auth/me failed: HTTP ${me.status}`);
  const projects = await fetch(`${base}/projects`, { headers });
  const projectsJson = await projects.json() as { data?: Array<{ id: string }> | { items?: Array<{ id: string }>; projects?: Array<{ id: string }> } };
  const projectId = Array.isArray(projectsJson.data)
    ? projectsJson.data[0]?.id
    : projectsJson.data?.items?.[0]?.id ?? projectsJson.data?.projects?.[0]?.id;
  if (projectId) headers['x-project-id'] = projectId;

  const healthBefore = await fetch(`${base}/health`).then((res) => res.json()).catch(() => null);
  const targets = ['/health', '/meta', '/customers?page=1&limit=20'];
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  let total = 0;
  let errors = 0;
  let nextTarget = 0;
  let stop = false;
  let endAt = 0;

  const worker = async (): Promise<void> => {
    while (!stop && performance.now() < endAt) {
      const target = targets[nextTarget++ % targets.length];
      const started = performance.now();
      let status = 0;
      try {
        let response = await fetch(`${base}${target}`, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 401) {
          // Access cookies are short-lived; keep a long soak running by rotating
          // the refresh token once, then retrying the read.
          await refreshSession();
          response = await fetch(`${base}${target}`, {
            headers,
            signal: AbortSignal.timeout(15_000),
          });
        }
        status = response.status;
        await response.arrayBuffer();
      } catch {
        status = 0;
      }
      const elapsed = performance.now() - started;
      total += 1;
      latencies.push(elapsed);
      statuses[String(status)] = (statuses[String(status)] ?? 0) + 1;
      if (status === 0 || status >= 400) errors += 1;
    }
  };

  if (warmupSeconds) {
    const warmupEnd = performance.now() + warmupSeconds * 1000;
    while (performance.now() < warmupEnd) {
      await fetch(`${base}/health`, { signal: AbortSignal.timeout(15000) }).catch(() => undefined);
    }
  }

  const startedAt = performance.now();
  endAt = startedAt + durationSeconds * 1000;
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  stop = true;
  const wallMs = performance.now() - startedAt;
  latencies.sort((a, b) => a - b);
  const healthAfter = await fetch(`${base}/health`).then((res) => res.json()).catch(() => null);
  const summary = {
    base,
    mode: process.env.LOAD_MODE ?? 'mixed-readonly',
    durationSeconds,
    concurrency,
    totalRequests: total,
    requestsPerSecond: Number((total / (wallMs / 1000)).toFixed(2)),
    errorRate: total ? Number((errors / total).toFixed(4)) : 0,
    latencyMs: {
      p50: Number(percentile(latencies, 0.5).toFixed(1)),
      p95: Number(percentile(latencies, 0.95).toFixed(1)),
      p99: Number(percentile(latencies, 0.99).toFixed(1)),
      max: Number((latencies.at(-1) ?? 0).toFixed(1)),
    },
    statuses,
    server: {
      healthBefore: healthBefore?.data?.process ?? null,
      healthAfter: healthAfter?.data?.process ?? null,
      memory: healthAfter?.data?.process ?? null,
    },
    thresholds: { p95BudgetMs, errorBudget },
    passed: errors / Math.max(1, total) <= errorBudget && percentile(latencies, 0.95) <= p95BudgetMs,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (reportPath) {
    const absolute = resolve(reportPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  if (!summary.passed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
