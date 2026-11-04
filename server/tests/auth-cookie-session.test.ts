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
let User: typeof import('../src/models').User;
let hashPassword: typeof import('../src/models').hashPassword;
let memory: MongoMemoryServer;
let server: Server;
let base = '';

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = response.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function cookieJar(response: Response, previous: Record<string, string> = {}): Record<string, string> {
  const jar = { ...previous };
  for (const cookie of setCookies(response)) {
    const pair = cookie.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return jar;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function post(path: string, jar: Record<string, string>, csrf?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    cookie: cookieHeader(jar),
  };
  if (csrf) headers['x-csrf-token'] = csrf;
  return fetch(base + path, { method: 'POST', headers, body: '{}' });
}

before(async () => {
  ({ createApp } = await import('../src/app'));
  ({ User, hashPassword } = await import('../src/models'));
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('d_cookie_fictional'));
  await User.create({
    username: 'cookie-user',
    passwordHash: await hashPassword('Strong-Passw0rd!'),
    displayName: 'Cookie User',
    role: 'admin',
  });
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no test port');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

test('browser login uses HttpOnly cookies and supports refresh rotation/logout revocation', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'cookie-user', password: 'Strong-Passw0rd!' }),
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json() as { data: { user: { username: string }; expiresAt: string } };
  assert.equal(loginBody.data.user.username, 'cookie-user');
  assert.equal('token' in loginBody.data, false);

  const cookies = setCookies(login);
  assert.equal(cookies.length, 3);
  assert.ok(cookies.some((value) => value.startsWith('cdlm_access=') && /HttpOnly/i.test(value)));
  assert.ok(cookies.some((value) => value.startsWith('cdlm_refresh=') && /HttpOnly/i.test(value)));
  assert.ok(cookies.some((value) => value.startsWith('cdlm_csrf=') && !/HttpOnly/i.test(value)));

  let jar = cookieJar(login);
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieHeader(jar) } });
  assert.equal(me.status, 200);

  // Cookie-authenticated mutations require the double-submit CSRF header.
  const noCsrf = await post('/api/auth/refresh', jar);
  assert.equal(noCsrf.status, 403);

  const protectedNoCsrf = await post('/api/projects', jar);
  assert.equal(protectedNoCsrf.status, 403);

  const oldRefresh = jar.cdlm_refresh;
  const refreshed = await post('/api/auth/refresh', jar, jar.cdlm_csrf);
  assert.equal(refreshed.status, 200);
  const refreshedBody = await refreshed.json() as { data: { user: { username: string } } };
  assert.equal(refreshedBody.data.user.username, 'cookie-user');
  const nextJar = cookieJar(refreshed, jar);
  assert.notEqual(nextJar.cdlm_refresh, oldRefresh);

  // The old refresh token is invalid after rotation.
  const replay = await post('/api/auth/refresh', jar, jar.cdlm_csrf);
  assert.equal(replay.status, 401);

  const logout = await post('/api/auth/logout', nextJar, nextJar.cdlm_csrf);
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: cookieHeader(nextJar) },
  });
  assert.equal(afterLogout.status, 401);
});
