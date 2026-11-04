import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'mock';
process.env.AI_PROVIDER = 'mock';
process.env.JWT_SECRET ||= 'y'.repeat(40);
process.env.ADMIN_PASSWORD ||= 'z'.repeat(20);

let createApp: typeof import('../src/app').createApp;
let User: typeof import('../src/models').User;
let hashPassword: typeof import('../src/models').hashPassword;
let createLoginTwoFactorChallenge: typeof import('../src/services/auth.service').createLoginTwoFactorChallenge;
let requestPasswordReset: typeof import('../src/services/password-reset.service').requestPasswordReset;
let memory: MongoMemoryServer;
let server: Server;
let base = '';

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = response.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function cookieHeader(response: Response): string {
  return setCookies(response).map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

async function postJson(path: string, body: Record<string, unknown>, cookie?: string): Promise<Response> {
  return fetch(base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  ({ createApp } = await import('../src/app'));
  ({ User, hashPassword } = await import('../src/models'));
  ({ createLoginTwoFactorChallenge } = await import('../src/services/auth.service'));
  ({ requestPasswordReset } = await import('../src/services/password-reset.service'));
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('d_email_auth_fictional'));
  await User.create({
    username: 'otp-user',
    passwordHash: await hashPassword('Strong-Passw0rd!'),
    displayName: 'OTP User',
    email: 'otp@example.test',
    twoFactorEnabled: true,
    role: 'admin',
  });
  await User.create({
    username: 'reset-user',
    passwordHash: await hashPassword('Strong-Passw0rd!'),
    displayName: 'Reset User',
    email: 'reset@example.test',
    role: 'user',
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

test('password login returns an email OTP challenge without issuing a session', async () => {
  const response = await postJson('/api/auth/login', {
    username: 'otp-user',
    password: 'Strong-Passw0rd!',
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    data: { twoFactorRequired: boolean; challengeId: string; emailHint: string };
  };
  assert.equal(body.data.twoFactorRequired, true);
  assert.match(body.data.challengeId, /^[a-f\d]{24}$/i);
  assert.equal(body.data.emailHint, 'o**@example.test');
  assert.equal(setCookies(response).length, 0);
});

test('email OTP verification issues cookies and rejects a wrong code', async () => {
  const user = await User.findOne({ username: 'otp-user' });
  assert.ok(user);
  const challenge = await createLoginTwoFactorChallenge({
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  });

  const wrong = await postJson('/api/auth/login/verify-2fa', {
    challengeId: challenge.challengeId,
    code: challenge.code === '000000' ? '000001' : '000000',
  });
  assert.equal(wrong.status, 400);

  const correct = await postJson('/api/auth/login/verify-2fa', {
    challengeId: challenge.challengeId,
    code: challenge.code,
  });
  assert.equal(correct.status, 200);
  assert.equal(setCookies(correct).length, 3);
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieHeader(correct) } });
  assert.equal(me.status, 200);
});

test('forgot-password issues a one-time reset token that changes the password', async () => {
  const token = await requestPasswordReset('reset-user');
  assert.ok(token && token.length >= 20);

  const reset = await postJson('/api/auth/reset-password', {
    token,
    password: 'New-Strong-Passw0rd!',
  });
  assert.equal(reset.status, 200);

  const oldLogin = await postJson('/api/auth/login', {
    username: 'reset-user',
    password: 'Strong-Passw0rd!',
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await postJson('/api/auth/login', {
    username: 'reset-user',
    password: 'New-Strong-Passw0rd!',
  });
  assert.equal(newLogin.status, 200);
  const body = await newLogin.json() as { data: { user: { username: string } } };
  assert.equal(body.data.user.username, 'reset-user');

  // The same reset token cannot be used twice.
  const replay = await postJson('/api/auth/reset-password', {
    token,
    password: 'Another-Strong-Passw0rd!',
  });
  assert.equal(replay.status, 400);
});
