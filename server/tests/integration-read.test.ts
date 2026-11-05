import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'fictional-integration-read-test-secret-0123456789';
process.env.ADMIN_PASSWORD = 'fictional-test-admin';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:5000';
process.env.API_RATE_LIMIT_MAX = '10000';

let memory: MongoMemoryServer, server: Server, second: Server, base: string, otherBase: string, temp: string;
let db: typeof import('mongoose');
let models: typeof import('../src/models');
let publicModels: typeof import('../src/models/IntegrationPublicResource');
let docs: typeof import('../src/models/KnowledgeDocument');
let publication: typeof import('../src/services/integration-publication.service');
let storage: typeof import('../src/services/storage.service');
let tenant: typeof import('../src/models/tenant-context');
let credentials: typeof import('../src/services/integration-credential.service');
let orgA: string, orgB: string, projectA: string, projectB: string, projectC: string;
let token: string, credentialId: string, limited: string, otherToken: string;
let product: string, foreignProduct: string, playbook: string, document: string;
const scopes = ['products:read', 'company:read', 'playbook:read', 'knowledge:read'];
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const oldTime = new Date('2026-01-01T00:00:00.000Z');

async function request(path: string, opts: { token?: string; project?: string; base?: string } = {}) {
  const response = await fetch((opts.base ?? base) + path, { headers: {
    Authorization: `Bearer ${opts.token ?? token}`, 'X-Project-Id': opts.project ?? projectA,
  } });
  return { status: response.status, headers: response.headers, body: await response.json() as any };
}
function asA<T>(fn: () => T) { return tenant.runWithTenant({ organizationId: orgA }, fn); }

// Use the published OpenAPI response schemas on actual HTTP responses. No copied schema.
const yaml = require('js-yaml');
const Ajv = require('ajv');
function openApiSchema(value: any): any {
  if (Array.isArray(value)) return value.map(openApiSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'nullable').map(([k, v]) => [k, openApiSchema(v)]));
  if (value.nullable && typeof value.type === 'string') result.type = [value.type, 'null'];
  return result;
}
const contract = yaml.load(readFileSync(join(__dirname, '../../docs/integration/integration-v1.openapi.yaml'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
require('ajv-formats')(ajv);
const schemaRoot = { components: { schemas: openApiSchema(contract.components.schemas) } };
function validateResponse(path: string, body: unknown) {
  const ref = contract.paths[path].get.responses[200].content['application/json'].schema.$ref;
  const validate = ajv.compile({ ...schemaRoot, $ref: ref });
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
}

before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'globalcrm-c1-'));
  process.env.UPLOAD_DIR = temp;
  memory = await MongoMemoryServer.create();
  db = await import('mongoose');
  await db.default.connect(memory.getUri(), { dbName: 'fictional_c1_tests' });
  models = await import('../src/models');
  publicModels = await import('../src/models/IntegrationPublicResource');
  docs = await import('../src/models/KnowledgeDocument');
  publication = await import('../src/services/integration-publication.service');
  storage = await import('../src/services/storage.service');
  tenant = await import('../src/models/tenant-context');
  credentials = await import('../src/services/integration-credential.service');
  orgA = String(new db.Types.ObjectId()); orgB = String(new db.Types.ObjectId());
  async function project(code: string, org: string) {
    return String((await models.Project.create({ name: code, slug: code.toLowerCase(), code,
      companyName: 'FICTIONAL ' + code, organizationId: org, mailProfileKey: 'default',
      mailFrom: 'private-sender@example.test', brandProfile: { avoidTopics: 'INTERNAL_STRATEGY' },
    }))._id);
  }
  projectA = await project('C1A', orgA); projectB = await project('C1B', orgB); projectC = await project('C1C', orgA);
  await Promise.all([publicModels.IntegrationPublicResource.createIndexes(), publicModels.IntegrationRateLimit.createIndexes(), models.IntegrationCredential.init()]);
  await Promise.all([publicModels.IntegrationPublicResource.createIndexes(), publicModels.IntegrationRateLimit.createIndexes()]);
  const c = await asA(() => credentials.createCredential({ name: 'FICTIONAL C1', projectIds: [projectA, projectC], scopes }));
  token = c.token; credentialId = String(c.credential._id);
  limited = (await asA(() => credentials.createCredential({ name: 'FICTIONAL limited', projectIds: [projectA], scopes: ['stats:read'] }))).token;
  otherToken = (await asA(() => credentials.createCredential({ name: 'FICTIONAL other', projectIds: [projectA], scopes }))).token;
  product = String((await asA(() => models.Product.create({ projectId: projectA, sku: 'FICTIONAL-1', name: 'FICTIONAL Product',
    notes: 'INTERNAL_NOTE', priceTiers: [{ minQuantity: 1, unitPrice: 2, currency: 'USD', notes: 'INTERNAL_PRICE' }],
    specs: [{ code: 'SIZE', name: 'Size', value: '10', notes: 'INTERNAL_SPEC' }],
  })))._id);
  foreignProduct = String((await tenant.runWithTenant({ organizationId: orgB }, () => models.Product.create({ projectId: projectB, sku: 'FOREIGN', name: 'FOREIGN_SECRET' })))._id);
  await tenant.runWithTenant({ organizationId: orgB }, () => models.Product.create({ projectId: projectA, sku: 'CORRUPT', name: 'CROSS_TENANT_SECRET' }));
  playbook = String((await asA(() => models.ProjectPlaybook.create({ projectId: projectA, segments: [{ id: 'internal', logic: 'INTERNAL_STRATEGY' }] })))._id);
  document = String((await asA(() => docs.KnowledgeDocument.create({ projectId: projectA, kind: 'project_document',
    originalName: 'PRIVATE_FILENAME', extension: 'txt', sha256: 'fictional-hash', uploadedBy: new db.Types.ObjectId(), source: 'fictional',
  })))._id);
  await storage.putObject('fictional-c1-image.png', png, 'image/png');
  await asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'product', sourceId: product,
    payload: { material: 'Cotton', images: [{ key: 'fictional-c1-image.png' }] }, reviewed: true }));
  const { createApp } = await import('../src/app');
  const listen = (app: ReturnType<typeof createApp>) => new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  server = await listen(createApp()); second = await listen(createApp());
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrations/v1`;
  otherBase = `http://127.0.0.1:${(second.address() as AddressInfo).port}/api/integrations/v1`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (second) await new Promise<void>(resolve => second.close(() => resolve()));
  if (db) await db.default.disconnect();
  if (memory) await memory.stop();
  if (temp) {
    assert.ok(temp.startsWith(join(tmpdir(), 'globalcrm-c1-')), 'Cleanup must stay in the test-created temporary directory');
    await rm(temp, { recursive: true, force: true });
  }
});

test('old contract unchanged, C1 separately frozen, rejection regressions pass', () => {
  const out = execFileSync(process.execPath, ['scripts/check-integration-contract.cjs'], { cwd: join(__dirname, '../..'), encoding: 'utf8' });
  assert.match(out, /original definitions unchanged/);
});
test('all new reads require exact scope; old credentials are not upgraded', async () => {
  for (const path of ['/products', '/company-profile', '/playbook', '/knowledge/summaries', `/products/${product}`]) {
    const r = await request(path, { token: limited }); assert.equal(r.status, 403); assert.equal(r.body.error.code, 'FORBIDDEN_SCOPE');
  }
  assert.equal((await request('/health', { token: limited })).status, 200);
});
test('project binding, cross-project detail and malformed tenant rows are isolated', async () => {
  assert.equal((await request('/products', { project: projectB })).status, 404);
  assert.equal((await request(`/products/${foreignProduct}`)).status, 404);
  assert.equal((await request(`/products/${product}`, { project: projectC })).status, 404);
  const r = await request('/products'); validateResponse('/products', r.body);
  assert.equal(r.body.data.items.length, 1);
  assert.doesNotMatch(JSON.stringify(r.body), /CROSS_TENANT_SECRET|FOREIGN_SECRET|INTERNAL|fictional-c1-image\.png/);
});
test('product detail has explicit nulls and no price, storage path or internal notes', async () => {
  const r = await request(`/products/${product}`); assert.equal(r.status, 200); validateResponse('/products/{id}', r.body);
  assert.equal(r.body.data.category, null); assert.equal(r.body.data.application, null);
  assert.equal(r.body.data.material, 'Cotton'); assert.deepEqual(r.body.data.certifications, []);
  assert.equal(r.body.data.specs[0].unit, null); assert.equal(r.body.data.images.length, 1);
  assert.doesNotMatch(JSON.stringify(r.body), /INTERNAL|priceTiers|notes|storageKey|fictional-c1-image/);
});
test('company comes only from bound project and absent public facts remain null', async () => {
  const r = await request('/company-profile'); validateResponse('/company-profile', r.body);
  const company = r.body.data.items[0]; assert.equal(company.name, 'FICTIONAL C1A');
  assert.equal(company.address, null); assert.equal(company.email, null); assert.equal(company.foundedYear, null);
  assert.doesNotMatch(JSON.stringify(r.body), /private-sender|INTERNAL_STRATEGY/);
  const empty = await request('/company-profile?updatedSince=2099-01-01T00:00:00.000Z'); assert.deepEqual(empty.body.data.items, []);
});
test('operator publication rejects unreviewed, cross-project and unallowlisted fields', async () => {
  await assert.rejects(asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'knowledge', sourceId: document, payload: { title: 'Public', summary: 'Summary' }, reviewed: false })));
  await assert.rejects(asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'product', sourceId: foreignProduct, payload: {}, reviewed: true })));
  await assert.rejects(asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'playbook', sourceId: playbook, payload: { logic: 'internal' }, reviewed: true })));
  await assert.rejects(asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'product', sourceId: product, payload: { images: [{ key: '../escape' }] }, reviewed: true })));
});
test('unpublished playbook and knowledge are empty; public summaries exclude internal fields', async () => {
  assert.deepEqual((await request('/playbook')).body.data.items, []);
  assert.deepEqual((await request('/knowledge/summaries')).body.data.items, []);
  await asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'playbook', sourceId: playbook, reviewed: true, payload: {
    brandPositioning: { value: 'INTERNAL_BRAND', visibility: 'internal' },
    sellingPoints: [{ value: 'Public selling point', visibility: 'public' }, { value: 'INTERNAL_POINT', visibility: 'internal' }],
    targetMarkets: [{ value: 'EU', visibility: 'public' }],
  } }));
  const p = await request('/playbook'); validateResponse('/playbook', p.body);
  assert.equal(p.body.data.items[0].brandPositioning, null); assert.deepEqual(p.body.data.items[0].sellingPoints, ['Public selling point']);
  assert.doesNotMatch(JSON.stringify(p.body), /INTERNAL|segments|logic/);
  await asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'knowledge', sourceId: document, reviewed: true,
    payload: { title: 'FICTIONAL public title', summary: 'Reviewed public summary' } }));
  const k = await request('/knowledge/summaries'); validateResponse('/knowledge/summaries', k.body);
  assert.equal(k.body.data.items.length, 1); assert.equal(k.body.data.items[0].id, document);
  assert.doesNotMatch(JSON.stringify(k.body), /PRIVATE_FILENAME|originalName|blobKey|artifact/);
});
test('keyset pagination handles timestamp ties, scopes cursor and validates query', async () => {
  const created = await asA(() => models.Product.create([1, 2, 3].map(n => ({ projectId: projectA, sku: 'PAGE' + n, name: 'Page ' + n }))));
  await asA(() => models.Product.updateMany({ _id: { $in: created.map(p => p._id) } }, { $set: { updatedAt: oldTime } }, { timestamps: false }));
  const ids: string[] = []; let cursor: string | null = null;
  do {
    const r = await request('/products?limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    assert.equal(r.status, 200); validateResponse('/products', r.body);
    ids.push(...r.body.data.items.map((p: any) => p.id)); cursor = r.body.data.nextCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, ids.length); assert.equal(ids.length, 4);
  const first = await request('/products?limit=1'); const c = first.body.data.nextCursor;
  assert.equal((await request('/products?cursor=' + c, { token: otherToken })).status, 422);
  assert.equal((await request('/products?cursor=' + c, { project: projectC })).status, 422);
  assert.equal((await request('/knowledge/summaries?cursor=' + c)).status, 422);
  assert.equal((await request('/products?cursor=' + c + 'x')).status, 422);
  assert.equal((await request('/products?cursor=' + c + '&updatedSince=2025-01-01T00:00:00.000Z')).status, 422);
  for (const q of ['updatedSince=garbage', 'limit=101', 'limit=0', 'projectId=' + projectB]) assert.equal((await request('/products?' + q)).status, 422);
});
test('updatedSince includes equal boundary and only changed products/public supplements', async () => {
  const recent = await request('/products?updatedSince=2026-01-02T00:00:00.000Z');
  assert.equal(recent.body.data.items.length, 1); assert.equal(recent.body.data.items[0].id, product);
  const boundary = await request('/products?updatedSince=' + encodeURIComponent(oldTime.toISOString())); assert.equal(boundary.body.data.items.length, 4);
  await asA(() => models.Product.updateOne({ _id: product }, { $set: { status: 'archived' } }));
  const detail = await request(`/products/${product}`); assert.equal(detail.body.data.status, 'archived');
  const future = await request('/products?updatedSince=2099-01-01T00:00:00.000Z'); assert.deepEqual(future.body.data.items, []);
});
test('signed image download checks bytes, scope, project, credential and tampering', async () => {
  const r = await request(`/products/${product}`); const image = r.body.data.images[0];
  const url = new URL(image.url); const path = url.pathname.replace('/api/integrations/v1', '') + url.search;
  const download = await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': projectA } });
  assert.equal(download.status, 200); assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  assert.equal((await request(path, { token: limited })).status, 403);
  assert.equal((await request(path, { token: otherToken })).status, 404);
  assert.equal((await request(path, { project: projectC })).status, 404);
  const tampered = new URL(image.url);
  const sig = tampered.searchParams.get('signature')!;
  tampered.searchParams.set('signature', (sig[0] === '0' ? '1' : '0') + sig.slice(1));
  assert.equal((await request(tampered.pathname.replace('/api/integrations/v1', '') + tampered.search)).status, 404);
  const noAuth = await fetch(base + path); assert.equal(noAuth.status, 401);
});
test('image and cursor expiration enforced without relying on cleanup timers', async t => {
  const r = await request(`/products/${product}`); const u = new URL(r.body.data.images[0].url);
  const c = (await request('/products?limit=1')).body.data.nextCursor;
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 301_000);
  assert.equal((await request(u.pathname.replace('/api/integrations/v1', '') + u.search)).status, 404);
  t.mock.restoreAll(); t.mock.method(Date, 'now', () => now + 8 * 86400_000);
  assert.equal((await request('/products?cursor=' + c)).status, 422);
});
test('revocation removes summaries and invalidates issued image links immediately', async () => {
  const r = await request(`/products/${product}`); const u = new URL(r.body.data.images[0].url);
  await asA(() => publication.revokeIntegrationResource(projectA, 'product', product));
  assert.equal((await request(u.pathname.replace('/api/integrations/v1', '') + u.search)).status, 404);
  assert.deepEqual((await request(`/products/${product}`)).body.data.images, []);
  await asA(() => publication.revokeIntegrationResource(projectA, 'knowledge', document));
  const k = await request('/knowledge/summaries'); validateResponse('/knowledge/summaries', k.body);
  assert.equal(k.body.data.items[0].deleted, true); assert.equal(k.body.data.items[0].summary, '');
});
test('credential limit is atomic and shared by projects and independent API instances', async t => {
  const now = Math.floor(Date.now() / 60_000) * 60_000 + 10_000;
  t.mock.method(Date, 'now', () => now);
  const fresh = await asA(() => credentials.createCredential({ name: 'FICTIONAL quota', projectIds: [projectA, projectC], scopes }));
  await tenant.runWithTenant({ bypass: true }, () => publicModels.IntegrationRateLimit.create({ credentialId: fresh.credential._id,
    window: Math.floor(now / 60_000), count: 118, expiresAt: new Date(now + 120_000) }));
  const result = await Promise.all(Array.from({ length: 10 }, (_, i) => request('/company-profile', {
    token: fresh.token, project: i % 2 ? projectA : projectC, base: i % 2 ? base : otherBase,
  })));
  assert.equal(result.filter(r => r.status === 200).length, 2);
  assert.equal(result.filter(r => r.status === 429).length, 8);
  for (const r of result.filter(r => r.status === 429)) { assert.equal(r.body.error.code, 'RATE_LIMITED'); assert.equal(r.headers.get('retry-after'), '50'); }
  assert.equal((await request('/company-profile', { token: otherToken })).status, 200);
  t.mock.method(Date, 'now', () => now + 60_000);
  assert.equal((await request('/company-profile', { token: fresh.token })).status, 200);
  assert.ok(credentialId);
});

test('company supplementary facts participate in incremental timestamps without sender fallbacks', async () => {
  await asA(() => models.Project.updateOne({ _id: projectA }, { $set: { updatedAt: oldTime } }, { timestamps: false }));
  await asA(() => publication.publishIntegrationResource({ projectId: projectA, sourceId: projectA, kind: 'company', reviewed: true,
    payload: { address: 'FICTIONAL reviewed address', foundedYear: 2001, certifications: ['Reviewed certificate'] } }));
  const r = await request('/company-profile?updatedSince=2026-01-02T00:00:00.000Z'); validateResponse('/company-profile', r.body);
  assert.equal(r.body.data.items.length, 1); assert.equal(r.body.data.items[0].foundedYear, 2001);
  assert.equal(r.body.data.items[0].email, null);
});
test('knowledge summaries reject corrupt cross-project and cross-organization source references', async () => {
  const foreign = await tenant.runWithTenant({ organizationId: orgB }, () => docs.KnowledgeDocument.create({
    projectId: projectB, kind: 'project_document', originalName: 'FOREIGN_PRIVATE_FILE', extension: 'txt', sha256: 'foreign-fictional',
    uploadedBy: new db.Types.ObjectId(), source: 'fictional',
  }));
  await asA(() => publicModels.IntegrationPublicResource.create({ projectId: projectA, kind: 'knowledge', sourceId: foreign._id,
    payload: { title: 'CROSS_SOURCE_SECRET', summary: 'Must not escape' } }));
  await tenant.runWithTenant({ organizationId: orgB }, () => publicModels.IntegrationPublicResource.create({
    projectId: projectA, kind: 'knowledge', sourceId: document, payload: { title: 'CROSS_ORG_SECRET', summary: 'Must not escape' },
  }));
  const r = await request('/knowledge/summaries'); validateResponse('/knowledge/summaries', r.body);
  assert.doesNotMatch(JSON.stringify(r.body), /CROSS_SOURCE|CROSS_ORG|FOREIGN_PRIVATE/);
  assert.equal(r.body.data.items.length, 1);
});
test('new reads fail closed for legacy unowned projects and deleted products', async () => {
  const legacy = await models.Project.create({ name: 'FICTIONAL legacy', slug: 'c1-legacy', code: 'C1LEGACY', companyName: 'FICTIONAL legacy', mailProfileKey: 'default' });
  const c = await credentials.createCredential({ name: 'FICTIONAL legacy', projectIds: [String(legacy._id)], scopes });
  assert.equal((await request('/products', { project: String(legacy._id), token: c.token })).status, 404);
  const p = await asA(() => models.Product.create({ projectId: projectA, sku: 'DELETED', name: 'Deleted fixture' }));
  await asA(() => models.Product.deleteOne({ _id: p._id }));
  assert.equal((await request('/products/' + String(p._id))).status, 404);
});
test('stored image changes and credential revocation invalidate existing signed URLs', async () => {
  await asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'product', sourceId: product, reviewed: true,
    payload: { images: [{ key: 'fictional-c1-image.png' }] } }));
  const c = await asA(() => credentials.createCredential({ name: 'FICTIONAL revoke', projectIds: [projectA], scopes }));
  const r = await request(`/products/${product}`, { token: c.token }); const u = new URL(r.body.data.images[0].url);
  const path = u.pathname.replace('/api/integrations/v1', '') + u.search;
  await storage.putObject('fictional-c1-image.png', Buffer.concat([png, Buffer.from([1])]), 'image/png');
  assert.equal((await request(path, { token: c.token })).status, 404);
  await storage.putObject('fictional-c1-image.png', png, 'image/png');
  await asA(() => credentials.revokeCredential(String(c.credential._id)));
  assert.equal((await request(path, { token: c.token })).status, 401);
});
test('publication rejects non-images and oversized local storage before returning signed URLs', async () => {
  await storage.putObject('fictional-not-image.png', Buffer.from('not an image'));
  await assert.rejects(asA(() => publication.publishIntegrationResource({ projectId: projectA, kind: 'product', sourceId: product,
    reviewed: true, payload: { images: [{ key: 'fictional-not-image.png' }] } })));
  await storage.putObject('fictional-oversize.png', Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(storage.getObject('fictional-oversize.png', 10 * 1024 * 1024));
});
