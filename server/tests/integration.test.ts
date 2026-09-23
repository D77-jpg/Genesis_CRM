/**
 * Integration API v1 契约 / 集成测试
 * ------------------------------------------------------------------
 * 运行：npm run test:integration（server/ 目录）
 *
 * 覆盖验收点（阶段 2 Wave B/C 前置）：
 *  - 无 token / 错 token → 401 UNAUTHORIZED
 *  - 缺 scope → 403 FORBIDDEN_SCOPE
 *  - 未绑定项目 / 缺 X-Project-Id → 404 PROJECT_MISMATCH / 400
 *  - upsert 幂等：同 Idempotency-Key 重放返回相同结果；同键不同载荷 409 CONFLICT
 *  - upsert 业务幂等：同 (project, sourceSystem, externalId) 重复投递只产生 1 个客户
 *  - 邮箱辅助判重：已存在邮箱客户被 linked 而非报错
 *  - 并发 10 次投递只产生 1 个客户
 *  - 组织 A 的凭证不能写项目 B
 *  - outcomes 游标回流 won/lost 事件，按 eventId 可幂等消费
 *  - schemaVersion 不符 → 400 UNSUPPORTED_CONTRACT_VERSION
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';

// env 校验在模块加载时执行，必须在 import app 之前设置
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret-key-0123456789';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'integration-test-admin';
process.env.NODE_ENV = 'test';

let memory: MongoMemoryServer;
let mongoose: typeof import('mongoose');
let server: Server;
let baseUrl: string;

let Project: typeof import('../src/models').Project;
let Customer: typeof import('../src/models').Customer;
let CustomerEvent: typeof import('../src/models').CustomerEvent;
let IntegrationRequestLog: typeof import('../src/models').IntegrationRequestLog;
let createCredential: typeof import('../src/services/integration-credential.service').createCredential;

let projectA: { _id: unknown };
let projectB: { _id: unknown };
let tokenA = '';
let tokenLimited = ''; // 只有 stats:read

const ALL_SCOPES = ['customers:upsert', 'outcomes:read', 'stats:read', 'quotations:read'];

function authHeaders(token: string, projectId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-Project-Id': projectId,
    'Content-Type': 'application/json',
  };
}

async function api(
  method: string,
  path: string,
  options: { token?: string; projectId?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token && options.projectId) {
    Object.assign(headers, authHeaders(options.token, options.projectId));
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function sampleUpsert(externalId: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    sourceSystem: 'autoforce',
    externalId,
    name: 'Jane Miller',
    company: 'Sunrise Retail GmbH',
    email: `${externalId.replace(/[^a-z0-9]/gi, '')}@example.com`,
    country: 'Germany',
    interestedProducts: 'canvas tote bags',
    leadSource: 'AutoForceAI / Website AI Chat',
    tags: ['autoforce', 'channel:website-ai-chat'],
    ...overrides,
  };
}

before(async () => {
  memory = await MongoMemoryServer.create();
  mongoose = await import('mongoose');
  await mongoose.default.connect(memory.getUri(), { dbName: 'integration-tests' });

  const models = await import('../src/models');
  Project = models.Project;
  Customer = models.Customer;
  CustomerEvent = models.CustomerEvent;
  IntegrationRequestLog = models.IntegrationRequestLog;
  ({ createCredential } = await import('../src/services/integration-credential.service'));

  projectA = await Project.create({
    name: '项目 A',
    slug: 'project-a',
    code: 'PA',
    companyName: 'Company A',
    mailProfileKey: 'default',
  });
  projectB = await Project.create({
    name: '项目 B',
    slug: 'project-b',
    code: 'PB',
    companyName: 'Company B',
    mailProfileKey: 'default',
  });

  await Customer.init();
  await CustomerEvent.init();
  await models.IntegrationCredential.init();
  await models.IntegrationIdempotency.init();

  ({ token: tokenA } = await createCredential({
    name: 'AutoForceAI 测试凭证',
    projectIds: [String(projectA._id)],
    scopes: ALL_SCOPES,
  }));
  ({ token: tokenLimited } = await createCredential({
    name: '只读统计凭证',
    projectIds: [String(projectA._id)],
    scopes: ['stats:read'],
  }));

  const { createApp } = await import('../src/app');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/integrations/v1`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.default.disconnect();
  await memory.stop();
});

const pid = () => String(projectA._id);
const pidB = () => String(projectB._id);

test('health：无 token → 401 UNAUTHORIZED', async () => {
  const res = await fetch(`${baseUrl}/health`, { headers: { 'X-Project-Id': pid() } });
  assert.equal(res.status, 401);
  const json = (await res.json()) as { error: { code: string } };
  assert.equal(json.error.code, 'UNAUTHORIZED');
});

test('health：错 token → 401 UNAUTHORIZED', async () => {
  const res = await api('GET', '/health', { token: 'gci_deadbeef', projectId: pid() });
  assert.equal(res.status, 401);
  assert.equal((res.json.error as { code: string }).code, 'UNAUTHORIZED');
});

test('health：缺 X-Project-Id → 400；未绑定项目 → 404 PROJECT_MISMATCH', async () => {
  const noHeader = await fetch(`${baseUrl}/health`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(noHeader.status, 400);

  const wrongProject = await api('GET', '/health', { token: tokenA, projectId: pidB() });
  assert.equal(wrongProject.status, 404);
  assert.equal((wrongProject.json.error as { code: string }).code, 'PROJECT_MISMATCH');
});

test('health：正确凭证返回契约版本、项目与 scope', async () => {
  const res = await api('GET', '/health', { token: tokenA, projectId: pid() });
  assert.equal(res.status, 200);
  const data = res.json.data as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.contractVersion, '1.0');
  assert.equal(data.projectId, pid());
  assert.equal(data.projectName, '项目 A');
  assert.deepEqual(data.scopes, ALL_SCOPES);
});

test('scope 守卫：只有 stats:read 的凭证调用 upsert → 403 FORBIDDEN_SCOPE', async () => {
  const res = await api('POST', '/customers/upsert', {
    token: tokenLimited,
    projectId: pid(),
    body: sampleUpsert('lead:scope-test'),
    headers: { 'Idempotency-Key': 'scope-test-1' },
  });
  assert.equal(res.status, 403);
  assert.equal((res.json.error as { code: string }).code, 'FORBIDDEN_SCOPE');
});

test('upsert：缺 Idempotency-Key → 400；schemaVersion 不符 → UNSUPPORTED_CONTRACT_VERSION', async () => {
  const noKey = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pid(),
    body: sampleUpsert('lead:no-key'),
  });
  assert.equal(noKey.status, 400);

  const badVersion = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pid(),
    body: sampleUpsert('lead:bad-version', { schemaVersion: '2.0' }),
    headers: { 'Idempotency-Key': 'bad-version-1' },
  });
  assert.equal(badVersion.status, 400);
  assert.equal((badVersion.json.error as { code: string }).code, 'UNSUPPORTED_CONTRACT_VERSION');
});

test('upsert：创建 → 重复投递（业务幂等）→ 幂等键重放 / 冲突', async () => {
  const body = sampleUpsert('lead:100');

  const created = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pid(),
    body,
    headers: { 'Idempotency-Key': 'lead-100-v1' },
  });
  assert.equal(created.status, 201);
  const createdData = created.json.data as Record<string, unknown>;
  assert.equal(createdData.action, 'created');

  // 相同幂等键 + 相同载荷 → 重放首次响应（201 + created）
  const replay = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pid(),
    body,
    headers: { 'Idempotency-Key': 'lead-100-v1' },
  });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.json.data, created.json.data);

  // 相同幂等键 + 不同载荷 → 409 CONFLICT
  const conflict = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pid(),
    body: sampleUpsert('lead:100', { name: 'Someone Else' }),
    headers: { 'Idempotency-Key': 'lead-100-v1' },
  });
  assert.equal(conflict.status, 409);
  assert.equal((conflict.json.error as { code: string }).code, 'CONFLICT');

  // 新幂等键 + 相同 externalId → 业务幂等 unchanged，不产生新客户
  const dup = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pid(),
    body: sampleUpsert('lead:100', { phone: '+49 30 999999' }),
    headers: { 'Idempotency-Key': 'lead-100-v2' },
  });
  assert.equal(dup.status, 200);
  assert.equal((dup.json.data as { action: string }).action, 'unchanged');

  const count = await Customer.countDocuments({
    projectId: projectA._id,
    externalSystem: 'autoforce',
    externalId: 'lead:100',
  });
  assert.equal(count, 1);

  // 补齐空字段但不覆盖已有字段
  const customer = await Customer.findOne({ projectId: projectA._id, externalId: 'lead:100' });
  assert.equal(customer?.phone, '+49 30 999999'); // 空字段被补齐
  assert.equal(customer?.name, 'Jane Miller'); // 已有字段不被覆盖
});

test('upsert：并发 10 次投递同一线索只产生 1 个客户', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      api('POST', '/customers/upsert', {
        token: tokenA,
        projectId: pid(),
        body: sampleUpsert('lead:concurrent'),
        headers: { 'Idempotency-Key': `lead-concurrent-${i}` },
      }),
    ),
  );
  for (const res of results) {
    assert.ok([200, 201].includes(res.status), `unexpected status ${res.status}`);
  }
  const count = await Customer.countDocuments({
    projectId: projectA._id,
    externalSystem: 'autoforce',
    externalId: 'lead:concurrent',
  });
  assert.equal(count, 1);
  assert.ok(results.some((r) => (r.json.data as { action: string }).action === 'created'));
});

test('upsert：邮箱已存在的 CRM 原生客户被 linked，且不覆盖人工字段', async () => {
  const manual = await Customer.create({
    projectId: projectB._id, // 注意：邮箱判重只在同项目内生效，这里用 B 项目隔离干扰
    name: 'Existing Buyer',
    email: 'buyer@existing.com',
    status: 'negotiating',
    source: 'manual',
  });

  const res = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pid(), // 项目 A：同邮箱不存在 → created
    body: sampleUpsert('lead:link-a', { email: 'buyer@existing.com' }),
    headers: { 'Idempotency-Key': 'lead-link-a' },
  });
  assert.equal(res.status, 201);
  assert.equal((res.json.data as { action: string }).action, 'created');

  // 给项目 A 的凭证换成绑定 B 项目来验证 linked 路径
  const { token: tokenB } = await createCredential({
    name: 'B 项目凭证',
    projectIds: [String(projectB._id)],
    scopes: ALL_SCOPES,
  });
  const linked = await api('POST', '/customers/upsert', {
    token: tokenB,
    projectId: pidB(),
    body: sampleUpsert('lead:link-b', { email: 'buyer@existing.com', company: 'New Co' }),
    headers: { 'Idempotency-Key': 'lead-link-b' },
  });
  assert.equal(linked.status, 200);
  const linkedData = linked.json.data as { action: string; customerId: string };
  assert.equal(linkedData.action, 'linked');
  assert.equal(linkedData.customerId, String(manual._id));

  const after = await Customer.findById(manual._id);
  assert.equal(after?.status, 'negotiating'); // 人工状态不被覆盖
  assert.equal(after?.externalId, 'lead:link-b');
  assert.equal(after?.company, 'New Co'); // 空字段补齐
});

test('项目隔离：项目 A 的凭证不能读写项目 B', async () => {
  const writeB = await api('POST', '/customers/upsert', {
    token: tokenA,
    projectId: pidB(),
    body: sampleUpsert('lead:cross-project'),
    headers: { 'Idempotency-Key': 'cross-project-1' },
  });
  assert.equal(writeB.status, 404);
  assert.equal((writeB.json.error as { code: string }).code, 'PROJECT_MISMATCH');

  const statsB = await api('GET', '/stats/overview', { token: tokenA, projectId: pidB() });
  assert.equal(statsB.status, 404);
});

test('stats/overview：返回 8 段漏斗与报价摘要', async () => {
  const res = await api('GET', '/stats/overview', { token: tokenLimited, projectId: pid() });
  assert.equal(res.status, 200);
  const data = res.json.data as {
    totalCustomers: number;
    funnel: { status: string; count: number }[];
    quotations: unknown[];
  };
  assert.equal(data.funnel.length, 8);
  assert.ok(data.totalCustomers >= 2);
  assert.ok(Array.isArray(data.quotations));
});

test('outcomes：游标回流 won/lost 事件且增量推进', async () => {
  const customer = await Customer.findOne({ projectId: projectA._id, externalId: 'lead:100' });
  assert.ok(customer);

  await CustomerEvent.create([
    { projectId: projectA._id, customerId: customer!._id, type: 'status_changed', at: new Date('2026-09-01T00:00:00Z'), fromStatus: 'pending', toStatus: 'contacted' },
    { projectId: projectA._id, customerId: customer!._id, type: 'status_changed', at: new Date('2026-09-02T00:00:00Z'), fromStatus: 'negotiating', toStatus: 'won' },
    { projectId: projectA._id, customerId: customer!._id, type: 'followup_scheduled', at: new Date('2026-09-03T00:00:00Z') },
  ]);

  const first = await api('GET', '/outcomes?limit=10', { token: tokenA, projectId: pid() });
  assert.equal(first.status, 200);
  const feed = first.json.data as {
    items: { eventId: string; toStatus: string; externalId: string | null }[];
    nextCursor: string | null;
  };
  // 只有 won/lost 进入 feed；contacted / followup_scheduled 不出现
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].toStatus, 'won');
  assert.equal(feed.items[0].externalId, 'lead:100');
  assert.ok(feed.nextCursor);

  // 用 cursor 继续：无新事件 → 空
  const second = await api('GET', `/outcomes?cursor=${encodeURIComponent(feed.nextCursor!)}`, {
    token: tokenA,
    projectId: pid(),
  });
  assert.equal((second.json.data as { items: unknown[] }).items.length, 0);

  // 新增 lost 事件后，从 cursor 能取到
  await CustomerEvent.create({
    projectId: projectA._id,
    customerId: customer!._id,
    type: 'status_changed',
    at: new Date('2026-09-04T00:00:00Z'),
    fromStatus: 'won',
    toStatus: 'lost',
  });
  const third = await api('GET', `/outcomes?cursor=${encodeURIComponent(feed.nextCursor!)}`, {
    token: tokenA,
    projectId: pid(),
  });
  const items3 = (third.json.data as { items: { toStatus: string }[] }).items;
  assert.equal(items3.length, 1);
  assert.equal(items3[0].toStatus, 'lost');

  // 非法 cursor → 400
  const bad = await api('GET', '/outcomes?cursor=not-a-cursor', { token: tokenA, projectId: pid() });
  assert.equal(bad.status, 400);
});

test('审计日志：请求被记录且不含敏感内容', async () => {
  const logs = await IntegrationRequestLog.find({ route: '/api/integrations/v1/health' }).lean();
  assert.ok(logs.length >= 3);
  for (const log of logs) {
    assert.ok(log.requestId);
    assert.ok(typeof log.latencyMs === 'number');
    const raw = JSON.stringify(log);
    assert.ok(!raw.includes(tokenA), '审计日志不得包含 token');
  }
  // 错误请求也记录了错误码
  const denied = await IntegrationRequestLog.findOne({ statusCode: 401 }).lean();
  assert.ok(denied);
});
