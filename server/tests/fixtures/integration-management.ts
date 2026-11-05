import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';

export async function credentialFixture() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'fictional-c2-fixture-signing-value-0123456789';
  process.env.ADMIN_PASSWORD = 'fictional-c2-admin';
  process.env.API_RATE_LIMIT_MAX = '10000';
  const memory = await MongoMemoryServer.create();
  const db = await import('mongoose');
  await db.default.connect(memory.getUri(), { dbName: 'fictional_c2_tests' });
  const models = await import('../../src/models');
  const tenant = await import('../../src/models/tenant-context');
  const service = await import('../../src/services/integration-credential.service');
  const { signToken } = await import('../../src/services/auth.service');
  const orgA = await models.Organization.create({ name: 'FICTIONAL C2 A', slug: 'c2-a', plan: 'starter', limits: { integrationCredentialsPerProject: 3 } });
  const orgB = await models.Organization.create({ name: 'FICTIONAL C2 B', slug: 'c2-b', plan: 'growth' });
  const mkProject = async (code: string, org: typeof orgA) => models.Project.create({ name: 'FICTIONAL ' + code, slug: code.toLowerCase(), code,
    companyName: 'FICTIONAL Company', organizationId: org._id, mailProfileKey: 'default', onboardingCompletedAt: new Date() });
  const a = await mkProject('C2A', orgA), c = await mkProject('C2C', orgA), b = await mkProject('C2B', orgB);
  async function mkUser(role: 'admin' | 'project_admin' | 'user' | 'viewer', name: string, org = orgA, project = a) {
    const user = await models.User.create({ username: 'fictional-c2-' + name, displayName: 'FICTIONAL ' + name,
      passwordHash: 'fictional-c2-password', role, organizationId: org._id, projectIds: [project._id], defaultProjectId: project._id });
    const signed = signToken({ id: String(user._id), username: user.username, displayName: user.displayName, role });
    return { user, token: signed.token };
  }
  const actors = { manager: await mkUser('project_admin', 'manager'), admin: await mkUser('admin', 'admin'),
    sales: await mkUser('user', 'sales'), viewer: await mkUser('viewer', 'viewer'), foreign: await mkUser('admin', 'foreign', orgB, b) };
  await Promise.all([models.IntegrationCredential.init(), models.AuditLog.init(), models.IntegrationRequestLog.init()]);
  const { createApp } = await import('../../src/app');
  const app = createApp();
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = (role: keyof typeof actors = 'manager', projectId = String(a._id)) => ({ Authorization: 'Bearer ' + actors[role].token, 'X-Project-Id': projectId, 'Content-Type': 'application/json' });
  const request = async (path: string, options: { method?: string; body?: unknown; role?: keyof typeof actors; project?: string; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + '/api/projects/integrations' + path, { method: options.method ?? 'GET', headers: { ...headers(options.role, options.project), ...options.headers },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
    return { status: res.status, headers: res.headers, body: await res.json() as any };
  };
  return { memory, db, models, tenant, service, orgA, orgB, a, b, c, actors, server, app, base, request, headers,
    async cleanup() { await new Promise<void>(resolve => server.close(() => resolve())); await db.default.disconnect(); await memory.stop(); } };
}
