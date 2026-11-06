import { before, after, beforeEach, afterEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import http, { type Server } from 'node:http';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { inquiryFixture } from './fixtures/integration-inquiry';
let f: Awaited<ReturnType<typeof inquiryFixture>>, s: typeof import('../src/services/integration-webhook.service'), net: typeof import('../src/services/integration-webhook-http');
const spec = yaml.load(readFileSync(join(__dirname, '../../docs/integration/integration-v1.openapi.yaml'), 'utf8')) as any, ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
before(async () => { f = await inquiryFixture(); s = await import('../src/services/integration-webhook.service'); net = await import('../src/services/integration-webhook-http'); for (const m of [f.m.IntegrationWebhook, f.m.IntegrationWebhookEvent, f.m.IntegrationWebhookAttempt])
    await m.init(); });
after(async () => { mock.restoreAll(); await f?.cleanup(); });
beforeEach(async () => { mock.restoreAll(); mock.method(net.webhookNetwork, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }] as any); await f.asA(() => Promise.all([f.m.IntegrationWebhook.deleteMany({}), f.m.IntegrationWebhookEvent.deleteMany({}), f.m.IntegrationWebhookAttempt.deleteMany({})])); });
afterEach(() => mock.restoreAll());
const actor = () => ({ id: String(f.manager._id), username: f.manager.username, role: 'project_admin', projectId: String(f.project._id) }) as any;
async function call(method: string, path = '/webhook', body?: unknown, who = f.manager, pid = String(f.project._id), extra?: Record<string, string>) {
    const r = await fetch(f.base + '/api/projects/integrations' + path, { method, headers: { Authorization: 'Bearer ' + f.tokenFor(who), 'X-Project-Id': pid, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), b = await r.json();
    const key = path.replace(/\/[a-f0-9]{24}/g, '/{deliveryId}');
    let response = spec.paths[key]?.[method.toLowerCase()]?.responses[r.status];
    if (response?.$ref)
        response = spec.components.responses[response.$ref.split('/').pop()];
    const def = response?.content?.['application/json']?.schema;
    if (def) {
        const validate = ajv.compile({ ...def, components: spec.components });
        assert(validate(b), ajv.errorsText(validate.errors));
    }
    else
        assert.fail('Undocumented status ' + r.status + ' ' + key);
    return { status: r.status, body: b };
}
async function config(events = ['lead.status_changed'], enabled = true) { const r = await call('PUT', '/webhook', { revision: 0, targetUrl: 'https://receiver.fixture.org/hooks/crm', events, enabled }); assert.equal(r.status, 200); return r.body.data; }
async function inquiry() {
    const p = { schemaVersion: '1.0', sourceSystem: 'globalsite', externalInquiryId: randomUUID(), site: { id: 'fixture-site', name: 'Fictional Site' }, submittedAt: new Date().toISOString(), contact: { name: 'Fictional Buyer', email: 'buyer@' + randomUUID() + '.example.invalid', phone: '', company: 'Fictional Buyer', country: 'Germany' }, products: [], quantity: null, message: 'Please discuss product options.', attachments: [], source: { pageUrl: 'https://fixture.example.invalid/contact', referrer: null, utm: { source: null, medium: null, campaign: null, term: null, content: null }, device: 'desktop', firstVisitAt: null }, spamScore: 0 };
    const r = await f.request('/inquiries', p);
    assert.equal(r.status, 201);
    return { ...r.body.data, externalInquiryId: p.externalInquiryId };
}
async function stage(id: string, toStatus = 'won') {
    const { updateCustomer } = await import('../src/services/customer.service');
    await f.asA(() => updateCustomer(id, { status: toStatus } as any, actor(), { systemStatus: true }));
}
const tick = () => f.asA(() => s.tickWebhookConfig(String(currentConfig!), String(f.project._id)));
let currentConfig: string;
async function setup(events = ['lead.status_changed']) { const c = await config(events); currentConfig = c.config.id; return c; }
async function rows() { return f.asA(() => f.m.IntegrationWebhookEvent.find({}).select('+secret').sort({ _id: 1 })); }
async function due() { await f.asA(() => f.m.IntegrationWebhookEvent.updateMany({ status: 'pending' }, { $set: { nextAttemptAt: new Date(0) } })); }
test('C4 HTTP contract: private roles, explicit projects, CSRF, one-time secret, encrypted persistence and audited changes', async () => {
    assert.equal((await call('GET')).body.data.config, null);
    const input = { revision: 0, targetUrl: 'https://receiver.fixture.org/hooks/crm', events: ['deal.won'], enabled: false };
    assert.equal((await call('PUT', '/webhook', input, f.viewer)).status, 403);
    assert.equal((await call('GET', '/webhook', undefined, f.manager, String(f.other._id))).status, 404);
    assert.equal((await call('PUT', '/webhook', { ...input, unexpected: true })).status, 422);
    const service = await fetch(f.base + '/api/projects/integrations/webhook', { headers: { Authorization: 'Bearer ' + f.issued.token, 'X-Project-Id': String(f.project._id) } });
    assert.equal(service.status, 401);
    const cookie = await fetch(f.base + '/api/projects/integrations/webhook', { method: 'PUT', headers: { Cookie: 'cdlm_access=' + f.tokenFor(f.manager) + '; cdlm_csrf=fictional', 'X-Project-Id': String(f.project._id), 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(cookie.status, 403);
    const first = await config(['deal.won'], false);
    assert(/^[a-f0-9]{64}$/.test(first.signingSecret));
    const record = await f.asA(async () => await f.m.IntegrationWebhook.findById(first.config.id).select('+secret'));
    assert(!JSON.stringify(record).includes(first.signingSecret));
    const get = await call('GET');
    assert(!JSON.stringify(get.body).includes(first.signingSecret));
    assert(!('secret' in get.body.data.config));
    const saved = await call('PUT', '/webhook', { ...input, revision: 1 });
    assert.equal(saved.body.data.signingSecret, null);
    assert.equal((await call('POST', '/webhook/rotate-secret', { revision: 999 })).status, 409);
    const rotated = await call('POST', '/webhook/rotate-secret', { revision: 1 });
    assert.equal(rotated.status, 200);
    assert(rotated.body.data.signingSecret !== first.signingSecret);
    const audit = await f.asA(() => f.m.AuditLog.find({ action: { $in: ['integration.webhook.saved', 'integration.webhook.rotated'] } }));
    assert(audit.length >= 2);
    assert(!JSON.stringify(audit).includes(first.signingSecret));
    const foreign = await f.tenant.runWithTenant({ organizationId: String(f.foreign._id) }, async () => await f.m.IntegrationWebhook.findById(first.config.id));
    assert(foreign === null, 'Foreign organization must not read webhook configuration');
});
test('HMAC verifies exact raw bytes, timestamp window and tampering; receiver must persist event id dedupe', async () => {
    const { signWebhook, verifyWebhookSignature } = await import('../src/services/integration-webhook-signature'), key = randomBytes(32).toString('hex'), body = Buffer.from('{"eventId":"fictional"}'), t = String(Math.floor(Date.now() / 1000)), sig = signWebhook(body, t, key);
    assert(verifyWebhookSignature(body, t, sig, key));
    assert(!verifyWebhookSignature(Buffer.concat([body, Buffer.from(' ')]), t, sig, key));
    assert(!verifyWebhookSignature(body, t, sig, key, Date.now() + 301000));
    assert(!verifyWebhookSignature(body, t, sig, key, Date.now() - 301000));
    assert(!verifyWebhookSignature(body, t, 'v1=bad', key));
});
test('public HTTPS target rejects loopback, private/mixed DNS, metadata, credentials, query, ports and redirects', async () => {
    for (const url of ['http://public.org/a', 'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://169.254.169.254/a', 'https://user:pass@public.org/a', 'https://public.org:8443/a', 'https://public.org/a?key=fictional']) {
        if (url.includes('127.') || url.includes('10.0.') || url.includes('169.'))
            mock.method(net.webhookNetwork, 'lookup', async () => [{ address: new URL(url).hostname, family: 4 }] as any);
        await assert.rejects(net.webhookTarget(url));
        mock.restoreAll();
        mock.method(net.webhookNetwork, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }] as any);
    }
    mock.method(net.webhookNetwork, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }, { address: '192.168.1.4', family: 4 }] as any);
    await assert.rejects(net.webhookTarget('https://public.org/a'));
});
test('canonical customer stage source fans out only to same-project earlier GlobalSite inquiries, once per event and type', async () => {
    await setup(['lead.status_changed', 'deal.won', 'deal.lost']);
    const linked = await inquiry();
    await stage(linked.customerId);
    let count = 0;
    mock.method(s.webhookTransport, 'post', async () => { count++; return { status: 204 }; });
    for (let n = 0; n < 6; n++)
        await tick();
    const captured = await rows();
    assert.equal(captured.length, 2);
    const bodies = captured.map(e => JSON.parse(s.eventBody(e).toString()));
    assert.deepEqual(new Set(bodies.map(b => b.type)), new Set(['lead.status_changed', 'deal.won']));
    assert(bodies.every(b => b.data.externalInquiryId === linked.externalInquiryId && b.data.customerId === linked.customerId));
    const source=await f.asA(()=>f.m.CustomerEvent.findOne({customerId:linked.customerId,type:'status_changed'}));assert(bodies.every(b=>b.data.sourceEventId===String(source._id)));
    const v = ajv.compile({ ...spec.components.schemas.GlobalSiteC4Event, components: spec.components });
    bodies.forEach(b => assert(v(b), ajv.errorsText(v.errors)));
    assert.equal(count, 2);
    const local = await f.asA(() => f.m.Customer.create({ projectId: f.project._id, name: 'Fictional Local', status: 'pending' }));
    await stage(String(local._id), 'lost');
    const other = await f.asA(() => f.m.Customer.create({ projectId: f.another._id, name: 'Fictional Other', status: 'pending', globalSiteSource: true }));
    await f.asA(() => f.m.CustomerEvent.create({ projectId: f.another._id, customerId: other._id, type: 'status_changed', fromStatus: 'pending', toStatus: 'won', at: new Date() }));
    for (let n = 0; n < 6; n++)
        await tick();
    assert.equal((await rows()).length, 2);
});
test('real HTTP delivery is signed and DNS-pinned; failed acknowledgement retries same payload/id and receiver deduplicates', async () => {
    const c = await setup(['deal.won']), linked = await inquiry();
    await stage(linked.customerId);
    let server: Server | undefined;
    const received: {
        bytes: Buffer;
        headers: http.IncomingHttpHeaders;
    }[] = [];
    const seen = new Set<string>();
    let effects = 0, requests = 0;
    try {
        server = http.createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', b => chunks.push(b)); req.on('end', () => { const bytes = Buffer.concat(chunks), p = JSON.parse(bytes.toString()), { verifyWebhookSignature } = require('../src/services/integration-webhook-signature'); assert(verifyWebhookSignature(bytes, String(req.headers['x-globalcrm-timestamp']), String(req.headers['x-globalcrm-signature']), c.signingSecret)); assert.equal(req.headers['x-globalcrm-event-id'], p.eventId); received.push({ bytes, headers: req.headers }); if (!seen.has(p.eventId)) {
            seen.add(p.eventId);
            effects++;
        } const n = ++requests; res.statusCode = n === 1 ? 500 : n === 3 ? 302 : 204; if (n === 3)
            res.setHeader('Location', '/private'); res.end(); }); });
        await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
        const port = (server.address() as any).port;
        mock.method(net.webhookNetwork, 'request', ((url: any, options: any, cb: any) => { assert.equal(new URL(url).hostname, 'receiver.fixture.org'); let pinned: any; options.lookup('receiver.fixture.org', {}, (_e: any, a: any) => { pinned = a; }); assert.equal(pinned, '8.8.8.8'); return http.request('http://127.0.0.1:' + port + '/sink', { method: options.method, headers: options.headers, agent: false }, cb); }) as any);
        await tick();
        let e = (await rows())[0];
        assert.equal(e.status, 'pending');
        assert(e.nextAttemptAt.getTime() > Date.now());
        await due();
        await tick();
        e = (await rows())[0];
        assert.equal(e.status, 'delivered');
        assert.equal(e.attempts, 2);
        assert.equal(effects, 1);
        assert.equal(received.length, 2);
        assert.deepEqual(received[0].bytes, received[1].bytes);
        const logs = await call('GET', '/webhook/deliveries/' + e._id + '/attempts');
        assert.equal(logs.body.data.items.length, 2);
        assert(!JSON.stringify(logs.body).includes(c.signingSecret));
        assert(!JSON.stringify(logs.body).includes(linked.externalInquiryId));
        assert(!JSON.stringify(logs.body).includes('receiver.fixture.org'));
        const a = await f.asA(() => f.m.IntegrationWebhookAttempt.find({ deliveryId: e._id }));
        assert.equal(a.length, 2);
        const redirect = await net.postWebhook('https://receiver.fixture.org/hooks/crm', received[1].bytes, Object.fromEntries(Object.entries(received[1].headers).filter(([k]) => k.startsWith('x-globalcrm-')).map(([k, v]) => [k, String(v)])));
        assert.equal(redirect.status, 302);
        assert.equal(received.length, 3);
    }
    finally {
        if (server)
            await new Promise<void>(r => server!.close(() => r()));
    }
});
test('bounded retry exhaustion, manual redelivery, configuration generation cancellation and fencing stop stale sends', async () => {
    const c = await setup(['deal.lost']), linked = await inquiry();
    await stage(linked.customerId, 'lost');
    let count = 0;
    mock.method(s.webhookTransport, 'post', async () => { count++; throw Error('fictional failure, do not log'); });
    for (let n = 0; n < 8; n++) {
        await due();
        await tick();
    }
    const e = (await rows())[0];
    assert.equal(e.status, 'failed');
    assert.equal(e.attempts, 8);
    await tick();
    assert.equal(count, 8);
    assert.equal((await call('POST', '/webhook/deliveries/' + e._id + '/retry', {})).status, 200);
    mock.method(s.webhookTransport, 'post', async () => ({ status: 204 }));
    await tick();
    assert.equal((await rows())[0].status, 'delivered');
    await call('POST', '/webhook/deliveries/' + e._id + '/retry', {});
    const changed = await call('PUT', '/webhook', { revision: c.config.revision, targetUrl: 'https://other.fixture.org/receive', events: ['deal.lost'], enabled: false });
    assert.equal(changed.status, 200);
    assert.equal((await rows())[0].status, 'cancelled');
    assert.equal((await call('POST', '/webhook/deliveries/' + e._id + '/retry', {})).status, 409);
    await tick();
    assert.equal(count, 8);
});
test('quotation first sent mark is durable across later acceptance, hidden from old DTOs and delivered only once', async () => {
    await setup(['quotation.sent']);
    const linked = await inquiry(), q = await import('../src/services/quotation.service');
    const draft = await f.asA(() => q.createQuotation(linked.customerId, { title: 'Fictional quotation', items: [{ productName: 'Fixture Pump', quantity: 1, unitPrice: 12 }], currency: 'USD', status: 'draft' } as any, actor()));
    await f.asA(() => q.updateQuotationStatus(linked.customerId, draft.id, { status: 'sent' } as any, actor()));
    const first = await f.asA(() => f.m.Quotation.findById(draft.id).select('+globalSiteSentAt'));
    assert(first.globalSiteSentAt);
    await f.asA(() => q.updateQuotationStatus(linked.customerId, draft.id, { status: 'accepted' } as any, actor()));
    let sends = 0;
    mock.method(s.webhookTransport, 'post', async () => { sends++; return { status: 204 }; });
    for (let n = 0; n < 5; n++)
        await tick();
    const captured = await rows();
    assert.equal(captured.length, 1);
    assert.equal(sends, 1);
    const body = JSON.parse(s.eventBody(captured[0]).toString());
    assert.equal(body.data.quotationId, draft.id);
    assert.equal(body.data.externalInquiryId, linked.externalInquiryId);
    assert(!('globalSiteSentAt' in draft));
    await f.asA(() => q.updateQuotation(linked.customerId, draft.id, { status: 'sent' } as any, actor()));
    const second = await f.asA(() => f.m.Quotation.findById(draft.id).select('+globalSiteSentAt'));
    assert.equal(second.globalSiteSentAt.getTime(), first.globalSiteSentAt.getTime());
});
test('two workers serialize one send; configuration changes are rejected while leased and manual resend keeps identity', async () => {
    const c = await setup(['deal.won']), linked = await inquiry();
    await stage(linked.customerId);
    let sends = 0;
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(r => release = r), begun = new Promise<void>(r => started = r);
    mock.method(s.webhookTransport, 'post', async () => { sends++; started(); await gate; return { status: 204 }; });
    const first = tick();
    await Promise.race([begun, new Promise((_, reject) => setTimeout(() => reject(Error('Fixture did not start delivery')), 5000))]);
    await tick();
    assert.equal(sends, 1);
    assert.equal((await call('PUT', '/webhook', { revision: c.config.revision, targetUrl: c.config.targetUrl, events: ['deal.won'], enabled: false })).status, 409);
    release();
    await first;
    const e = (await rows())[0];
    await call('POST', '/webhook/deliveries/' + e._id + '/retry', {});
    mock.method(s.webhookTransport, 'post', async () => ({ status: 204 }));
    await tick();
    assert.equal((await rows())[0].status, 'delivered');
});
test('expired last-attempt lease stops at eight, marks unknown result and deleted inquiry cancels subsequent manual replay', async () => {
    await setup(['deal.won']);
    const linked = await inquiry();
    await stage(linked.customerId);
    let calls = 0;
    mock.method(s.webhookTransport, 'post', async () => { calls++; return { status: 500 }; });
    await tick();
    const e = (await rows())[0];
    await f.asA(async () => { await f.m.IntegrationWebhookEvent.updateOne({ _id: e._id }, { $set: { status: 'running', attempts: 8, nextAttemptAt: new Date(0) } }); await f.m.IntegrationWebhookAttempt.create({ projectId: f.project._id, deliveryId: e._id, attempt: 8, status: 'started', startedAt: new Date() }); await f.m.IntegrationWebhook.updateOne({ _id: currentConfig }, { $set: { ioOwner: 'fictional-crashed-worker', ioUntil: new Date(0) } }); });
    await tick();
    assert.equal(calls, 1);
    assert.equal((await rows())[0].status, 'failed');
    const a = await f.asA(() => f.m.IntegrationWebhookAttempt.findOne({ deliveryId: e._id, attempt: 8 }));
    assert.equal(a.status, 'unknown');
    await call('POST', '/webhook/deliveries/' + e._id + '/retry', {});
    await f.asA(() => f.m.IntegrationInquiry.deleteOne({ _id: linked.inquiryId }));
    await tick();
    assert.equal((await rows())[0].status, 'cancelled');
    assert.equal(calls, 1);
});
test('durable source fanout resumes beyond fifty inquiries and never assigns an earlier outcome to a later inquiry', async () => {
    await setup(['deal.won']);
    const linked = await inquiry();
    await f.asA(() => f.m.IntegrationInquiry.insertMany(Array.from({ length: 50 }, (_, i) => ({ projectId: f.project._id, customerId: linked.customerId, externalInquiryId: 'fictional-batch-' + randomUUID() + '-' + i, requestHash: 'fictional', secret: { fixture: true }, submittedAt: new Date(), sourceSystem: 'globalsite' }))));
    await stage(linked.customerId);
    mock.method(s.webhookTransport, 'post', async () => ({ status: 204 }));
    await tick();
    assert.equal((await rows()).length, 50);
    await tick();
    assert.equal((await rows()).length, 51);
    await f.asA(() => f.m.IntegrationInquiry.create({ projectId: f.project._id, customerId: linked.customerId, externalInquiryId: 'fictional-late-' + randomUUID(), requestHash: 'fictional', secret: { fixture: true }, submittedAt: new Date(), sourceSystem: 'globalsite' }));
    for (let i = 0; i < 4; i++)
        await tick();
    assert.equal((await rows()).length, 51);
});

test('migration 010 creates new tenant uniqueness and quotation source indexes idempotently',async()=>{
 const {globalSiteWebhookMigration}=await import('../src/migrations/010-globalsite-webhooks');
 await globalSiteWebhookMigration.up(f.db.connection);await globalSiteWebhookMigration.up(f.db.connection);
 const indexes=await f.m.IntegrationWebhook.collection.indexes();
 assert(indexes.some((i:any)=>i.unique&&i.key.organizationId===1&&i.key.projectId===1));
 const q=await f.db.connection.collection('quotations').indexes();assert(q.some((i:any)=>i.key.globalSiteSentAt===1));
});

test('scheduler reads only global task metadata then restores each organization for delivery',async()=>{
 await setup(['deal.won']);const linked=await inquiry();await stage(linked.customerId);
 const foreign=await call('PUT','/webhook',{revision:0,targetUrl:'https://receiver.fixture.org/hooks/crm',events:['deal.won'],enabled:true},f.outsider,String(f.other._id));assert.equal(foreign.status,200);
 await f.tenant.runWithTenant({organizationId:String(f.foreign._id)},async()=>{
  const customer=await f.m.Customer.create({organizationId:f.foreign._id,projectId:f.other._id,name:'Fictional Tenant B',status:'won',globalSiteSource:true});
  await f.m.IntegrationInquiry.create({projectId:f.other._id,customerId:customer._id,externalInquiryId:'fictional-tenant-b',requestHash:'fictional',secret:{fixture:true},submittedAt:new Date(),sourceSystem:'globalsite'});
  await f.m.CustomerEvent.create({projectId:f.other._id,customerId:customer._id,type:'status_changed',fromStatus:'pending',toStatus:'won',at:new Date()});
 });
 const delivered:string[]=[];mock.method(s.webhookTransport,'post',async(_url,body)=>{delivered.push(JSON.parse(body.toString()).projectId);return {status:204};});
 await f.asA(()=>s.tickWebhooks());assert.deepEqual(new Set(delivered),new Set([String(f.project._id),String(f.other._id)]));
});
