import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AuthUser } from '../src/types/express';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'p2-tenant-fixture-jwt-secret-0123456789abcdef';

let memory: MongoMemoryServer;
let models: typeof import('../src/models');
let tenant: typeof import('../src/models/tenant-context');
let orgService: typeof import('../src/services/organization.service');
let usage: typeof import('../src/services/usage.service');

function platformActor(): AuthUser {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    username: 'platform-fixture',
    displayName: 'Platform fixture',
    role: 'admin',
    isPlatformAdmin: true,
  };
}

before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('p2_tenant_fixture'));
  models = await import('../src/models');
  tenant = await import('../src/models/tenant-context');
  orgService = await import('../src/services/organization.service');
  usage = await import('../src/services/usage.service');
});

after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

beforeEach(async () => {
  await Promise.all([
    models.Organization.deleteMany({}),
    models.Project.deleteMany({}),
    models.User.deleteMany({}),
    models.UsageRecord.deleteMany({}),
    models.AgentAiSettings.deleteMany({}),
    models.AgentAiProvider.deleteMany({}),
    models.BillingInvoice.deleteMany({}),
  ]);
});

test('tenant plugin stamps and filters project documents', async () => {
  const orgA = await models.Organization.create({ name: 'Org A', slug: 'org-a', plan: 'starter', limits: { users: 5, projects: 2, monthlyEmails: 5000, monthlyAiTokens: 1000000, storageBytes: 5 * 1024 ** 3 }, subscriptionStatus: 'active' });
  const orgB = await models.Organization.create({ name: 'Org B', slug: 'org-b', plan: 'starter', limits: { users: 5, projects: 2, monthlyEmails: 5000, monthlyAiTokens: 1000000, storageBytes: 5 * 1024 ** 3 }, subscriptionStatus: 'active' });

  const projectA = await tenant.runWithTenant({ organizationId: String(orgA._id) }, async () => models.Project.create({
    name: 'Alpha', slug: 'alpha', code: 'ALPHA', companyName: 'Alpha Co', mailProfileKey: 'alpha',
  }));
  assert.equal(String(projectA.organizationId), String(orgA._id));

  const hidden = await tenant.runWithTenant({ organizationId: String(orgB._id) }, async () => models.Project.findById(projectA._id));
  assert.equal(hidden, null, 'another tenant must not see the project');

  const visible = await tenant.runWithTenant({ organizationId: String(orgA._id) }, async () => models.Project.findById(projectA._id));
  assert.ok(visible, 'the owning tenant can see the project');
});

test('legacy documents are backfilled into the default organization', async () => {
  const legacy = await models.Project.create({
    name: 'Legacy', slug: 'legacy', code: 'LEGACY', companyName: 'Legacy Co', mailProfileKey: 'legacy',
  });
  assert.equal(legacy.organizationId, undefined);
  await orgService.migrateLegacyTenantData();
  const migrated = await models.Project.findById(legacy._id);
  assert.ok(migrated?.organizationId, 'legacy project receives a tenant key');
  const defaultOrg = await models.Organization.findOne({ slug: orgService.DEFAULT_ORGANIZATION_SLUG });
  assert.equal(String(migrated?.organizationId), String(defaultOrg?._id));
});

test('usage records are isolated and quota checks fail closed', async () => {
  const orgA = await models.Organization.create({ name: 'Usage A', slug: 'usage-a', plan: 'starter', limits: { users: 1, projects: 1, monthlyEmails: 1, monthlyAiTokens: 10, storageBytes: 100 }, subscriptionStatus: 'active' });
  const orgB = await models.Organization.create({ name: 'Usage B', slug: 'usage-b', plan: 'starter', limits: { users: 1, projects: 1, monthlyEmails: 10, monthlyAiTokens: 10, storageBytes: 100 }, subscriptionStatus: 'active' });

  await usage.addUsage('emails', 1, String(orgA._id));
  assert.equal((await usage.getUsage(String(orgA._id))).emails, 1);
  assert.equal((await usage.getUsage(String(orgB._id))).emails, 0);
  await assert.rejects(
    () => usage.assertUsageAvailable('monthlyEmails', 1, String(orgA._id)),
    /额度已用完/,
  );

  const summary = await usage.getUsageSummary(String(orgA._id));
  assert.equal(summary.usage.emails, 1);
  assert.equal(summary.percentages.emails, 100);
  assert.ok(summary.estimatedInvoiceUsd >= 49);
});

test('organization capacity counts only the current tenant', async () => {
  const orgA = await models.Organization.create({ name: 'Capacity A', slug: 'capacity-a', plan: 'starter', limits: { users: 1, projects: 1, monthlyEmails: 1, monthlyAiTokens: 1, storageBytes: 1 }, subscriptionStatus: 'active' });
  const orgB = await models.Organization.create({ name: 'Capacity B', slug: 'capacity-b', plan: 'starter', limits: { users: 1, projects: 1, monthlyEmails: 1, monthlyAiTokens: 1, storageBytes: 1 }, subscriptionStatus: 'active' });
  await tenant.runWithTenant({ organizationId: String(orgA._id) }, async () => {
    await models.User.create({ username: 'capacity-a-user', passwordHash: 'x', displayName: 'A', role: 'user', projectIds: [] });
    await assert.rejects(() => orgService.assertOrganizationCapacity('users'), /额度已用完/);
  });
  await tenant.runWithTenant({ organizationId: String(orgB._id) }, async () => {
    assert.doesNotReject(() => orgService.assertOrganizationCapacity('users'));
  });
});

test('AI settings singleton key is unique per organization', async () => {
  await models.AgentAiSettings.init();
  const makeOrg = (slug: string) => models.Organization.create({ name: slug, slug, plan: 'starter', limits: { users: 5, projects: 2, monthlyEmails: 5000, monthlyAiTokens: 1000000, storageBytes: 5 * 1024 ** 3 }, subscriptionStatus: 'active' });
  const [a, b] = await Promise.all([makeOrg('ai-a'), makeOrg('ai-b')]);
  const user = await models.User.create({ username: 'ai-owner', passwordHash: 'x', displayName: 'AI', role: 'admin', organizationId: a._id, projectIds: [] });
  const input = (orgId: mongoose.Types.ObjectId) => ({ key: 'global', provider: 'mock' as const, modelName: 'mock', baseUrl: 'https://example.test', updatedBy: user._id, organizationId: orgId });
  await tenant.runWithTenant({ organizationId: String(a._id) }, () => models.AgentAiSettings.create(input(a._id)));
  await tenant.runWithTenant({ organizationId: String(b._id) }, () => models.AgentAiSettings.create(input(b._id)));
  await assert.rejects(() => tenant.runWithTenant({ organizationId: String(a._id) }, () => models.AgentAiSettings.create(input(a._id))), /duplicate key/i);
});

test('refresh sessions stay valid inside a tenant-scoped request', async () => {
  const org = await models.Organization.create({ name: 'Session Org', slug: 'session-org', plan: 'starter', limits: { users: 5, projects: 2, monthlyEmails: 5000, monthlyAiTokens: 1000000, storageBytes: 5 * 1024 ** 3 }, subscriptionStatus: 'active' });
  const user = await models.User.create({ username: 'session-user', passwordHash: 'x', displayName: 'Session', role: 'admin', organizationId: org._id, projectIds: [] });
  const auth = await import('../src/services/auth.service');
  const session = await auth.createAuthSession({
    id: String(user._id), username: user.username, displayName: user.displayName, role: 'admin', organizationId: String(org._id),
  });
  const active = await tenant.runWithTenant({ organizationId: String(org._id) }, () => auth.isAuthSessionActive(session.sessionId, String(user._id)));
  assert.equal(active, true, 'AuthSession must not be tenant-filtered');
});

test('platform provisioning creates an isolated organization admin', async () => {
  const created = await orgService.createOrganization({
    name: 'Acme Tenant',
    slug: 'acme-tenant',
    plan: 'growth',
    adminUsername: 'acme-admin',
    adminPassword: 'StrongPassword123!',
    adminDisplayName: 'Acme Admin',
  }, platformActor());
  assert.equal(created.slug, 'acme-tenant');
  const admin = await models.User.findOne({ username: 'acme-admin' });
  assert.ok(admin);
  assert.equal(String(admin?.organizationId), created.id);
  assert.equal(admin?.isPlatformAdmin, false);
});
