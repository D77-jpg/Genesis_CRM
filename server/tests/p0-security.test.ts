import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'p0-security-fixture-jwt-secret-0123456789abcdef';
process.env.ADMIN_PASSWORD ||= 'P0-Fixture-Admin-Passw0rd!';

let memory: MongoMemoryServer;
let User: typeof import('../src/models').User;
let AuditLog: typeof import('../src/models').AuditLog;
let hashPassword: typeof import('../src/models').hashPassword;
let login: typeof import('../src/services/auth.service').login;
let recordAudit: typeof import('../src/services/audit.service').recordAudit;
let listAuditLogs: typeof import('../src/services/audit.service').listAuditLogs;
let createUserSchema: typeof import('../src/validators/user.validator').createUserSchema;
let resetPasswordSchema: typeof import('../src/validators/user.validator').resetPasswordSchema;

before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('p0_security_fixture'));
  ({ User, AuditLog, hashPassword } = await import('../src/models'));
  ({ login } = await import('../src/services/auth.service'));
  ({ recordAudit, listAuditLogs } = await import('../src/services/audit.service'));
  ({ createUserSchema, resetPasswordSchema } = await import('../src/validators/user.validator'));
});

after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await AuditLog.deleteMany({});
});

test('new users default to the non-admin role', async () => {
  const user = await User.create({ username: 'default-role-user', passwordHash: 'fixture-hash' });
  assert.equal(user.role, 'user');
});

test('password policy rejects short and common passwords and accepts a strong one', () => {
  const base = { username: 'new-sales-user', role: 'user' as const, projectIds: [] };
  assert.equal(createUserSchema.safeParse({ ...base, password: 'short1!' }).success, false);
  assert.equal(createUserSchema.safeParse({ ...base, password: 'password123!A' }).success, false);
  assert.equal(createUserSchema.safeParse({ ...base, password: 'P0-Secure-Passw0rd!' }).success, true);
  assert.equal(resetPasswordSchema.safeParse({ password: 'P0-Secure-Passw0rd!' }).success, true);
  assert.equal(resetPasswordSchema.safeParse({ password: 'weakpass' }).success, false);
});

test('five failed logins lock the account, and a successful login after expiry resets the counter', async () => {
  const password = 'P0-Secure-Passw0rd!';
  await User.create({ username: 'lockout-user', passwordHash: await hashPassword(password), role: 'user' });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      login('lockout-user', 'Wrong-Passw0rd!'),
      (error: { statusCode: number }) => error.statusCode === 401,
    );
  }
  await assert.rejects(
    login('lockout-user', 'Wrong-Passw0rd!'),
    (error: { statusCode: number }) => error.statusCode === 429,
  );

  const locked = await User.findOne({ username: 'lockout-user' }).select('+failedLoginAttempts +lockedUntil');
  assert.equal(locked?.failedLoginAttempts, 5);
  assert.ok(locked?.lockedUntil instanceof Date);

  await assert.rejects(
    login('lockout-user', password),
    (error: { statusCode: number }) => error.statusCode === 429,
  );

  await User.updateOne({ username: 'lockout-user' }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  const result = await login('lockout-user', password);
  assert.ok(result.token);

  const reset = await User.findOne({ username: 'lockout-user' }).select('+failedLoginAttempts +lockedUntil');
  assert.equal(reset?.failedLoginAttempts, 0);
  assert.equal(reset?.lockedUntil, undefined);
});

test('audit records preserve actor/action and can be queried by administrators', async () => {
  const actorId = new Types.ObjectId().toString();
  await recordAudit({
    actor: { id: actorId, username: 'audit-admin', role: 'admin' },
    action: 'user.create',
    targetType: 'user',
    targetId: 'target-user-id',
    detail: { role: 'user' },
  });

  const record = await AuditLog.findOne({ action: 'user.create' }).lean();
  assert.equal(record?.success, true);
  assert.equal(record?.actorUsername, 'audit-admin');
  assert.equal(record?.targetId, 'target-user-id');

  const page = await listAuditLogs({ page: 1, limit: 20, action: 'user.create' });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.actorId, actorId);
  assert.deepEqual(page.items[0]?.detail, { role: 'user' });
});
