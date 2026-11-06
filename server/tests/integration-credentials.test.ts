import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { credentialFixture } from './fixtures/integration-management';

let f: Awaited<ReturnType<typeof credentialFixture>>;
before(async () => { f = await credentialFixture(); });
beforeEach(async () => { await f.models.IntegrationCredential.deleteMany({}); await f.models.AuditLog.deleteMany({}); await f.models.IntegrationRequestLog.deleteMany({}); });
after(async () => { if (f) await f.cleanup(); });
const body = () => ({ name: 'FICTIONAL GlobalSite', scopes: ['products:read', 'customers:upsert', 'inquiries:write'] });
const create = () => f.request('/credentials', { method: 'POST', body: body() });
const Ajv = require('ajv'), yaml = require('js-yaml');
const ajv = new Ajv({ strict: false }); require('ajv-formats')(ajv);
function convert(v: any): any {
  if (Array.isArray(v)) return v.map(convert);
  if (!v || typeof v !== 'object') return v;
  const result = Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'nullable').map(([k, value]) => [k, convert(value)]));
  if (v.nullable && typeof v.type === 'string') result.type = [v.type, 'null'];
  return result;
}
const contract = yaml.load(readFileSync(join(__dirname, '../../docs/integration/integration-v1.openapi.yaml'), 'utf8'));
function valid(path: string, method: string, status: number, data: any) {
  const schema = contract.paths[path][method].responses[status].content['application/json'].schema;
  const check = ajv.compile({ components: { schemas: convert(contract.components.schemas) }, ...schema });
  assert.ok(check(data), 'Actual HTTP response must match C2 OpenAPI');
}
async function serviceHealth(token: string, project = String(f.a._id)) {
  return fetch(f.base + '/api/integrations/v1/health', { headers: { Authorization: 'Bearer ' + token, 'X-Project-Id': project } });
}
test('sales/viewers cannot list, create, read settings/logs, rotate or revoke', async () => {
  const made = await create(); const id = made.body.data.credential.id;
  for (const role of ['sales', 'viewer'] as const) for (const path of ['/credentials', '/settings', '/request-logs']) assert.equal((await f.request(path, { role })).status, 403);
  for (const role of ['sales', 'viewer'] as const) for (const path of ['/credentials', `/credentials/${id}/rotate`, `/credentials/${id}/revoke`]) assert.equal((await f.request(path, { role, method: 'POST', body: path === '/credentials' ? body() : {} })).status, 403);
});
test('explicit project and current organization membership are mandatory', async () => {
  assert.equal((await f.request('/settings', { headers: { 'X-Project-Id': '' } })).status, 400);
  assert.equal((await f.request('/settings', { project: String(f.c._id) })).status, 404);
  assert.equal((await f.request('/settings', { project: String(f.b._id), role: 'admin' })).status, 404);
  const made = await create();
  assert.equal((await f.request(`/credentials/${made.body.data.credential.id}/rotate`, { method: 'POST', body: {}, role: 'foreign', project: String(f.b._id) })).status, 404);
  const foreign = await f.request('/credentials', { role: 'foreign', project: String(f.b._id) }); assert.equal(foreign.body.data.total, 0);
});
test('GlobalSite preset preserves approved inquiry scope now available in C3', async () => {
  const s = await f.request('/settings'); assert.equal(s.status, 200); valid('/settings', 'get', 200, s.body);
  assert.equal(s.body.data.globalsitePreset.length, 7); assert.ok(s.body.data.globalsitePreset.includes('inquiries:write'));
  assert.equal(s.body.data.scopes.find((v: any) => v.name === 'inquiries:write').available, true);
});
test('create returns plaintext once with no-store; lists/database/audit never contain it', async () => {
  const r = await create(); assert.equal(r.status, 201); valid('/credentials', 'post', 201, r.body);
  assert.equal(r.headers.get('cache-control'), 'private, no-store'); const token = r.body.data.token;
  assert.ok(/^gci_[a-f0-9]{48}$/.test(token), 'Expected generated token format');
  const list = await f.request('/credentials'); valid('/credentials', 'get', 200, list.body);
  const raw = await f.models.IntegrationCredential.findById(r.body.data.credential.id).select('+tokenHash +previousTokenHash +seatKeys +quotaEnabled').lean();
  const audits = await f.models.AuditLog.find().lean();
  assert.ok(!JSON.stringify([raw, audits, list.body]).includes(token), 'Token plaintext must not persist or appear in metadata');
  assert.ok(!JSON.stringify(list.body).includes('tokenHash')); assert.ok(!JSON.stringify(list.body).includes('seatKeys'));
  assert.equal(list.body.data.items[0].createdBy.id, String(f.actors.manager.user._id));
  assert.equal((await serviceHealth(token)).status, 200);
});
test('service credentials cannot call user management APIs', async () => {
  const made = await create();
  assert.equal((await f.request('/credentials', { headers: { Authorization: 'Bearer ' + made.body.data.token } })).status, 401);
});
test('cookie writes enforce CSRF while valid project manager session works', async () => {
  const headers = { Authorization: '', Cookie: `cdlm_access=${f.actors.manager.token}; cdlm_csrf=fictional-csrf` };
  assert.equal((await f.request('/credentials', { method: 'POST', body: body(), headers })).status, 403);
  assert.equal((await f.request('/credentials', { method: 'POST', body: body(), headers: { ...headers, 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await f.request('/credentials', { method: 'POST', body: body(), headers: { ...headers, 'X-CSRF-Token': 'fictional-csrf' } })).status, 201);
});
test('rotation accepts old/new within grace, rejects old after exact deadline', async t => {
  const made = await create(), id = made.body.data.credential.id, old = made.body.data.token;
  const rotated = await f.request(`/credentials/${id}/rotate`, { method: 'POST', body: { graceSeconds: 2 } });
  assert.equal(rotated.status, 200); valid('/credentials/{credentialId}/rotate', 'post', 200, rotated.body);
  assert.equal(rotated.body.data.credential.id, id);
  const fresh = rotated.body.data.token; assert.ok(fresh !== old);
  assert.equal((await serviceHealth(old)).status, 200); assert.equal((await serviceHealth(fresh)).status, 200);
  const repeated = await f.request(`/credentials/${id}/rotate`, { method: 'POST', body: { graceSeconds: 2 } }); assert.equal(repeated.status, 409);
  t.mock.method(Date, 'now', () => new Date(rotated.body.data.credential.previousValidUntil).getTime());
  assert.equal((await serviceHealth(old)).status, 401); assert.equal((await serviceHealth(fresh)).status, 200);
});
test('revocation immediately invalidates both tokens and records audit without secrets', async () => {
  const made = await create(), id = made.body.data.credential.id;
  const rotated = await f.request(`/credentials/${id}/rotate`, { method: 'POST', body: { graceSeconds: 86400 } });
  const revoked = await f.request(`/credentials/${id}/revoke`, { method: 'POST', body: {} }); assert.equal(revoked.status, 200);
  valid('/credentials/{credentialId}/revoke', 'post', 200, revoked.body);
  assert.equal((await serviceHealth(made.body.data.token)).status, 401); assert.equal((await serviceHealth(rotated.body.data.token)).status, 401);
  const actions = await f.models.AuditLog.find({ targetId: id }).lean();
  for (const action of ['create', 'rotate', 'revoke']) assert.ok(actions.some(a => a.action === 'integration.credential.' + action));
  assert.ok(!JSON.stringify(actions).includes(made.body.data.token)); assert.ok(!JSON.stringify(actions).includes(rotated.body.data.token));
});
test('script shared rotation defaults to immediate and concurrent rotation uses CAS', async () => {
  const made = await create(), id = made.body.data.credential.id;
  const rotated = await f.service.rotateCredential(id);
  assert.equal(await f.service.verifyToken(made.body.data.token), null); assert.ok(await f.service.verifyToken(rotated.token));
  const result = await Promise.allSettled([f.service.rotateCredential(id, 3600), f.service.rotateCredential(id, 3600)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
});
test('parallel UI and shared service creation cannot exceed plan seats', async () => {
  const result = await Promise.all(Array.from({ length: 12 }, () => create()));
  assert.equal(result.filter(r => r.status === 201).length, 3); assert.equal(result.filter(r => r.status === 409).length, 9);
  assert.equal(await f.models.IntegrationCredential.countDocuments({ status: 'active' }), 3);
  await assert.rejects(f.service.createCredential({ ...body(), projectIds: [String(f.a._id)] }), (e: any) => e.statusCode === 409);
  const first = result.find(r => r.status === 201)!;
  await f.request(`/credentials/${first.body.data.credential.id}/revoke`, { method: 'POST', body: {} });
  assert.equal((await create()).status, 201);
});
test('expiry frees seats; old credentials still count against quota', async () => {
  const now = Date.now();
  for (let i = 0; i < 3; i++) await f.models.IntegrationCredential.create({ name: 'FICTIONAL legacy', organizationId: f.orgA._id,
    projectIds: [f.a._id], scopes: ['products:read'], tokenHash: f.service.hashToken(f.service.generateToken()), tokenPrefix: 'fixture' });
  assert.equal((await create()).status, 409);
  const legacy = await f.models.IntegrationCredential.findOne();
  await f.models.IntegrationCredential.updateOne({ _id: legacy!._id }, { $set: { expiresAt: new Date(now - 1000) } });
  assert.equal((await create()).status, 201);
});
test('multi-project seats reserve atomically and managers cannot affect other assigned scopes', async () => {
  const made = await f.service.createCredential({ ...body(), projectIds: [String(f.a._id), String(f.c._id)] });
  assert.equal((await f.request('/credentials')).body.data.total, 0);
  assert.equal((await f.request(`/credentials/${made.credential._id}/revoke`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await f.request('/credentials', { role: 'admin' })).body.data.total, 1);
  await assert.rejects(f.service.createCredential({ ...body(), projectIds: [String(f.a._id), String(f.b._id)] }));
});
test('request logs only return scoped safe metadata; list access is audited', async () => {
  const made = await create(); await serviceHealth(made.body.data.token);
  await f.models.IntegrationRequestLog.create({ requestId: 'fictional-foreign', projectId: f.b._id, organizationId: f.orgB._id,
    method: 'GET', route: '/FOREIGN_LOG_SECRET', statusCode: 200, latencyMs: 1 });
  const r = await f.request('/request-logs'); assert.equal(r.status, 200); valid('/request-logs', 'get', 200, r.body);
  assert.ok(r.body.data.items.length > 0); assert.ok(!JSON.stringify(r.body).includes('FOREIGN_LOG_SECRET'));
  assert.ok(!JSON.stringify(r.body).includes('externalId')); assert.ok(!JSON.stringify(r.body).includes(made.body.data.token));
  const audits = await f.models.AuditLog.find({ action: 'integration.logs.view' }); assert.equal(audits.length, 1);
});
test('migration idempotently adopts owned legacy credentials without changing their token', async () => {
  const token = f.service.generateToken();
  const legacy = await f.models.IntegrationCredential.create({ name: 'FICTIONAL unowned', projectIds: [f.a._id], scopes: ['products:read'], tokenHash: f.service.hashToken(token), tokenPrefix: 'fixture' });
  const { migrateCredentialIndexes } = await import('../src/services/integration-credential-migration.service');
  assert.ok(await f.service.verifyToken(token)); const first = await migrateCredentialIndexes(); assert.equal(first.adopted, 1);
  assert.ok(await f.service.verifyToken(token)); assert.equal((await migrateCredentialIndexes()).adopted, 0);
  assert.equal(String((await f.models.IntegrationCredential.findById(legacy._id))!.organizationId), String(f.orgA._id));
});
test('input injection, invalid expiry and grace limits are rejected', async () => {
  for (const extra of [{ projectIds: [String(f.b._id)] }, { tokenHash: 'injected' }, { expiresAt: '2020-01-01T00:00:00.000Z' }, { scopes: ['not:a-scope'] }]) {
    assert.equal((await f.request('/credentials', { method: 'POST', body: { ...body(), ...extra } })).status, 422);
  }
  const made = await create();
  for (const graceSeconds of [-1, 604801, 1.5]) assert.equal((await f.request(`/credentials/${made.body.data.credential.id}/rotate`, { method: 'POST', body: { graceSeconds } })).status, 422);
});

test('expired managed slots are released and plan-specific fallback is respected', async () => {
  const made = await Promise.all([create(), create(), create()]);
  assert.ok(made.every(r => r.status === 201));
  await f.models.IntegrationCredential.updateOne({ _id: made[0].body.data.credential.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await create()).status, 201);
  const growth = await f.request('/settings', { role: 'foreign', project: String(f.b._id) }); assert.equal(growth.body.data.quota.limit, 10);
});
test('current role changes take effect even when a prior manager JWT is reused', async () => {
  try {
    await f.models.User.updateOne({ _id: f.actors.manager.user._id }, { $set: { role: 'user' } });
    assert.equal((await f.request('/credentials')).status, 403);
    assert.equal((await create()).status, 403);
  } finally { await f.models.User.updateOne({ _id: f.actors.manager.user._id }, { $set: { role: 'project_admin' } }); }
});
test('malformed foreign-organization rows cannot consume or reveal current quota', async () => {
  await f.models.IntegrationCredential.create({ name: 'FOREIGN_CREDENTIAL_SECRET', organizationId: f.orgB._id,
    projectIds: [f.a._id], scopes: ['products:read'], tokenHash: f.service.hashToken(f.service.generateToken()), tokenPrefix: 'fixture' });
  const settings = await f.request('/settings'); assert.equal(settings.body.data.quota.used, 0);
  const list = await f.request('/credentials'); assert.equal(list.body.data.total, 0);
  const result = await Promise.all([create(), create(), create()]); assert.ok(result.every(r => r.status === 201));
});
