import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.MAIL_CHANNEL = 'mock';
process.env.JWT_SECRET ||= 'x'.repeat(40);
process.env.ADMIN_PASSWORD ||= 'x'.repeat(20);

let createApp: typeof import('../src/app').createApp;
let beginShutdown: () => void;
let resetLifecycleForTests: () => void;
let memory: MongoMemoryServer;let server: Server;
let base = '';

async function json(path: string) {
  const response = await fetch(base + path);
  return { status: response.status, headers: response.headers, body: await response.json() as { success: boolean; data: Record<string, unknown> } };
}

before(async () => {
  ({ createApp } = await import('../src/app'));
  ({ beginShutdown, resetLifecycleForTests } = await import('../src/services/runtime-state'));
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('d_health_fictional'));
  server = createServer(createApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no test port');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  resetLifecycleForTests();
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

test('D 01 liveness stays up without authentication and does not expose internals', async () => {
  const result = await json('/api/health/live');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.status, 'ok');
  assert.equal(result.headers.get('x-powered-by'), null);
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  const text = JSON.stringify(result.body);
  assert.doesNotMatch(text, /MONGODB_URI|mongodb:\/\//);
});

test('D 02 health actively pings Mongo and reports only fixed status fields', async () => {
  const result = await json('/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.status, 'ok');
  assert.equal((result.body.data.checks as { database: { ok: boolean } }).database.ok, true);
  assert.equal(typeof (result.body.data.process as { rssMiB: number }).rssMiB, 'number');
  const text = JSON.stringify(result.body);
  for (const secret of ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_PASSWORD', 'mongodb://', 'node_modules', 'C:\\']) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test('D 03 readiness returns 200 when Mongo is reachable', async () => {
  const result = await json('/api/health/ready');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.status, 'ok');
  assert.deepEqual(result.body.data.checks, { database: 'ok', draining: false });
});

test('D 04 draining makes readiness fail while liveness remains live', async () => {
  beginShutdown();
  try {
    const ready = await json('/api/health/ready');
    assert.equal(ready.status, 503);
    assert.equal(ready.body.data.status, 'not_ready');
    assert.deepEqual(ready.body.data.checks, { database: 'ok', draining: true });
    const live = await json('/api/health/live');
    assert.equal(live.status, 200);
  } finally {
    resetLifecycleForTests();
  }
});

test('D 05 Mongo loss fails legacy health and readiness with 503, without leaking the reason', async () => {
  await mongoose.disconnect();
  const health = await json('/api/health');
  assert.equal(health.status, 503);
  assert.equal((health.body.data.checks as { database: { ok: boolean } }).database.ok, false);
  const ready = await json('/api/health/ready');
  assert.equal(ready.status, 503);
  assert.deepEqual(ready.body.data.checks, { database: 'unavailable', draining: false });
  assert.doesNotMatch(JSON.stringify(ready.body), /ECONN|MongoNetworkError|127\.0\.0\.1/);
});
