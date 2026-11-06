import { before, after, beforeEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { inquiryFixture } from './fixtures/integration-inquiry';
let f: Awaited<ReturnType<typeof inquiryFixture>>;
before(async () => { f = await inquiryFixture(); });
after(async () => { mock.restoreAll(); await f?.cleanup(); });
beforeEach(() => mock.restoreAll());
const spec = yaml.load(readFileSync(join(__dirname, '../../docs/integration/integration-v1.openapi.yaml'), 'utf8')) as any;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
function check(r: any) { const s = spec.paths['/inquiries'].post.responses[r.status]?.content?.['application/json']?.schema; assert(s, 'Undocumented status ' + r.status); const v = ajv.compile({ ...s, components: spec.components }); assert(v(r.body), ajv.errorsText(v.errors)); }
function body(extra: any = {}) { return { schemaVersion: '1.0', sourceSystem: 'globalsite', externalInquiryId: randomUUID(), site: { id: 'fixture-site', name: 'Fictional Site' }, submittedAt: new Date().toISOString(), contact: { name: 'Fictional Buyer', email: randomUUID() + '@example.invalid', phone: '', company: 'Fictional Buyer Company', country: 'Germany' }, products: [{ globalSiteProductId: 'fixture-product', crmProductId: String(f.product._id), name: 'Fixture Pump' }], quantity: 12, message: 'Please discuss product options for our purchasing project.', attachments: [], source: { pageUrl: 'https://fixture.example.invalid/products/', referrer: null, utm: { source: 'fixture', medium: null, campaign: null, term: null, content: null }, device: 'desktop', firstVisitAt: null }, spamScore: 0, ...extra }; }
test('C3 HTTP contract: required scope, project binding, strict lengths, valid response, request logs redact body', async () => {
    for (const [payload, opts, status] of [[body(), { token: f.limited.token }, 403], [body(), { project: String(f.other._id) }, 404], [body(), { project: String(f.another._id) }, 404], [body({ message: 'x'.repeat(8001) }), {}, 422], [body({ unexpected: 'no' }), {}, 422]] as any[]) {
        const r = await f.request('/inquiries', payload, opts);
        assert.equal(r.status, status);
        check(r);
    }
    const p = body(), r = await f.request('/inquiries', p);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    check(r);
    const row = await f.asA(() => f.m.IntegrationInquiry.findById(r.body.data.inquiryId).select('+secret'));
    assert(!JSON.stringify(row).includes(p.message));
    assert(!JSON.stringify(row).includes(p.contact.email));
    const c = await f.asA(() => f.m.Customer.findById(r.body.data.customerId));
    assert.equal(c.status, 'pending');
    assert.equal(c.leadSource, 'globalsite');
    assert.equal(String(c.ownerId), String(f.manager._id));
    const notices = await f.userRequest('/globalsite-inquiries/notifications');
    assert.equal(notices.status, 200);
    assert(notices.body.data.items.some((n: any) => n.id === r.body.data.inquiryId));
    await new Promise(r => setTimeout(r, 50));
    const logs = await f.asA(() => f.m.IntegrationRequestLog.find({ route: '/api/integrations/v1/inquiries' }));
    assert(!JSON.stringify(logs).includes(p.contact.email));
    assert(!JSON.stringify(logs).includes(p.message));
});
test('concurrent idempotency and business identity preserve one inquiry across keys/credentials', async () => {
    const p = body({ contact: { name: 'Fictional Repeat', email: randomUUID() + '@repeat.invalid', phone: '', company: 'Fictional Repeat', country: '' } }), key = randomUUID();
    const replies = await Promise.all(Array.from({ length: 4 }, () => f.request('/inquiries', p, { key })));
    assert(replies.every(r => r.status === 201), JSON.stringify(replies.map(r => r.body)));
    replies.forEach(r => assert.deepEqual(r.body.data, replies[0].body.data));
    const replay = await f.request('/inquiries', p, { key: randomUUID() });
    assert.deepEqual(replay.body.data, replies[0].body.data);
    const changed = await f.request('/inquiries', { ...p, message: 'Changed body' }, { key });
    assert.equal(changed.status, 409);
    const another = await f.asA(() => f.credential.createCredential({ name: 'FICTIONAL replacement', projectIds: [String(f.project._id)], scopes: ['inquiries:write'] }));
    assert.deepEqual((await f.request('/inquiries', p, { token: another.token, key: randomUUID() })).body.data, replies[0].body.data);
    assert.equal(await f.asA(() => f.m.IntegrationInquiry.countDocuments({ externalInquiryId: p.externalInquiryId })), 1);
});
test('email/domain matching preserves sales fields and other integration references; public email domains stay separate', async () => {
    const email = 'buyer-' + randomUUID() + '@business.invalid';
    const existing = await f.asA(() => f.m.Customer.create({ projectId: f.project._id, name: 'Sales maintained', email, status: 'negotiating', ownerId: f.manager._id, externalSystem: 'existing', externalId: 'old-reference', leadSource: 'referral' }));
    const p = body({ contact: { name: 'Fictional New Name', email, phone: '', company: 'New Company', country: 'Germany' } });
    const r = await f.request('/inquiries', p);
    assert.equal(r.body.data.customerId, String(existing._id));
    const second = await f.request('/inquiries', body({ contact: { ...p.contact, email: 'another-' + randomUUID() + '@business.invalid' } }));
    assert.equal(second.body.data.customerId, String(existing._id));
    const current = await f.asA(() => f.m.Customer.findById(existing._id));
    assert.equal(current.name, 'Sales maintained');
    assert.equal(current.status, 'negotiating');
    assert.equal(current.externalSystem, 'existing');
    assert.equal(current.leadSource, 'referral');
    const list = await f.userRequest('/customers?leadSource=globalsite');
    assert(list.body.data.items.some((c: any) => c.id === String(existing._id)));
    const one = await f.request('/inquiries', body({ contact: { ...p.contact, email: randomUUID() + '@qq.com' } })), two = await f.request('/inquiries', body({ contact: { ...p.contact, email: randomUUID() + '@qq.com' } }));
    assert.notEqual(one.body.data.customerId, two.body.data.customerId);
});
test('private views enforce customer assignment and organization; reply draft uses existing writer and suppression', async () => {
    const p = body({ contact: { name: 'Fictional Reply', email: randomUUID() + '@reply.invalid', phone: '', company: '', country: '' } }), r = await f.request('/inquiries', p), id = r.body.data.inquiryId;
    const detail = await f.userRequest('/globalsite-inquiries?customerId=' + r.body.data.customerId);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.items[0].message, p.message);
    assert.equal((await f.userRequest('/globalsite-inquiries/' + id + '/reply-draft', {}, f.viewer)).status, 403);
    assert.equal((await f.userRequest('/globalsite-inquiries/' + id + '/reply-draft', {}, f.outsider, String(f.other._id))).status, 404);
    const draft = await f.userRequest('/globalsite-inquiries/' + id + '/reply-draft', {});
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.data.status, 'draft');
    const letter = await f.asA(() => f.m.DevelopmentLetter.findById(draft.body.data.letterId));
    assert.equal(letter.recipientEmail, p.contact.email);
    assert.equal(letter.status, 'draft');
    assert.equal((await f.userRequest('/globalsite-inquiries/' + id + '/reply-draft', {})).body.data.letterId, draft.body.data.letterId);
    await f.asA(async () => { const { suppressEmail } = await import('../src/services/mail-compliance.service'); await suppressEmail({ projectId: String(f.project._id), email: p.contact.email, reason: 'manual', source: 'admin' }); });
    assert.equal((await f.userRequest('/globalsite-inquiries/' + id + '/reply-draft', {})).status, 409);
    assert.equal((await f.userRequest('/globalsite-inquiries/' + id + '/read', {})).status, 200);
});
test('attachment failure does not roll back inquiry; subsequent download is bounded, hashed and private', async () => {
    const bytes = Buffer.from('%PDF-1.7\nFictional fixture\n%%EOF'), attachment = { id: randomUUID(), fileName: 'fictional.pdf', downloadUrl: 'https://files.example.invalid/signed', expiresAt: new Date(Date.now() + 3600000).toISOString(), mime: 'application/pdf', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const r = await f.request('/inquiries', body({ attachments: [attachment] }));
    assert.equal(r.status, 201);
    const id = r.body.data.inquiryId;
    const worker = await import('../src/services/integration-inquiry-worker.service');
    mock.method(worker.inquiryAttachmentTransport, 'download', async () => { throw Error('synthetic failure'); });
    const claim = () => f.asA(() => f.m.IntegrationInquiryAttachment.findOneAndUpdate({ inquiryId: id }, { $set: { status: 'running', owner: 'fixture', leaseUntil: new Date(Date.now() + 60000) }, $inc: { fence: 1, attempts: 1 } }, { new: true }));
    await f.asA(async () => worker.processInquiryAttachment(await claim()));
    assert(await f.asA(() => f.m.IntegrationInquiry.findById(id)));
    assert.equal((await f.asA(() => f.m.IntegrationInquiryAttachment.findOne({ inquiryId: id }))).errorCode, 'ATTACHMENT_DOWNLOAD_FAILED');
    (worker.inquiryAttachmentTransport.download as any).mock.mockImplementation(async () => bytes);
    await f.asA(async () => worker.processInquiryAttachment(await claim()));
    const detail = (await f.userRequest('/globalsite-inquiries?customerId=' + r.body.data.customerId)).body.data.items[0];
    assert.equal(detail.attachments[0].status, 'stored');
    assert(!JSON.stringify(detail).includes(attachment.downloadUrl));
    const download = await fetch(f.base + detail.attachments[0].url, { headers: { Authorization: 'Bearer ' + f.tokenFor(f.manager), 'X-Project-Id': String(f.project._id) } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const isolated = await fetch(f.base + detail.attachments[0].url, { headers: { Authorization: 'Bearer ' + f.tokenFor(f.outsider), 'X-Project-Id': String(f.other._id) } });
    assert.equal(isolated.status, 404);
});
test('attachment transport rejects unconfigured/internal sources, redirects and oversized bodies', async () => {
    const http = await import('node:http'), net = await import('../src/services/integration-download.service'), env = (await import('../src/config/env')).default;
    let targetHits = 0;
    const server = http.createServer((req, res) => { if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/target' });
        res.end();
    }
    else if (req.url === '/large') {
        res.end(Buffer.alloc(200));
    }
    else {
        targetHits++;
        res.end('fixture');
    } });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const origin = 'http://127.0.0.1:' + (server.address() as any).port, saved = { origins: env.GLOBALSITE_ATTACHMENT_ORIGINS, local: env.GLOBALSITE_ALLOW_LOCAL, mode: env.NODE_ENV };
    try {
        env.GLOBALSITE_ATTACHMENT_ORIGINS = '';
        env.GLOBALSITE_ALLOW_LOCAL = true;
        await assert.rejects(() => net.downloadInquiryAttachment(origin + '/file', 100), /ATTACHMENT_SOURCE_NOT_ALLOWED/);
        env.GLOBALSITE_ATTACHMENT_ORIGINS = origin;
        assert.equal((await net.downloadInquiryAttachment(origin + '/file', 100)).toString(), 'fixture');
        await assert.rejects(() => net.downloadInquiryAttachment(origin + '/redirect', 100));
        assert.equal(targetHits, 1);
        await assert.rejects(() => net.downloadInquiryAttachment(origin + '/large', 100));
        env.NODE_ENV = 'production';
        await assert.rejects(() => net.downloadInquiryAttachment(origin + '/file', 100), /ATTACHMENT_SOURCE_NOT_ALLOWED/);
        env.NODE_ENV = 'test';
        env.GLOBALSITE_ATTACHMENT_ORIGINS = 'https://public.example.invalid';
        mock.method(net.inquiryDownloadNetwork, 'lookup', async () => [{ address: '10.0.0.1', family: 4 }]);
        await assert.rejects(() => net.downloadInquiryAttachment('https://public.example.invalid/signed', 100), /ATTACHMENT_URL_UNSAFE/);
    }
    finally {
        env.GLOBALSITE_ATTACHMENT_ORIGINS = saved.origins;
        env.GLOBALSITE_ALLOW_LOCAL = saved.local;
        env.NODE_ENV = saved.mode;
        await new Promise<void>(r => server.close(() => r()));
    }
});
