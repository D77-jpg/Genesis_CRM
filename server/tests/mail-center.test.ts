import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { ImapFlow } from 'imapflow';
import net from 'node:net';
import { spawn } from 'node:child_process';
import type { MongoMemoryServer } from 'mongodb-memory-server';

// Explicit overrides ensure tests NEVER send mail or access a supplied .env inbox.
process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'mock';
process.env.IMAP_ENABLED = 'false';
process.env.JWT_SECRET = randomUUID();
process.env.ADMIN_PASSWORD = `fixture-${randomUUID()}`;
process.env.UPLOAD_DIR = path.resolve('tmp/v21-attachments');
process.env.MAIL_RETRY_DELAY_MS = '100';
process.env.MAIL_MAX_ATTEMPTS = '3';
process.env.TRACKING_BASE_URL = 'https://crm.fixture.test';
process.env.CORS_ALLOW_PRIVATE_NETWORK = 'true';
process.env.CORS_LAN_PORTS = '5173,4173';

let db: typeof import('mongoose');
let models: typeof import('../src/models');
let mailModels: typeof import('../src/models/MailMessage');
let sync: typeof import('../src/services/mail-sync.service');
let queue: typeof import('../src/services/mail-queue.service');
let security: typeof import('../src/services/mail-security');
let tracking: typeof import('../src/services/mail-tracking.service');
let config: Record<string, unknown>;
let server: Server;
let base: string;
// 测试数据库自举：有 MONGODB_URI 用之（CI service container），否则启动 MongoMemoryServer。
// 绝不读取 tmp/test-db.json（开发 fixture 遗留），绝不连接开发/生产库。
let mailTestMongoUri: string;
let memoryServer: MongoMemoryServer | undefined;
let adminToken: string, salesToken: string, otherToken: string, ironSalesToken: string;
let adminId: string, salesId: string, otherId: string, ironSalesId: string;
let projectId: string, ironhueProjectId: string;
let customerId: string, otherCustomerId: string;
let sentId: string, sentMessageId: string, incomingId: string, unknownId: string, threadId: string;
const suffix = Date.now();
const email = `customer.${suffix}@example.com`;
const sender = `unknown.${suffix}@example.com`;

async function request(method: string, url: string, token = adminToken, body?: unknown, expected = 200, selectedProject = projectId) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(selectedProject ? { 'X-Project-Id': selectedProject } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json() as { data: any; error?: { message: string } }; // API boundary assertions below validate concrete behavior.
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(json)}`);
  return json.data;
}
function mime(id: string, from = email, options: { reply?: string; subject?: string; attachment?: boolean; html?: string } = {}) {
  const headers = [`From: Customer <${from}>`, 'To: sales@example.com', 'Cc: copy@example.com', `Message-ID: <${id}@fixture.test>`, `Subject: ${options.subject || 'Re: V2.1 proposal'}`, 'Date: Wed, 09 Sep 2026 12:00:00 +0000', 'MIME-Version: 1.0'];
  if (options.reply) headers.push(`In-Reply-To: ${options.reply}`, `References: ${options.reply}`);
  if (options.attachment) return Buffer.from([...headers, 'Content-Type: multipart/mixed; boundary="v21"', '', '--v21', 'Content-Type: text/html; charset=utf-8', '', options.html || '<p>Hello CRM</p><script>alert(1)</script><img src="https://tracker.invalid/pixel">', '--v21', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="quote.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4 fixture').toString('base64'), '--v21', 'Content-Type: application/x-msdownload', 'Content-Disposition: attachment; filename="malware.exe"', 'Content-Transfer-Encoding: base64', '', 'TVogZXhlY3V0YWJsZQ==', '--v21--'].join('\r\n'));
  return Buffer.from([...headers, 'Content-Type: text/html; charset=utf-8', '', options.html || '<p>Hello CRM</p>'].join('\r\n'));
}
async function scheduled(extra: Record<string, unknown> = {}) {
  const result = await request('POST', '/letters', salesToken, { customerId, subject: 'Scheduled', content: '<p>Future</p>', scheduledAt: new Date(Date.now() + 3600000).toISOString(), requestKey: randomUUID(), ...extra }, 201);
  return result.letter.id as string;
}
async function due(id: string) { await models.DevelopmentLetter.updateOne({ _id: id }, { $set: { nextAttemptAt: new Date(0) } }); }
const accepted = async () => ({ accepted: true, channel: 'mock' as const, durationMs: 0 });

before(async () => {
  if (process.env.MONGODB_URI) {
    mailTestMongoUri = process.env.MONGODB_URI;
  } else {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    mailTestMongoUri = memoryServer.getUri();
    process.env.MONGODB_URI = mailTestMongoUri; // 保证任何读取 env 的代码路径也指向自举实例
  }
  db = await import('mongoose');
  await db.default.connect(mailTestMongoUri, { dbName: `v21_mail_tests_${suffix}` });
  models = await import('../src/models'); mailModels = await import('../src/models/MailMessage');
  sync = await import('../src/services/mail-sync.service'); queue = await import('../src/services/mail-queue.service'); security = await import('../src/services/mail-security'); tracking = await import('../src/services/mail-tracking.service');
  config = (await import('../src/config/env')).default as unknown as Record<string, unknown>;
  const projectService = await import('../src/services/project.service');
  await projectService.bootstrapProjects();
  projectId = String((await models.Project.findOne({ slug: 'genesis-bags' }))!._id);
  ironhueProjectId = String((await models.Project.findOne({ slug: 'ironhue' }))!._id);
  await Promise.all([models.Project.init(), models.Customer.init(), models.DevelopmentLetter.init(), mailModels.MailMessage.init(), mailModels.MailSyncState.init(), models.User.init(),
    models.UserMailAccount.init(), models.MailQuotaBucket.init(), models.MailAccountAudit.init()]);
  const auth = await import('../src/services/auth.service');
  for (const role of ['admin', 'sales', 'other']) {
    const user = await models.User.create({ username: `${role}${suffix}`, passwordHash: await models.hashPassword('fixture-password'), role: role === 'admin' ? 'admin' : 'user', status: 'active', projectIds: [projectId], defaultProjectId: projectId });
    const result = await auth.login(user.username, 'fixture-password');
    if (role === 'admin') { adminToken = result.token; adminId = String(user._id); }
    if (role === 'sales') { salesToken = result.token; salesId = String(user._id); }
    if (role === 'other') { otherToken = result.token; otherId = String(user._id); }
  }
  const ironSales = await models.User.create({ username: `iron${suffix}`, passwordHash: await models.hashPassword('fixture-password'), role: 'user', status: 'active', projectIds: [ironhueProjectId], defaultProjectId: ironhueProjectId });
  ironSalesId = String(ironSales._id);
  ironSalesToken = (await auth.login(ironSales.username, 'fixture-password')).token;
  const app = (await import('../src/app')).createApp();
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  customerId = (await request('POST', '/customers', salesToken, { name: 'V2.1 Customer', email }, 201)).id;
  otherCustomerId = (await request('POST', '/customers', otherToken, { name: 'Other Customer', email: `other.${suffix}@example.com` }, 201)).id;
});
after(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  if (db) {
    try { await db.default.connection.dropDatabase(); } catch { /* 尽量清理，不阻断收尾 */ }
    await db.default.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

test('01 JWT is required', async () => { await request('GET', '/mail', '', undefined, 401); });
test('02 immediate SMTP/mock send uses durable task and legacy result', async () => {
  const result = await request('POST', '/letters', salesToken, { customerId, subject: 'V2.1 proposal', content: '<p>Hello {{name}}</p>', requestKey: randomUUID() }, 201);
  assert.equal(result.delivered, true); assert.equal(result.channel, 'mock'); assert.equal(result.letter.status, 'sent');
  sentId = result.letter.id; sentMessageId = result.letter.messageId; threadId = result.letter.threadId;
  const job = await models.DevelopmentLetter.findById(sentId); assert.equal(job?.attempts, 1); assert.deepEqual(job?.history.map(h => h.status), ['queued', 'sending', 'sent']);
});
test('03 repeat/concurrent request key sends exactly once', async () => {
  const key = randomUUID(); const payload = { customerId, subject: 'Idempotent', content: '<p>One</p>', requestKey: key };
  const results = await Promise.all(Array.from({ length: 5 }, () => request('POST', '/letters', salesToken, payload, 201)));
  assert.equal(new Set(results.map(r => r.letter.id)).size, 1);
  const job = await models.DevelopmentLetter.findById(results[0].letter.id); assert.equal(job?.attempts, 1);
});
test('04 scheduled task is stored without SMTP delivery', async () => { const id = await scheduled(); const job = await models.DevelopmentLetter.findById(id); assert.equal(job?.status, 'scheduled'); assert.equal(job?.attempts, 0); await queue.processMailJob(id, accepted); assert.equal((await models.DevelopmentLetter.findById(id))?.attempts, 0); });
test('05 due scheduled task runs through atomic claim', async () => { const id = await scheduled(); await due(id); let sends = 0; await Promise.all(Array.from({ length: 8 }, () => queue.processMailJob(id, async () => { sends++; return accepted(); }))); assert.equal(sends, 1); assert.equal((await models.DevelopmentLetter.findById(id))?.status, 'sent'); });
test('06 cancel prevents worker from sending', async () => { const id = await scheduled(); await request('POST', `/mail/${id}/cancel`, salesToken); await due(id); let sends = 0; await queue.processMailJob(id, async () => { sends++; return accepted(); }); assert.equal(sends, 0); assert.equal((await models.DevelopmentLetter.findById(id))?.status, 'cancelled'); });
test('07 transient failure backs off then succeeds', async () => { const id = await scheduled(); await due(id); await queue.processMailJob(id, async () => ({ accepted: false, channel: 'mock', durationMs: 0, retryable: true, error: 'temporary' })); let job = await models.DevelopmentLetter.findById(id); assert.equal(job?.status, 'retrying'); assert.ok(job?.nextAttemptAt && job.nextAttemptAt.getTime() > Date.now() - 100); await due(id); await queue.processMailJob(id, accepted); job = await models.DevelopmentLetter.findById(id); assert.equal(job?.status, 'sent'); assert.equal(job?.attempts, 2); });
test('08 bounded retries stop at max attempts', async () => { const id = await scheduled(); for (let i = 0; i < 3; i++) { await due(id); await queue.processMailJob(id, async () => ({ accepted: false, channel: 'mock', durationMs: 0, retryable: true, error: 'temporary' })); } assert.equal((await models.DevelopmentLetter.findById(id))?.status, 'failed'); });
test('09 ambiguous SMTP result is never automatically replayed', async () => { const id = await scheduled(); await due(id); await queue.processMailJob(id, async () => { throw new Error('secret-network-response'); }); const job = await models.DevelopmentLetter.findById(id); assert.equal(job?.status, 'failed'); assert.equal(job?.needsReview, true); assert.ok(!job?.error?.includes('secret-network')); await request('POST', `/letters/${id}/resend`, salesToken, {}, 409); });
test('10 stale sending recovered as needs-review, never resent', async () => { const id = await scheduled(); await models.DevelopmentLetter.updateOne({ _id: id }, { $set: { status: 'sending', claimedAt: new Date(0) } }); await queue.runMailQueue(); const job = await models.DevelopmentLetter.findById(id); assert.equal(job?.status, 'failed'); assert.equal(job?.needsReview, true); });
test('11 sender/customer permission revocation cancels pending mail', async () => { const id = await scheduled(); await models.Customer.updateOne({ _id: customerId }, { $set: { ownerId: otherId } }); await due(id); await queue.processMailJob(id, accepted); assert.equal((await models.DevelopmentLetter.findById(id))?.status, 'cancelled'); await models.Customer.updateOne({ _id: customerId }, { $set: { ownerId: salesId } }); });
test('12 inbound MIME matches customer normalized sender email', async () => { const doc = await sync.importMail(mime(`received-${suffix}`, email.toUpperCase(), { reply: sentMessageId, attachment: true }), 'fixture'); incomingId = String(doc._id); assert.equal(String(doc.customerId), customerId); assert.equal(doc.from, email); assert.equal(doc.to[0], 'sales@example.com'); assert.equal(doc.cc[0], 'copy@example.com'); assert.ok(doc.text.includes('Hello CRM')); });
test('13 duplicate Message-ID import is idempotent including concurrent imports', async () => { const docs = await Promise.all(Array.from({ length: 4 }, () => sync.importMail(mime(`received-${suffix}`), 'fixture'))); assert.deepEqual([...new Set(docs.map(d => String(d._id)))], [incomingId]); });
test('14 missing Message-ID uses stable source hash', async () => { const source = Buffer.from(`From: ${email}\r\nTo: sales@example.com\r\nSubject: No ID\r\n\r\nSame body`); const a = await sync.importMail(source, 'fixture'); const b = await sync.importMail(source, 'fixture'); assert.equal(String(a._id), String(b._id)); });
test('15 hostile HTML and tracking content removed', async () => { const doc = await mailModels.MailMessage.findById(incomingId); assert.ok(!/script|<img|tracker/.test(doc!.html)); const html = security.safeMailHtml('<svg onload=alert(1)></svg><a href="javascript:alert(1)">link</a><p style="background:url(https://bad)">safe</p><iframe srcdoc="bad"></iframe>'); assert.ok(!/onload|javascript|iframe|style=/.test(html)); assert.ok(html.includes('safe')); });
test('16 allowed attachment preserved and malicious attachment blocked', async () => { const doc = await mailModels.MailMessage.findById(incomingId).select('+attachments.filename'); assert.equal(doc?.attachments.length, 2); assert.ok(doc?.attachments[0].filename); assert.ok(doc?.attachments[1].blocked); assert.ok(!doc?.attachments[1].filename); });
test('17 attachment download needs JWT and customer scope', async () => { const doc = await mailModels.MailMessage.findById(incomingId); const id = String(doc!.attachments[0]._id); const url = `/mail/${incomingId}/attachments/${id}`; await request('GET', url, otherToken, undefined, 404); await request('GET', url, '', undefined, 401); const r = await fetch(base + url, { headers: { Authorization: `Bearer ${salesToken}` } }); assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition')!, /^attachment/); assert.equal(await r.text(), '%PDF-1.4 fixture'); });
test('18 attachment size, spoofed type and unsafe extension rejected', () => { assert.equal(security.attachmentAllowed('bad.exe', 'application/pdf', Buffer.from('%PDF-x'), 100), false); assert.equal(security.attachmentAllowed('fake.pdf', 'application/pdf', Buffer.from('MZ'), 100), false); assert.equal(security.attachmentAllowed('a.txt', 'text/plain', Buffer.from('12345'), 4), false); });
test('19 unknown email never creates a customer', async () => { const count = await models.Customer.countDocuments(); const doc = await sync.importMail(mime(`unknown-${suffix}`, sender), 'fixture'); unknownId = String(doc._id); assert.equal(doc.customerId, null); assert.equal(await models.Customer.countDocuments(), count); });
test('20 unknown mailbox remains admin-only while personal sync status is safe', async () => { await request('GET', '/mail?folder=unknown', salesToken, undefined, 404); await request('GET', `/mail/${unknownId}`, salesToken, undefined, 404); await request('POST', `/mail/${unknownId}/read`, salesToken, { read: true }, 404); await request('POST', `/mail/${unknownId}/link`, salesToken, { customerId }, 404); const status = await request('GET', '/mail/status', salesToken); assert.equal(status.enabled, false); await request('POST', '/mail/sync', salesToken, {}, 404); });
test('21 administrators see unknown mail; ordinary inbox does not leak', async () => { const unknown = await request('GET', '/mail?folder=unknown'); assert.ok(unknown.items.some((m: { id: string }) => m.id === unknownId)); const own = await request('GET', '/mail', salesToken); assert.ok(!own.items.some((m: { id: string }) => m.id === unknownId)); });
test('22 manual customer association exposes only to new owner', async () => { await request('POST', `/mail/${unknownId}/link`, adminToken, { customerId }); const d = await request('GET', `/mail/${unknownId}`, salesToken); assert.equal(d.customer.id, customerId); await request('GET', `/mail/${unknownId}`, otherToken, undefined, 404); await request('POST', `/mail/${unknownId}/link`, adminToken, { customerId: otherCustomerId }, 409); });
test('H-03 HTTP unknown-mail preview requires admin and cannot create customers without approval', async () => {
  const unknown = await sync.importMail(mime(`h03-agent-unknown-${suffix}`, `h03.${suffix}@safe-unknown.example`, { subject: 'Company: Example Trading' }), 'fixture');
  const id = String(unknown._id);
  const count = await models.Customer.countDocuments();
  const payload = { mailId: id, idempotencyKey: `h03-preview-${randomUUID()}` };
  await request('POST', '/agent/mail-customer/previews', salesToken, payload, 404);
  await request('POST', '/agent/mail-customer/previews', ironSalesToken, payload, 404, ironhueProjectId);
  const preview = await request('POST', '/agent/mail-customer/previews', adminToken, payload, 201);
  assert.equal(preview.sourceKind, 'mail');
  assert.equal(preview.sourceMailId, id);
  assert.ok(preview.facts.some((item: { field: string; mailId: string }) => item.field === 'email' && item.mailId === id));
  await request('GET', `/agent/scratchpad-customer/previews/${preview.id}`, salesToken, undefined, 404);
  await request('POST', `/agent/scratchpad-customer/previews/${preview.id}/confirm`, salesToken, {
    expectedVersion: preview.version, idempotencyKey: `h03-denied-${randomUUID()}`, duplicateAcknowledged: true }, 404);
  assert.equal(await models.Customer.countDocuments(), count);
  assert.equal(await models.DevelopmentLetter.countDocuments({ recipientEmail: unknown.from }), 0);
  assert.equal((await request('POST', '/agent/mail-customer/previews', adminToken, payload, 201)).id, preview.id);
});
test('H-03 personal-mailbox unknown message cannot be linked to another owner', async () => {
  const mail = await mailModels.MailMessage.create({ projectId, dedupKey: `personal-unknown-${randomUUID()}`,
    customerId: null, mailboxUserId: salesId, threadId: `personal-unknown-${randomUUID()}`,
    messageId: `<personal-unknown-${randomUUID()}@fixture.test>`, subject: 'Private inbox',
    from: `personal.${suffix}@private-mailbox.example`, to: ['sales@example.com'], text: 'Hello', sentAt: new Date() });
  await request('POST', `/mail/${mail._id}/link`, adminToken, { customerId: otherCustomerId }, 404);
  await request('GET', `/mail/${mail._id}`, otherToken, undefined, 404);
  assert.equal((await mailModels.MailMessage.findById(mail._id))?.customerId, null);
});
test('23 Message-ID and In-Reply-To join outgoing/incoming thread', async () => { const d = await request('GET', `/mail/${incomingId}`, salesToken); assert.equal(d.mail.threadId, threadId); assert.ok(d.thread.some((m: { id: string }) => m.id === sentId)); });
test('24 reply uses queue, original sender, Re: and reference headers', async () => { const result = await request('POST', `/mail/${incomingId}/reply`, salesToken, { subject: 'ignored', content: '<p>Thank you</p>', recipientEmail: 'wrong@example.com', requestKey: randomUUID() }, 201); const doc = await models.DevelopmentLetter.findById(result.letter.id); assert.equal(doc?.recipientEmail, email); assert.equal(doc?.subject, 'Re: V2.1 proposal'); assert.equal(doc?.attempts, 1); assert.equal(doc?.threadId, threadId); assert.ok(doc?.references.includes(`<received-${suffix}@fixture.test>`)); const next = await sync.importMail(mime(`second-${suffix}`, email, { reply: doc?.messageId }), 'fixture'); assert.equal(next.threadId, threadId); });
test('25 subject fallback stays within same customer', async () => { const doc = await sync.importMail(mime(`fallback-${suffix}`, email), 'fixture'); assert.equal(doc.threadId, threadId); const other = await sync.importMail(mime(`forged-${suffix}`, `other.${suffix}@example.com`, { reply: sentMessageId }), 'fixture'); assert.notEqual(other.threadId, threadId); });
test('26 read/unread is per user and can be toggled', async () => { await request('POST', `/mail/${incomingId}/read`, salesToken, { read: true }); assert.equal((await request('GET', `/mail/${incomingId}`, salesToken)).mail.read, true); assert.equal((await request('GET', `/mail/${incomingId}`, adminToken)).mail.read, false); await request('POST', `/mail/${incomingId}/read`, salesToken, { read: false }); assert.equal((await request('GET', `/mail/${incomingId}`, salesToken)).mail.read, false); });
test('27 existing customer Timeline includes received, sent and reply events', async () => { const timeline = await request('GET', `/customers/${customerId}/timeline`, salesToken); assert.ok(timeline.items.some((e: { type: string; mail?: { id: string } }) => e.type === 'mail_received' && e.mail?.id === incomingId)); assert.ok(timeline.items.filter((e: { type: string }) => e.type === 'letter').length >= 3); });
test('28 cross-owner outbound, cancellation, reply and legacy customer filters return 404', async () => { await request('GET', `/mail/${sentId}?direction=outbound`, otherToken, undefined, 404); await request('POST', `/mail/${sentId}/cancel`, otherToken, {}, 404); await request('POST', `/mail/${incomingId}/reply`, otherToken, { subject: 'reply', content: '<p>x</p>' }, 404); await request('GET', `/letters?customerId=${customerId}`, otherToken, undefined, 404); });
test('29 admin reads all owners and thread members remain scoped', async () => { assert.equal((await request('GET', `/mail/${incomingId}`)).customer.id, customerId); const original = await mailModels.MailMessage.findOne({ customerId: otherCustomerId }); await mailModels.MailMessage.updateOne({ _id: original!._id }, { $set: { threadId } }); const d = await request('GET', `/mail/${incomingId}`, salesToken); assert.ok(!d.thread.some((m: { id: string }) => m.id === String(original!._id))); });
test('30 invalid schedule and malformed API bodies rejected', async () => { await request('POST', '/letters', salesToken, { customerId, subject: 'Bad', content: '<p>x</p>', scheduledAt: new Date(0).toISOString() }, 400); await request('POST', `/mail/${incomingId}/read`, salesToken, { read: 'false' }, 422); await request('GET', '/mail/not-an-id', salesToken, undefined, 422); });
test('31 SMTP missing config fails without silently using mock', async () => { config.MAIL_TRANSPORT = 'smtp'; const mailer = await import('../src/services/mailer.service'); const r = await mailer.sendMail({ to: email, subject: 'test', html: '<p>x</p>' }); assert.equal(r.accepted, false); assert.equal(r.channel, 'smtp'); config.MAIL_TRANSPORT = 'mock'; });
test('32 raw credential-like errors never reach mail error messages', () => { for (const protocol of ['SMTP', 'IMAP'] as const) { const message = security.mailError({ code: 'EAUTH', message: 'password=TOPSECRET jwt=TOPSECRET' }, protocol); assert.ok(!message.includes('TOPSECRET')); assert.ok(message.includes('身份验证')); } });
test('33 IMAP missing config is recorded and next cycle remains usable', async () => { config.IMAP_ENABLED = true; config.IMAP_HOST = undefined; config.IMAP_USER = undefined; config.IMAP_PASSWORD = undefined; await sync.syncInbox(); const state = await mailModels.MailSyncState.findById(sync.mailboxKey()); assert.match(state!.lastError!, /配置不完整/); assert.ok(!state?.leaseOwner); });
test('34 IMAP sync persists UID cursor and isolates poison mail', async () => {
  config.IMAP_HOST = 'fixture.test'; config.IMAP_USER = 'fixture'; config.IMAP_PASSWORD = 'DO-NOT-LOG'; config.IMAP_SECURE = false;
  let attempts = 0;
  const fake = { on() {}, close() {}, async connect() {}, mailbox: { uidValidity: 1n, uidNext: 4 }, async getMailboxLock() { return { release() {} }; }, async search() { return [1, 2, 3]; }, async fetchOne(uid: number, query: { size?: boolean }) { if (query.size) return { size: 1024 }; if (uid === 2 && attempts++ === 0) throw new Error('DO-NOT-LOG'); return { source: mime(`imap-${suffix}-${uid}`) }; } };
  const factory = (options: any) => { assert.equal(options.logger, false); assert.equal(options.doSTARTTLS, true); return fake as unknown as ImapFlow; };
  await sync.syncInbox(factory); let state = await mailModels.MailSyncState.findById(sync.mailboxKey()); assert.equal(state?.lastUid, 3); assert.deepEqual(state?.failedUids.toObject(), [2]); assert.ok(!state?.lastError?.includes('DO-NOT-LOG'));
  await sync.syncInbox(factory); state = await mailModels.MailSyncState.findById(sync.mailboxKey()); assert.deepEqual(state?.failedUids.toObject(), []); assert.ok(state?.lastSyncAt); assert.equal(await mailModels.MailMessage.countDocuments({ messageId: `<imap-${suffix}-1@fixture.test>` }), 1);
});
test('35 IMAP authentication errors are sanitized and lease released', async () => { const fake = { on() {}, close() {}, async connect() { throw { authenticationFailed: true, message: 'DO-NOT-LOG' }; } }; await sync.syncInbox(() => fake as unknown as ImapFlow); const state = await mailModels.MailSyncState.findById(sync.mailboxKey()); assert.match(state!.lastError!, /身份验证/); assert.ok(!state?.leaseOwner); config.IMAP_ENABLED = false; });
test('36 worker disables a pending task for disabled sender', async () => { const id = await scheduled(); await models.User.updateOne({ _id: salesId }, { $set: { status: 'disabled' } }); await due(id); await queue.processMailJob(id, accepted); assert.equal((await models.DevelopmentLetter.findById(id))?.status, 'cancelled'); await models.User.updateOne({ _id: salesId }, { $set: { status: 'active' } }); });
test('37 deleting a customer removes email content and prevents reimport', async () => { const c = await request('POST', '/customers', adminToken, { name: 'Delete mail', email: `delete.${suffix}@example.com`, ownerId: adminId }, 201); const source = mime(`delete-${suffix}`, `delete.${suffix}@example.com`, { attachment: true }); const doc = await sync.importMail(source, 'fixture'); await request('DELETE', `/customers/${c.id}`); await request('GET', `/mail/${doc._id}`, adminToken, undefined, 404); const tombstone = await sync.importMail(source, 'fixture'); assert.equal(tombstone.deleted, true); assert.equal(tombstone.html, ''); assert.equal(tombstone.attachments.length, 0); });
test('38 oversized message and missing sender fail independently', async () => { await assert.rejects(sync.importMail(Buffer.from('Subject: Broken\r\n\r\nNo sender'), 'fixture')); const prior = config.IMAP_MAX_MESSAGE_SIZE; config.IMAP_MAX_MESSAGE_SIZE = 4; await assert.rejects(sync.importMail(Buffer.alloc(5), 'fixture')); config.IMAP_MAX_MESSAGE_SIZE = prior; const d = await sync.importMail(mime(`valid-after-broken-${suffix}`), 'fixture'); assert.ok(d._id); });

test('39 real Nodemailer SMTP protocol preserves headers and classifies 450/550', async () => {
  let rejection = 0; let data = ''; let deliveries = 0;
  const sockets = new Set<net.Socket>();
  const smtpServer = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.write('220 fixture ESMTP\r\n');
    let buffer = ''; let inData = false;
    socket.on('data', chunk => {
      buffer += chunk.toString(); let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (inData) { if (line === '.') { deliveries++; inData = false; socket.write('250 accepted\r\n'); } else data += line + '\r\n'; continue; }
        if (/^EHLO/i.test(line)) socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH/i.test(line)) socket.write('235 authenticated\r\n');
        else if (/^RCPT/i.test(line) && rejection) socket.write(`${rejection} rejected\r\n`);
        else if (/^DATA/i.test(line)) { inData = true; socket.write('354 send data\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 goodbye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>(r => smtpServer.listen(0, '127.0.0.1', r));
  const mailer = await import('../src/services/mailer.service');
  Object.assign(config, { MAIL_TRANSPORT: 'smtp', smtpConfigured: true, SMTP_HOST: '127.0.0.1', SMTP_PORT: (smtpServer.address() as net.AddressInfo).port, SMTP_SECURE: false, SMTP_REQUIRE_TLS: false, SMTP_USER: 'fixture', SMTP_PASS: 'fixture-only' });
  try {
    const payload = { to: 'fixture@example.com', subject: 'Protocol check', html: '<p>Fixture</p>', messageId: '<protocol@fixture>', inReplyTo: '<original@fixture>', references: ['<original@fixture>'] };
    const ok = await mailer.sendMail(payload); assert.equal(ok.accepted, true); assert.equal(deliveries, 1); assert.match(data, /Message-ID: <protocol@fixture>/i); assert.match(data, /In-Reply-To: <original@fixture>/i); assert.match(data, /References: <original@fixture>/i);
    rejection = 450; const temporary = await mailer.sendMail(payload); assert.equal(temporary.retryable, true); assert.equal(temporary.uncertain, false);
    rejection = 550; const permanent = await mailer.sendMail(payload); assert.equal(permanent.retryable, false); assert.equal(permanent.uncertain, false); assert.equal(deliveries, 1);
  } finally {
    mailer.closeMailer(); for (const socket of sockets) socket.destroy();
    await new Promise<void>(r => smtpServer.close(() => r()));
    Object.assign(config, { MAIL_TRANSPORT: 'mock', smtpConfigured: false, SMTP_USER: undefined, SMTP_PASS: undefined });
  }
});

test('40 new worker process resumes persisted scheduled task', async () => {
  const id = await scheduled(); await due(id);
  const child = spawn(process.execPath, ['--require', './tests/os-user-info.cjs', '--import', 'tsx', 'tests/resume-worker.ts', id], {
    cwd: process.cwd(), env: { ...process.env, MONGODB_URI: mailTestMongoUri, TEST_DB_NAME: `v21_mail_tests_${suffix}`, MAIL_TRANSPORT: 'mock', IMAP_ENABLED: 'false' }, stdio: 'pipe', windowsHide: true,
  });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const code = await new Promise<number | null>(r => child.on('exit', r));
  assert.equal(code, 0, output); const job = await models.DevelopmentLetter.findById(id); assert.equal(job?.status, 'sent'); assert.equal(job?.attempts, 1);
});

test('41 sent jobs cannot be cancelled or delivered twice', async () => { await request('POST', `/mail/${sentId}/cancel`, salesToken, {}, 409); let sends = 0; await queue.processMailJob(sentId, async () => { sends++; return accepted(); }); assert.equal(sends, 0); });
test('42 scheduled replies retain conversation and original recipient', async () => { const r = await request('POST', `/mail/${incomingId}/reply`, salesToken, { subject: 'Reply', content: '<p>Later</p>', scheduledAt: new Date(Date.now() + 600000).toISOString(), requestKey: randomUUID() }, 201); assert.equal(r.letter.status, 'scheduled'); const job = await models.DevelopmentLetter.findById(r.letter.id); assert.equal(job?.threadId, threadId); assert.equal(job?.recipientEmail, email); });
test('43 unknown mail cannot be replied to before association', async () => { const doc = await sync.importMail(mime(`another-unknown-${suffix}`, 'unmatched@example.com'), 'fixture'); await request('POST', `/mail/${doc._id}/reply`, adminToken, { subject: 'reply', content: '<p>x</p>' }, 400); });
test('44 pagination cannot expose another salesperson mail', async () => { const data = await request('GET', '/mail?limit=1&page=1', otherToken); assert.ok(data.items.length <= 1); assert.ok(data.items.every((m: { customerId: string }) => m.customerId === otherCustomerId)); });

test('45 concurrent jobs increment customer counter once each, including recovery', async () => {
  const before = (await models.Customer.findById(customerId))!.letterCount;
  const ids = await Promise.all(Array.from({ length: 5 }, () => scheduled()));
  await Promise.all(ids.map(due)); await Promise.all(ids.map(id => queue.processMailJob(id, accepted)));
  assert.equal((await models.Customer.findById(customerId))!.letterCount, before + 5);
  await models.DevelopmentLetter.updateMany({ _id: { $in: ids } }, { $set: { effectsPending: true } });
  await queue.runMailQueue(); assert.equal((await models.Customer.findById(customerId))!.letterCount, before + 5);
});
test('46 administrator resolves uncertainty without automatic resend', async () => {
  const id = await scheduled(); await due(id); await queue.processMailJob(id, async () => { throw new Error('ambiguous'); });
  await request('POST', `/mail/${id}/resolve`, salesToken, { outcome: 'sent' }, 404);
  const before = (await models.Customer.findById(customerId))!.letterCount;
  await request('POST', `/mail/${id}/resolve`, adminToken, { outcome: 'sent' }); await queue.runMailQueue();
  assert.equal((await models.Customer.findById(customerId))!.letterCount, before + 1);
  assert.equal((await models.DevelopmentLetter.findById(id))!.attempts, 1);
  await request('POST', `/mail/${id}/resolve`, adminToken, { outcome: 'not_sent' }, 409);
});
test('47 deleting scheduled customer cancels pending send and cleans mail', async () => {
  const c = await request('POST', '/customers', salesToken, { name: 'Delete scheduled', email: `delete-task.${suffix}@example.com` }, 201);
  const id = await scheduled({ customerId: c.id }); await request('DELETE', `/customers/${c.id}`, salesToken);
  let sends = 0; await queue.processMailJob(id, async () => { sends++; return accepted(); }); assert.equal(sends, 0);
});
test('48 real ImapFlow protocol imports raw MIME with durable UID and dedup', async () => {
  const source = mime(`protocol-imap-${suffix}`, email, { reply: sentMessageId });
  const sockets = new Set<net.Socket>(); let fetches = 0;
  const imapServer = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.write('* OK [CAPABILITY IMAP4rev1] fixture ready\r\n'); let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString(); let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); const tag = line.split(' ')[0];
        if (/ CAPABILITY/i.test(line)) socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK capability\r\n`);
        else if (/ LOGIN /i.test(line)) socket.write(`${tag} OK authenticated\r\n`);
        else if (/ (LIST|LSUB) /i.test(line)) socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK list\r\n`);
        else if (/ (EXAMINE|SELECT) /i.test(line)) socket.write(`* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\n* OK [UIDNEXT 2] next\r\n${tag} OK [READ-ONLY] selected\r\n`);
        else if (/ SEARCH /i.test(line)) socket.write(`* SEARCH 1\r\n${tag} OK search\r\n`);
        else if (/ FETCH /i.test(line)) {
          fetches++;
          if (/BODY/i.test(line)) socket.write(Buffer.concat([Buffer.from(`* 1 FETCH (UID 1 BODY[]<0> {${source.length}}\r\n`), source, Buffer.from(`)\r\n${tag} OK fetched\r\n`)]));
          else socket.write(`* 1 FETCH (UID 1 RFC822.SIZE ${source.length})\r\n${tag} OK fetched\r\n`);
        } else if (/ LOGOUT/i.test(line)) socket.end(`* BYE closing\r\n${tag} OK logout\r\n`);
        else socket.write(`${tag} OK done\r\n`);
      }
    });
  });
  await new Promise<void>(r => imapServer.listen(0, '127.0.0.1', r));
  const { ImapFlow: ActualImapFlow } = await import('imapflow');
  Object.assign(config, { IMAP_ENABLED: true, IMAP_HOST: 'protocol-fixture', IMAP_USER: 'fixture', IMAP_PASSWORD: 'fixture-only' });
  const factory = (options: ConstructorParameters<typeof ActualImapFlow>[0]) => new ActualImapFlow({ ...options, host: '127.0.0.1', port: (imapServer.address() as net.AddressInfo).port, secure: false, doSTARTTLS: false, socketTimeout: 3000 });
  try {
    await sync.syncInbox(factory); const state = await mailModels.MailSyncState.findById(sync.mailboxKey());
    assert.equal(state?.lastUid, 1, state?.lastError || 'missing cursor'); assert.equal(state?.uidValidity, '7'); assert.equal(fetches, 2);
    const doc = await mailModels.MailMessage.findOne({ messageId: `<protocol-imap-${suffix}@fixture.test>` }); assert.equal(String(doc?.customerId), customerId); assert.equal(doc?.threadId, threadId);
    await sync.syncInbox(factory); assert.equal(fetches, 2); assert.equal(await mailModels.MailMessage.countDocuments({ messageId: `<protocol-imap-${suffix}@fixture.test>` }), 1);
  } finally { config.IMAP_ENABLED = false; for (const socket of sockets) socket.destroy(); await new Promise<void>(r => imapServer.close(() => r())); }
});

test('49 customer email unique partial index builds on MongoDB', async () => {
  await models.Customer.init(); const indexes = await models.Customer.collection.indexes();
  assert.ok(indexes.some(i => i.name === 'projectId_1_email_1' && i.unique));
  await assert.rejects(models.Customer.create({ projectId, name: 'Duplicate', email }), (error: unknown) => (error as { code: number }).code === 11000);
});
test('50 explicit legacy resend creates a new record and preserves thread', async () => {
  const result = await request('POST', `/letters/${sentId}/resend`, salesToken, {}, 201);
  assert.notEqual(result.letter.id, sentId); assert.equal(result.letter.threadId, threadId); assert.equal(result.delivered, true);
});
test('51 reusing request key with changed body returns conflict', async () => {
  const requestKey = randomUUID();
  await request('POST', '/letters', salesToken, { customerId, subject: 'Stable key', content: '<p>Original</p>', requestKey }, 201);
  await request('POST', '/letters', salesToken, { customerId, subject: 'Stable key', content: '<p>Changed</p>', requestKey }, 409);
});
test('52 safe typography remains while CSS URLs and active content are removed', () => {
  const result = security.safeMailHtml('<p style="color: #336699; font-size: 16px; background-image: url(https://bad)">Hello</p>');
  assert.match(result, /color:#336699/); assert.match(result, /font-size:16px/); assert.ok(!result.includes('url('));
});

test('53 tracking tokens are random, URL-safe and do not expose identifiers', () => {
  const tokens = Array.from({ length: 100 }, () => tracking.generateTrackingToken());
  assert.equal(new Set(tokens).size, tokens.length);
  assert.ok(tokens.every(token => /^[A-Za-z0-9_-]{43}$/.test(token)));
  assert.ok(tokens.every(token => !token.includes(customerId) && !token.includes(email)));
});

let trackedId = '', openToken = '', clickToken = '';
const trackedTarget = 'https://www.example.com/catalog?campaign=v25';
test('54 HTML instrumentation tracks only eligible external links and retry reuses identical tokens', async () => {
  const id = await scheduled({
    subject: 'V2.5 tracking',
    content: `<p><a href="${trackedTarget}">Catalog</a> <a href="https://example.org/unsubscribe?id=1">Preferences</a> <a href="https://example.org/preferences">Unsubscribe</a> <a href="https://crm.fixture.test/customers/1">CRM</a></p>`,
  });
  trackedId = id;
  await due(id);
  const attempts: string[] = [];
  await queue.processMailJob(id, async payload => {
    attempts.push(payload.html);
    return { accepted: false, channel: 'mock', durationMs: 0, retryable: true, error: 'temporary' };
  });
  let job = await models.DevelopmentLetter.findById(id).select('+deliveryContent +tracking.openTokenHash +tracking.links.tokenHash');
  assert.equal(job?.tracking?.enabled, false);
  assert.equal(job?.tracking?.links.length, 1);
  assert.match(job!.deliveryContent!, /\/api\/tracking\/o\//);
  assert.match(job!.deliveryContent!, /\/api\/tracking\/c\//);
  assert.match(job!.deliveryContent!, /example\.org\/unsubscribe/);
  assert.match(job!.deliveryContent!, /crm\.fixture\.test\/customers/);
  openToken = job!.deliveryContent!.match(/\/api\/tracking\/o\/([A-Za-z0-9_-]{43})\.gif/)![1];
  clickToken = job!.deliveryContent!.match(/\/api\/tracking\/c\/([A-Za-z0-9_-]{43})/)![1];
  await due(id);
  await queue.processMailJob(id, async payload => { attempts.push(payload.html); return accepted(); });
  job = await models.DevelopmentLetter.findById(id).select('+deliveryContent +tracking.openTokenHash +tracking.links.tokenHash');
  assert.equal(attempts[0], attempts[1]);
  assert.equal(job?.tracking?.enabled, true);
  assert.equal(job?.attempts, 2);
});

test('55 unauthenticated open pixel records first and repeat opens without exposing CRM data', async () => {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/tracking/o/${openToken}.gif`, { headers: { Origin: 'https://webmail.external.test' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/gif');
    assert.ok((await response.arrayBuffer()).byteLength < 100);
  }
  const job = await models.DevelopmentLetter.findById(trackedId);
  assert.equal(job?.status, 'opened');
  assert.equal(job?.tracking?.openCount, 2);
  assert.ok(job?.tracking?.openedAt);
  assert.ok(job?.tracking?.lastOpenedAt);
});

test('56 click endpoint safely redirects to stored URL and repeat clicks are counted', async () => {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/tracking/c/${clickToken}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), trackedTarget);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
  const job = await models.DevelopmentLetter.findById(trackedId);
  assert.equal(job?.tracking?.clickCount, 2);
  assert.equal(job?.tracking?.links[0].clickCount, 2);
  const detail = await request('GET', `/letters/${trackedId}`, salesToken);
  assert.equal(detail.tracking.openCount, 2);
  assert.equal(detail.tracking.clickCount, 2);
  assert.equal(detail.tracking.clickedLinks[0].url, trackedTarget);
  assert.ok(!JSON.stringify(detail).includes(tracking.hashTrackingToken(openToken)));
});

test('57 invalid tokens cannot enumerate mail and malformed click tokens are rejected', async () => {
  const before = (await models.DevelopmentLetter.findById(trackedId))!.tracking!.openCount;
  const pixel = await fetch(`${base}/tracking/o/${tracking.generateTrackingToken()}.gif`);
  assert.equal(pixel.status, 200);
  assert.equal((await models.DevelopmentLetter.findById(trackedId))!.tracking!.openCount, before);
  const click = await fetch(`${base}/tracking/c/not-a-valid-token`, { redirect: 'manual' });
  assert.equal(click.status, 404);
});

test('58 redirect target is revalidated and an illegal stored URL is refused', async () => {
  await models.DevelopmentLetter.updateOne({ _id: trackedId, 'tracking.links.tokenHash': tracking.hashTrackingToken(clickToken) }, { $set: { 'tracking.links.$.originalUrl': 'javascript:alert(1)' } });
  const before = (await models.DevelopmentLetter.findById(trackedId))!.tracking!.clickCount;
  const response = await fetch(`${base}/tracking/c/${clickToken}`, { redirect: 'manual' });
  assert.equal(response.status, 404);
  assert.equal((await models.DevelopmentLetter.findById(trackedId))!.tracking!.clickCount, before);
});

test('59 CRM tracking details retain customer ownership isolation', async () => {
  await request('GET', `/letters/${trackedId}`, otherToken, undefined, 404);
  await request('GET', `/mail/${trackedId}?direction=outbound`, otherToken, undefined, 404);
  const own = await request('GET', `/mail/${trackedId}?direction=outbound`, salesToken);
  assert.equal(own.mail.tracking.openCount, 2);
});

test('60 Timeline contains one first-open and one first-click event despite repeated hits', async () => {
  const timeline = await request('GET', `/customers/${customerId}/timeline`, salesToken);
  assert.equal(timeline.items.filter((event: { type: string; interaction?: { letterId: string } }) => event.type === 'mail_opened' && event.interaction?.letterId === trackedId).length, 1);
  assert.equal(timeline.items.filter((event: { type: string; interaction?: { letterId: string } }) => event.type === 'mail_clicked' && event.interaction?.letterId === trackedId).length, 1);
});

test('61 plain-text mail sends normally without pixel tracking', async () => {
  const result = await request('POST', '/letters', salesToken, { customerId, subject: 'Text only', content: 'Hello without HTML', requestKey: randomUUID() }, 201);
  assert.equal(result.delivered, true);
  assert.equal(result.letter.tracking, undefined);
  const job = await models.DevelopmentLetter.findById(result.letter.id).select('+deliveryContent');
  assert.equal(job?.deliveryContent, 'Hello without HTML');
  assert.equal(job?.tracking?.enabled, false);
});

test('62 tracking preparation failure never blocks normal SMTP/mock delivery', async () => {
  const original = config.TRACKING_BASE_URL;
  config.TRACKING_BASE_URL = 'not-a-url';
  try {
    const id = await scheduled({ subject: 'Tracking fallback', content: '<p>Still deliver</p>' });
    await due(id);
    await queue.processMailJob(id, async payload => {
      assert.equal(payload.html, '<p>Still deliver</p>');
      return { accepted: true, channel: 'smtp', durationMs: 0 };
    });
    const job = await models.DevelopmentLetter.findById(id);
    assert.equal(job?.status, 'sent');
    assert.equal(job?.channel, 'smtp');
    assert.equal(job?.tracking?.enabled, false);
  } finally {
    config.TRACKING_BASE_URL = original;
  }
});

let ironCustomerId = '';
test('63 project directory is role-aware and project administration remains admin-only', async () => {
  const adminProjects = await request('GET', '/projects', adminToken);
  assert.deepEqual(new Set(adminProjects.map((project: { slug: string }) => project.slug)), new Set(['genesis-bags', 'ironhue']));
  const salesProjects = await request('GET', '/projects', salesToken);
  assert.deepEqual(salesProjects.map((project: { id: string }) => project.id), [projectId]);
  await request('POST', '/projects', salesToken, { name: 'Forbidden', slug: 'forbidden', code: 'FORBIDDEN', companyName: 'Forbidden', mailProfileKey: 'forbidden' }, 403);
});

test('64 the same customer email is allowed in different projects but never leaks across them', async () => {
  const ironCustomer = await request('POST', '/customers', adminToken,
    { name: 'IRONHUE Customer', email, ownerId: ironSalesId }, 201, ironhueProjectId);
  ironCustomerId = ironCustomer.id;
  assert.notEqual(ironCustomerId, customerId);
  await request('GET', `/customers/${ironCustomerId}`, adminToken, undefined, 404, projectId);
  await request('GET', `/customers/${customerId}`, adminToken, undefined, 404, ironhueProjectId);
  const ironList = await request('GET', '/customers', ironSalesToken, undefined, 200, ironhueProjectId);
  assert.deepEqual(ironList.items.map((customer: { id: string }) => customer.id), [ironCustomerId]);
  await request('GET', '/customers', salesToken, undefined, 404, ironhueProjectId);
});

test('65 dashboards and templates are isolated by active project', async () => {
  const ironStats = await request('GET', '/stats/overview', adminToken, undefined, 200, ironhueProjectId);
  assert.equal(ironStats.customer.total, 1);
  const template = await request('POST', '/templates', ironSalesToken,
    { name: 'IRONHUE Intro', subject: 'IRONHUE equipment', content: '<p>Sports equipment</p>', category: 'other' }, 201, ironhueProjectId);
  const ironTemplates = await request('GET', '/templates', ironSalesToken, undefined, 200, ironhueProjectId);
  assert.ok(ironTemplates.some((item: { id: string }) => item.id === template.id));
  const genesisTemplates = await request('GET', '/templates', salesToken, undefined, 200, projectId);
  assert.ok(!genesisTemplates.some((item: { id: string }) => item.id === template.id));
  await request('GET', `/templates/${template.id}`, adminToken, undefined, 404, projectId);
});

test('66 quotation numbers and mail request keys are unique within a project, not globally', async () => {
  const quotationNo = `MULTI-${suffix}`;
  const quotation = (customer: string) => ({ customerId: customer, quotationNo, title: 'Project quote', items: [{ productName: 'Sample', quantity: 1, unitPrice: 10 }], currency: 'USD' });
  const genesisQuote = await request('POST', '/quotations', salesToken, quotation(customerId), 201, projectId);
  const ironQuote = await request('POST', '/quotations', ironSalesToken, quotation(ironCustomerId), 201, ironhueProjectId);
  assert.notEqual(genesisQuote.id, ironQuote.id);
  await request('GET', `/quotations/${ironQuote.id}`, adminToken, undefined, 404, projectId);

  const requestKey = randomUUID();
  const scheduleAt = new Date(Date.now() + 3600000).toISOString();
  const genesisJob = await request('POST', '/letters', salesToken, { customerId, subject: 'Genesis scoped key', content: '<p>Genesis</p>', scheduledAt: scheduleAt, requestKey }, 201, projectId);
  const ironJob = await request('POST', '/letters', ironSalesToken, { customerId: ironCustomerId, subject: 'IRONHUE scoped key', content: '<p>IRONHUE</p>', scheduledAt: scheduleAt, requestKey }, 201, ironhueProjectId);
  assert.notEqual(genesisJob.letter.id, ironJob.letter.id);
  await request('GET', `/letters/${ironJob.letter.id}`, adminToken, undefined, 404, projectId);
});

test('67 identical inbound Message-ID values remain independent between project mailboxes', async () => {
  const source = mime(`multi-project-${suffix}`, email, { subject: 'Project-specific inbox' });
  const genesisMail = await sync.importMail(source, 'genesis-fixture', projectId);
  const ironMail = await sync.importMail(source, 'ironhue-fixture', ironhueProjectId);
  assert.notEqual(String(genesisMail._id), String(ironMail._id));
  assert.equal(String(genesisMail.customerId), customerId);
  assert.equal(String(ironMail.customerId), ironCustomerId);
  await request('GET', `/mail/${ironMail._id}`, adminToken, undefined, 404, projectId);
  const ironDetail = await request('GET', `/mail/${ironMail._id}`, ironSalesToken, undefined, 200, ironhueProjectId);
  assert.equal(ironDetail.customer.id, ironCustomerId);
});

test('68 the default project cannot be archived and unknown project headers disclose nothing', async () => {
  await request('PUT', `/projects/${projectId}`, adminToken, { status: 'archived' }, 400);
  await request('GET', '/customers', adminToken, undefined, 404, '000000000000000000000001');
});

test('69 browser CORS preflight allows the project workspace header', async () => {
  const response = await fetch(`${base}/customers`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,x-project-id',
    },
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-headers') || '', /x-project-id/i);
  assert.match(response.headers.get('access-control-expose-headers') || '', /x-project-id/i);
});

test('70 startup migration replaces the legacy sparse request-key index', async () => {
  const indexName = 'projectId_1_requestKey_1';
  await models.DevelopmentLetter.collection.dropIndex(indexName);
  await models.DevelopmentLetter.collection.createIndex(
    { projectId: 1, requestKey: 1 },
    { name: indexName, unique: true, sparse: true },
  );

  const projectService = await import('../src/services/project.service');
  await projectService.bootstrapProjects();
  let indexes = await models.DevelopmentLetter.collection.indexes();
  assert.equal(indexes.some((index) => index.name === indexName), false);

  await models.DevelopmentLetter.createIndexes();
  indexes = await models.DevelopmentLetter.collection.indexes();
  const migrated = indexes.find((index) => index.name === indexName);
  assert.deepEqual(migrated?.partialFilterExpression, { requestKey: { $type: 'string' } });
  assert.equal(migrated?.sparse, undefined);
});

test('71 CORS permits CRM origins on private LAN ports but rejects public and unexpected origins', async () => {
  const preflight = (origin: string, privateNetwork = false) => fetch(`${base}/customers`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,x-project-id',
      ...(privateNetwork ? { 'Access-Control-Request-Private-Network': 'true' } : {}),
    },
  });

  const lan = await preflight('http://192.168.50.24:5173', true);
  assert.equal(lan.status, 204);
  assert.equal(lan.headers.get('access-control-allow-origin'), 'http://192.168.50.24:5173');
  assert.equal(lan.headers.get('access-control-allow-private-network'), 'true');

  assert.equal((await preflight('http://192.168.50.24:3000')).status, 403);
  assert.equal((await preflight('http://203.0.113.10:5173')).status, 403);
});

let personalMailAccountId = '';
const personalMailbox = `sales.${suffix}@example.com`;

test('72 admin assigns an encrypted per-user mailbox and credentials never leave the server', async () => {
  const beforeConfig = await request('GET', '/mail-accounts/current', salesToken);
  assert.equal(beforeConfig.channel, 'mock');
  assert.equal(beforeConfig.canSend, true);
  assert.equal(beforeConfig.account, null);

  await request('GET', `/mail-accounts/users/${salesId}`, otherToken, undefined, 403);
  await request('PUT', `/mail-accounts/users/${salesId}`, adminToken, {
    email: personalMailbox, displayName: 'Sales Fixture', smtpHost: 'smtp.example.com', smtpPort: 465,
    smtpSecure: true, smtpRequireTls: true, smtpUsername: personalMailbox, status: 'active', dailyLimit: 1,
  }, 400);

  const saved = await request('PUT', `/mail-accounts/users/${salesId}`, adminToken, {
    email: personalMailbox, displayName: 'Sales Fixture', smtpHost: 'smtp.example.com', smtpPort: 465,
    smtpSecure: true, smtpRequireTls: true, smtpUsername: personalMailbox, password: 'fixture-authorization-code',
    imapEnabled: true, imapHost: 'imap.example.com', imapPort: 993, imapSecure: true, imapUsername: personalMailbox,
    status: 'active', dailyLimit: 1,
  });
  personalMailAccountId = saved.id;
  assert.equal(saved.email, personalMailbox);
  assert.equal(saved.credentialSet, true);
  assert.equal(saved.credentialCiphertext, undefined);
  assert.equal(saved.password, undefined);
  assert.equal(saved.imapEnabled, true);
  assert.equal(saved.imapVerificationStatus, 'unverified');

  const stored = await models.UserMailAccount.findById(saved.id).select('+credentialCiphertext +credentialIv +credentialTag');
  assert.ok(stored?.credentialCiphertext);
  assert.notEqual(stored?.credentialCiphertext, 'fixture-authorization-code');
  const current = await request('GET', '/mail-accounts/current', salesToken);
  assert.equal(current.account.id, saved.id);
  assert.equal(current.account.credentialCiphertext, undefined);
});

test('73 user mailboxes are project scoped and cross-project configuration is rejected', async () => {
  assert.equal(await request('GET', `/mail-accounts/users/${salesId}`, adminToken, undefined, 200, ironhueProjectId), null);
  await request('PUT', `/mail-accounts/users/${salesId}`, adminToken, {
    email: personalMailbox, displayName: 'Wrong Project', smtpHost: 'smtp.example.com', smtpPort: 465,
    smtpSecure: true, smtpRequireTls: true, smtpUsername: personalMailbox, password: 'fixture-code',
    status: 'active', dailyLimit: 100,
  }, 404, ironhueProjectId);
});

test('74 personal IMAP sync isolates the mailbox, links only owned customers, and blocks cross-user replies', async () => {
  await models.UserMailAccount.updateOne({ _id: personalMailAccountId }, { $set: {
    verificationStatus: 'verified', verifiedAt: new Date(), imapVerificationStatus: 'verified', imapVerifiedAt: new Date(),
  } });
  const fake = { on() {}, close() {}, async connect() {}, mailbox: { uidValidity: 1n, uidNext: 2 },
    async getMailboxLock() { return { release() {} }; }, async search() { return [1]; },
    async fetchOne(_uid: number, query: { size?: boolean }) { return query.size ? { size: 1024 } : { source: mime(`personal-imap-${suffix}`) }; } };
  const synced = await sync.syncPersonalInbox(projectId, salesId, (options: any) => {
    assert.equal(options.auth.user, personalMailbox); assert.equal(options.auth.pass, 'fixture-authorization-code');
    return fake as unknown as ImapFlow;
  });
  assert.equal(synced, true);
  const mail = await mailModels.MailMessage.findOne({ messageId: `<personal-imap-${suffix}@fixture.test>` });
  assert.equal(String(mail?.customerId), customerId);
  assert.equal(String(mail?.mailboxUserId), salesId);
  assert.equal(String(mail?.mailAccountId), personalMailAccountId);
  const foreign = await sync.importMail(mime(`personal-foreign-${suffix}`, `other.${suffix}@example.com`), 'personal-foreign', projectId,
    { mailAccountId: personalMailAccountId, userId: salesId, address: personalMailbox });
  assert.equal(foreign.customerId, null);
  const status = await request('GET', '/mail/status', salesToken);
  assert.equal(status.source, 'personal'); assert.equal(status.verificationStatus, 'verified'); assert.equal(status.mailboxAddress, personalMailbox);
  await request('POST', `/mail/${mail?._id}/reply`, adminToken, { subject: 'Wrong sender', content: '<p>x</p>', requestKey: randomUUID() }, 409);
});

test('75 scheduled SMTP jobs lock the sender account and consume its atomic daily quota', async () => {
  config.MAIL_TRANSPORT = 'smtp';
  try {
    const id = await scheduled({ subject: 'Personal sender' });
    const created = await models.DevelopmentLetter.findById(id);
    assert.equal(String(created?.mailAccountId), personalMailAccountId);
    assert.match(created?.senderAddress || '', new RegExp(personalMailbox.replace('.', '\\.')));
    await due(id);
    let payload: any;
    await queue.processMailJob(id, async (value) => { payload = value; return accepted(); });
    assert.equal(payload.mailAccountId, personalMailAccountId);
    assert.equal(payload.senderUserId, salesId);
    assert.equal((await models.DevelopmentLetter.findById(id))?.status, 'sent');
    const bucket = await models.MailQuotaBucket.findOne({ mailAccountId: personalMailAccountId });
    assert.equal(bucket?.attempts, 1);
    assert.ok(await models.MailAccountAudit.exists({ accountId: personalMailAccountId, action: 'send_success' }));
  } finally {
    config.MAIL_TRANSPORT = 'mock';
  }
});

test('76 daily mailbox quota blocks delivery without contacting SMTP', async () => {
  config.MAIL_TRANSPORT = 'smtp';
  try {
    const id = await scheduled({ subject: 'Over quota' });
    await due(id);
    let deliveries = 0;
    await queue.processMailJob(id, async () => { deliveries += 1; return accepted(); });
    const job = await models.DevelopmentLetter.findById(id);
    assert.equal(deliveries, 0);
    assert.equal(job?.status, 'failed');
    assert.match(job?.error || '', /额度已用完/);
    assert.ok(await models.MailAccountAudit.exists({ accountId: personalMailAccountId, action: 'quota_blocked' }));
  } finally {
    config.MAIL_TRANSPORT = 'mock';
  }
});

test('77 disabled or unverified mailboxes block real sending while drafts remain available', async () => {
  await request('PUT', `/mail-accounts/users/${salesId}`, adminToken, {
    email: personalMailbox, displayName: 'Sales Fixture', smtpHost: 'smtp.example.com', smtpPort: 465,
    smtpSecure: true, smtpRequireTls: true, smtpUsername: personalMailbox, status: 'disabled', dailyLimit: 1,
    imapEnabled: true, imapHost: 'imap.example.com', imapPort: 993, imapSecure: true, imapUsername: personalMailbox,
  });
  config.MAIL_TRANSPORT = 'smtp';
  try {
    await request('POST', '/letters', salesToken, { customerId, subject: 'Blocked', content: '<p>Blocked</p>', requestKey: randomUUID() }, 409);
    const draft = await request('POST', '/letters', salesToken, { customerId, subject: 'Draft allowed', content: '<p>Draft</p>', requestKey: randomUUID(), saveAsDraft: true }, 201);
    assert.equal(draft.letter.status, 'draft');
    assert.equal(draft.delivered, false);
  } finally {
    config.MAIL_TRANSPORT = 'mock';
  }
});
