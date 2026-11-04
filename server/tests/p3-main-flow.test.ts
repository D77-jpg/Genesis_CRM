/**
 * P3 revenue-path E2E test.
 *
 * Exercises the real HTTP API with cookie authentication and CSRF:
 *   login → import customer → send outreach → receive reply → create quote.
 * Mongo is an isolated in-memory instance; the reply is ingested through the
 * same mail parser used by POP3/IMAP sync.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.MAIL_TRANSPORT = 'mock';
process.env.JWT_SECRET ||= ['p3', 'e2e', 'fixture', 'jwt', 'secret', '0'.repeat(32)].join('-');
process.env.ADMIN_PASSWORD ||= 'p3-e2e-fixture-admin-password';
process.env.API_RATE_LIMIT_MAX = '100000';

let memory: MongoMemoryServer;
let server: Server;
let base = '';
let projectId = '';
let cookieJar: Record<string, string> = {};

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = response.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function mergeCookies(response: Response, previous: Record<string, string> = {}): Record<string, string> {
  const jar = { ...previous };
  for (const cookie of setCookies(response)) {
    const pair = cookie.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return jar;
}

function cookieHeader(): string {
  return Object.entries(cookieJar).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: { success?: boolean; data?: any; error?: any } }> {
  const headers: Record<string, string> = { cookie: cookieHeader() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && cookieJar.cdlm_csrf) headers['x-csrf-token'] = cookieJar.cdlm_csrf;
  if (projectId) headers['x-project-id'] = projectId;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  cookieJar = mergeCookies(response, cookieJar);
  return { status: response.status, json: await response.json() as { success?: boolean; data?: any; error?: any } };
}

before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('p3_main_flow_fixture'));
  const { createApp } = await import('../src/app');
  const models = await import('../src/models');
  const { hashPassword } = models;
  const org = await models.Organization.create({
    name: 'P3 E2E Org', slug: 'p3-e2e-org', plan: 'starter',
    limits: { users: 5, projects: 2, monthlyEmails: 5000, monthlyAiTokens: 1_000_000, storageBytes: 5 * 1024 ** 3 },
    subscriptionStatus: 'active',
  });
  const project = await models.Project.create({
    organizationId: org._id, name: 'P3 E2E Project', slug: 'p3-e2e-project', code: 'P3E2E',
    companyName: 'P3 E2E Trading', mailProfileKey: 'default',
  });
  projectId = String(project._id);
  await models.User.create({
    username: 'p3-e2e-admin', passwordHash: await hashPassword('P3-E2E-Str0ng-Pass!'), displayName: 'P3 E2E Admin',
    role: 'admin', organizationId: org._id, projectIds: [project._id], defaultProjectId: project._id,
  });
  await Promise.all([models.Organization.init(), models.Project.init(), models.User.init(), models.Customer.init(), models.DevelopmentLetter.init(), models.Quotation.init()]);
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('E2E server did not bind a port');
  base = `http://127.0.0.1:${address.port}/api`;

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'p3-e2e-admin', password: 'P3-E2E-Str0ng-Pass!' }),
  });
  assert.equal(login.status, 200, 'login should succeed');
  cookieJar = mergeCookies(login);
  assert.ok(cookieJar.cdlm_access, 'access cookie issued');
  assert.ok(cookieJar.cdlm_csrf, 'CSRF cookie issued');
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

test('login → import customer → send → receive reply → quote', async () => {
  const me = await request('GET', '/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.data.user.username, 'p3-e2e-admin');

  const imported = await request('POST', '/customers/import', {
    customers: [{
      name: 'Ada P3 Buyer', company: 'P3 Retail GmbH', email: 'ada@p3-retail.test',
      country: 'Germany', phone: '+49 30 123456', notes: 'P3 E2E imported lead',
    }],
    onDuplicate: 'skip',
    defaultStatus: 'pending',
    dryRun: false,
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.data.created, 1, 'import creates one customer');

  const list = await request('GET', '/customers?search=ada%40p3-retail.test&limit=20');
  assert.equal(list.status, 200);
  const customer = list.json.data.items.find((item: { email?: string }) => item.email === 'ada@p3-retail.test');
  assert.ok(customer, 'imported customer is visible through the API');
  const customerId = String(customer.id);

  const sent = await request('POST', `/customers/${customerId}/letters`, {
    subject: 'P3 packaging proposal',
    content: '<p>Hello {{name}}, we can support your packaging program with a low MOQ sample.</p>',
    requestKey: 'p3-e2e-first-outreach',
    markAsDeveloped: true,
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.data.delivered, true);
  assert.equal(sent.json.data.channel, 'mock');
  assert.equal(sent.json.data.letter.status, 'sent');
  const messageId = sent.json.data.letter.messageId;
  assert.ok(messageId, 'sent letter has a Message-ID for reply threading');

  const { importMail } = await import('../src/services/mail-sync.service');
  const replyMime = [
    'From: Ada P3 Buyer <ada@p3-retail.test>',
    'To: sales@p3-e2e.test',
    'Subject: Re: P3 packaging proposal',
    `Message-ID: <p3-reply-${Date.now()}@p3-retail.test>`,
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    'Date: Wed, 04 Nov 2026 10:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Thanks, please send a quotation for 500 kraft boxes.',
  ].join('\r\n');
  const inbound = await importMail(Buffer.from(replyMime), 'p3-e2e-fixture', projectId);
  assert.equal(String(inbound.customerId), customerId, 'inbound reply is matched to the customer');

  const received = await request('GET', `/mail/${inbound._id}`);
  assert.equal(received.status, 200);
  assert.equal(received.json.data.mail.subject, 'Re: P3 packaging proposal');
  assert.equal(received.json.data.mail.direction, 'inbound');

  const quote = await request('POST', `/customers/${customerId}/quotations`, {
    title: 'P3 packaging quotation',
    currency: 'USD',
    items: [{ productName: 'Kraft gift box', model: 'KB-500', quantity: 500, unitPrice: 1.25 }],
    validityDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    paymentTerms: '30% deposit, balance before shipment',
    leadTime: '20 days',
    moq: '500 pcs',
    notes: 'E2E quotation',
    markCustomerAsQuoting: true,
  });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  assert.ok(quote.json.data.quotationNo, 'quotation number generated');
  assert.equal(quote.json.data.totalAmount, 625);

  const customerAfter = await request('GET', `/customers/${customerId}`);
  assert.equal(customerAfter.status, 200);
  assert.equal(customerAfter.json.data.status, 'quoting');

  const timeline = await request('GET', `/customers/${customerId}/timeline`);
  assert.equal(timeline.status, 200);
  const types = timeline.json.data.items.map((item: { type: string }) => item.type);
  assert.ok(types.includes('letter'), 'timeline contains sent outreach');
  assert.ok(types.includes('mail_received'), 'timeline contains inbound reply');
  assert.ok(types.includes('quotation'), 'timeline contains quotation');
});
