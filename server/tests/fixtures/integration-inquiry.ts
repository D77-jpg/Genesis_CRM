import type { Server } from 'node:http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
export async function inquiryFixture(port = 0) {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(48).toString('hex');
    process.env.ADMIN_PASSWORD = 'Fictional-J1-Admin-Only';
    process.env.MAIL_TRANSPORT = 'mock';
    // Isolation: never load the user's server/.env, uploads or live database.
    const dotenv = (await import('dotenv')).default;
    dotenv.config = () => ({ parsed: {} });
    const temp = await mkdtemp(join(tmpdir(), 'globalcrm-j1-'));
    process.env.UPLOAD_DIR = temp;
    const memory = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: process.env.MONGOMS_VERSION ?? '7.0.14' } });
    const db = (await import('mongoose')).default;
    await db.connect(memory.getUri('cdlm'));
    const m = await import('../../src/models'), tenant = await import('../../src/models/tenant-context'), credential = await import('../../src/services/integration-credential.service');
    const org = await m.Organization.create({ name: 'FICTIONAL J1 A', slug: 'fictional-j1-a', plan: 'growth' }), foreign = await m.Organization.create({ name: 'FICTIONAL J1 B', slug: 'fictional-j1-b', plan: 'growth' });
    const project = await m.Project.create({ organizationId: org._id, name: 'FICTIONAL J1', slug: 'fictional-j1', code: 'J1', companyName: 'Fictional Manufacturer', mailProfileKey: 'default', mailTransport: 'mock', onboardingCompletedAt: new Date() });
    const other = await m.Project.create({ organizationId: foreign._id, name: 'FICTIONAL Other', slug: 'fictional-j1-other', code: 'J1B', companyName: 'Fictional Other', mailProfileKey: 'default' });
    const another = await m.Project.create({ organizationId: org._id, name: 'FICTIONAL Another', slug: 'fictional-j1-another', code: 'J1C', companyName: 'Fictional Another', mailProfileKey: 'default' });
    const bcrypt = (await import('bcryptjs')).default;
    const manager = await m.User.create({ organizationId: org._id, username: 'fictional-j1-manager', displayName: 'FICTIONAL Manager', role: 'project_admin', passwordHash: await bcrypt.hash('Fictional-J1-Login-Only', 10), projectIds: [project._id], defaultProjectId: project._id });
    project.createdBy = manager._id;
    await project.save();
    const viewer = await m.User.create({ organizationId: org._id, username: 'fictional-j1-viewer', role: 'viewer', passwordHash: await bcrypt.hash('Fictional-J1-Login-Only', 10), projectIds: [project._id], defaultProjectId: project._id });
    const outsider = await m.User.create({ organizationId: foreign._id, username: 'fictional-j1-outsider', role: 'admin', passwordHash: 'FICTIONAL unusable hash', projectIds: [other._id], defaultProjectId: other._id });
    const asA = <T>(fn: () => T) => tenant.runWithTenant({ organizationId: String(org._id) }, fn);
    const scopes = ['products:read', 'company:read', 'playbook:read', 'knowledge:read', 'customers:upsert', 'inquiries:write', 'outcomes:read'];
    const issued = await asA(() => credential.createCredential({ name: 'FICTIONAL J1 API test', projectIds: [String(project._id)], scopes }));
    const limited = await asA(() => credential.createCredential({ name: 'FICTIONAL J1 limited', projectIds: [String(project._id)], scopes: ['products:read'] }));
    for (const model of [m.Customer, m.IntegrationIdempotency, m.IntegrationInquiry, m.IntegrationInquiryAttachment, m.IntegrationInquiryLock, m.IntegrationCredential])
        await model.init();
    const product = await asA(() => m.Product.create({ projectId: project._id, sku: 'FICTIONAL-PUMP', name: 'Fixture Pump', status: 'active', specs: [] }));
    await asA(() => (async () => { const pub = await import('../../src/services/integration-publication.service'); await pub.publishIntegrationResource({ projectId: String(project._id), kind: 'product', sourceId: String(product._id), payload: { material: 'Steel', application: 'Industrial transfer' }, reviewed: true }); })());
    const auth = await import('../../src/services/auth.service');
    const tokenFor = (user: any) => auth.signToken({ id: String(user._id), username: user.username, displayName: user.displayName, role: user.role }).token;
    const app = (await import('../../src/app')).createApp();
    const server = await new Promise<Server>(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
    const base = 'http://127.0.0.1:' + (server.address() as any).port;
    const headers = (token = issued.token, pid = String(project._id)) => ({ 'Authorization': 'Bearer ' + token, 'X-Project-Id': pid, 'Content-Type': 'application/json' });
    const request = async (path: string, body?: unknown, options: {
        token?: string;
        project?: string;
        key?: string;
    } = {}) => {
        const res = await fetch(base + '/api/integrations/v1' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers(options.token, options.project), ...(body !== undefined ? { 'Idempotency-Key': options.key ?? 'fixture-' + randomBytes(12).toString('hex') } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { status: res.status, body: await res.json(), headers: res.headers };
    };
    const userRequest = async (path: string, body?: unknown, user = manager, pid = String(project._id)) => {
        const res = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + tokenFor(user), 'X-Project-Id': pid, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { status: res.status, body: await res.json(), headers: res.headers };
    };
    return { temp, memory, db, m, tenant, asA, org, foreign, project, other, another, manager, viewer, outsider, issued, limited, credential, product, app, server, base, request, userRequest, headers, tokenFor,
        async cleanup() { await new Promise<void>(r => server.close(() => r())); await db.disconnect(); await memory.stop(); if (!temp.startsWith(join(tmpdir(), 'globalcrm-j1-')))
            throw Error('Unsafe cleanup'); await rm(temp, { recursive: true, force: true }); } };
}
