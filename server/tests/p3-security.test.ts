/**
 * P3 internal security baseline. This is not a substitute for an independent
 * penetration test; it locks in the protections that are easy to regress:
 * headers, auth/CSRF enforcement, tenant isolation and cookie attributes.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.MAIL_TRANSPORT = 'mock';
process.env.JWT_SECRET ||= 'p3-security-fixture-jwt-secret-0123456789abcdef';
process.env.ADMIN_PASSWORD ||= 'p3-security-fixture-admin-password';
process.env.API_RATE_LIMIT_MAX = '100000';

let memory: MongoMemoryServer;
let server: Server;
let base = '';
let cookieJar: Record<string, string> = {};
let projectA = '';
let projectB = '';
let customerB = '';

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  return response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : [];
}

function mergeCookies(response: Response): void {
  for (const cookie of setCookies(response)) {
    const pair = cookie.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) cookieJar[pair.slice(0, index)] = pair.slice(index + 1);
  }
}

function cookieHeader(): string {
  return Object.entries(cookieJar).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const headers: Record<string, string> = { cookie: cookieHeader(), ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && cookieJar.cdlm_csrf && !headers['x-csrf-token']) headers['x-csrf-token'] = cookieJar.cdlm_csrf;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  mergeCookies(response);
  return response;
}

before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('p3_security_fixture'));
  const { createApp } = await import('../src/app');
  const models = await import('../src/models');
  const orgA = await models.Organization.create({ name: 'Security Org A', slug: 'security-org-a', plan: 'starter' });
  const orgB = await models.Organization.create({ name: 'Security Org B', slug: 'security-org-b', plan: 'starter' });
  const a = await models.Project.create({ organizationId: orgA._id, name: 'Security A', slug: 'security-a', code: 'SECA', companyName: 'A', mailProfileKey: 'default' });
  const b = await models.Project.create({ organizationId: orgB._id, name: 'Security B', slug: 'security-b', code: 'SECB', companyName: 'B', mailProfileKey: 'default' });
  projectA = String(a._id);
  projectB = String(b._id);
  const userA = await models.User.create({
    username: 'sec-a', passwordHash: await models.hashPassword('Sec-A-Str0ng-Pass!'), displayName: 'Sec A',
    role: 'admin', organizationId: orgA._id, projectIds: [a._id], defaultProjectId: a._id,
  });
  const userB = await models.User.create({
    username: 'sec-b', passwordHash: await models.hashPassword('Sec-B-Str0ng-Pass!'), displayName: 'Sec B',
    role: 'admin', organizationId: orgB._id, projectIds: [b._id], defaultProjectId: b._id,
  });
  const foreign = await models.Customer.create({
    organizationId: orgB._id, projectId: b._id, ownerId: userB._id,
    name: 'Tenant B Secret', company: 'Tenant B GmbH', email: 'secret@tenant-b.test', status: 'pending',
  });
  customerB = String(foreign._id);
  await Promise.all([models.Organization.init(), models.Project.init(), models.User.init(), models.Customer.init()]);
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('security fixture did not bind');
  base = `http://127.0.0.1:${address.port}/api`;
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: userA.username, password: 'Sec-A-Str0ng-Pass!' }),
  });
  assert.equal(login.status, 200);
  mergeCookies(login);
  assert.ok(cookieJar.cdlm_access);
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

test('security headers are present on the public health endpoint', async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('x-frame-options'), 'frame protection header');
  assert.ok(response.headers.get('referrer-policy'), 'referrer policy header');
  assert.equal(response.headers.get('access-control-allow-origin'), null, 'no wildcard CORS');
});

test('unauthenticated business requests are rejected', async () => {
  const response = await fetch(`${base}/customers`, { headers: { 'x-project-id': projectA } });
  assert.equal(response.status, 401);
});

test('mutations require CSRF and the access cookie uses safe attributes', async () => {
  const missingCsrf = await call('POST', '/customers/import', { customers: [{ name: 'No CSRF' }] }, { 'x-project-id': projectA, 'x-csrf-token': 'invalid-csrf' });
  assert.equal(missingCsrf.status, 403);

  const response = await call('GET', '/auth/me', undefined, { 'x-project-id': projectA });
  assert.equal(response.status, 200);
  const access = setCookies(await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'sec-a', password: 'Sec-A-Str0ng-Pass!' }),
  })).find((cookie) => cookie.startsWith('cdlm_access='));
  assert.ok(access, 'access cookie exists');
  assert.match(access!, /HttpOnly/i);
  assert.match(access!, /SameSite=(Lax|Strict)/i);
});

test('tenant data cannot be read or addressed through another project header', async () => {
  const list = await call('GET', '/customers?search=secret%40tenant-b.test&limit=20', undefined, { 'x-project-id': projectA });
  assert.equal(list.status, 200);
  const payload = await list.json() as { data?: { items?: Array<{ email?: string }> } };
  assert.equal(payload.data?.items?.length, 0, 'foreign customer is absent from list');

  const direct = await call('GET', `/customers/${customerB}`, undefined, { 'x-project-id': projectA });
  assert.equal(direct.status, 404, 'foreign customer is not addressable');

  const crossHeader = await call('GET', '/customers', undefined, { 'x-project-id': projectB });
  assert.ok([403, 404].includes(crossHeader.status), `cross-project header rejected (got ${crossHeader.status})`);
});

test('public plan catalog is reachable without authentication and contains no secrets', async () => {
  const response = await fetch(`${base}/public/plans`);
  assert.equal(response.status, 200);
  const payload = await response.json() as { data?: { plans?: Array<{ id: string; monthlyPriceUsd: number }> } };
  assert.ok(payload.data?.plans?.length === 3);
  assert.equal(JSON.stringify(payload).includes('password'), false);
});

test('invalid login is rejected without leaking a stack trace', async () => {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'sec-a', password: 'definitely-wrong' }),
  });
  assert.equal(response.status, 401);
  const text = await response.text();
  assert.equal(text.includes('stack'), false);
  assert.equal(text.includes('MongoServerError'), false);
});
