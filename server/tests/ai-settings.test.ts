import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AuthUser } from '../src/types/express';

process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.OPENAI_API_KEY = '';
process.env.JWT_SECRET ||= 'fixture-jwt-value-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
process.env.ADMIN_PASSWORD ||= 'fixture-password';

let memory: MongoMemoryServer;
let mongoose: typeof import('mongoose');
let settings: typeof import('../src/services/agent/ai-settings.service');
let model: typeof import('../src/models/AgentAiSettings');
let crypto: typeof import('../src/services/credential-crypto');

const admin: AuthUser = { id: new Types.ObjectId().toString(), username: 'admin', displayName: 'Admin', role: 'admin', projectId: new Types.ObjectId().toString() };
const salesperson: AuthUser = { ...admin, id: new Types.ObjectId().toString(), role: 'user' };
const baseUrl = 'https://124.222.23.70/v1';

before(async () => {
  memory = await MongoMemoryServer.create();
  mongoose = await import('mongoose');
  await mongoose.default.connect(memory.getUri(), { dbName: 'ai-settings-tests' });
  model = await import('../src/models/AgentAiSettings');
  await model.AgentAiSettings.init();
  settings = await import('../src/services/agent/ai-settings.service');
  crypto = await import('../src/services/credential-crypto');
});

after(async () => {
  await mongoose.default.disconnect();
  await memory.stop();
});

test('only admin can inspect, test or save global AI settings', async () => {
  const input = { provider: 'mock' as const, model: 'mock', baseUrl: 'https://api.example.com/v1' };
  await assert.rejects(settings.getAiSettings(salesperson), { statusCode: 403 });
  await assert.rejects(settings.testAiSettings(input, salesperson), { statusCode: 403 });
  await assert.rejects(settings.saveAiSettings(input, salesperson), { statusCode: 403 });
  assert.equal((await settings.getAiSettings(admin)).source, 'environment');
});

test('rejects private and credential-bearing endpoints before any network call', async () => {
  for (const url of ['http://169.254.169.254/v1', 'http://10.0.0.1/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=x', 'file:///etc/passwd']) {
    await assert.rejects(settings.validateAiBaseUrl(url), { statusCode: 400 });
  }
  assert.equal(await settings.validateAiBaseUrl(baseUrl), baseUrl);
  await assert.rejects(settings.validateAiBaseUrl('http://124.222.23.70/v1', true), { statusCode: 400 });
});

test('verified save encrypts key; read API and provider status never return it', async () => {
  const originalFetch = global.fetch;
  let probes = 0;
  global.fetch = (async (_url, options) => {
    probes += 1;
    assert.equal(options?.redirect, 'error');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer local-secret-fixture');
    const body = JSON.parse(String(options?.body)) as { model: string; input: unknown[] };
    assert.equal(body.model, 'model-a');
    assert.ok(body.input.length);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }], usage: { input_tokens: 2, output_tokens: 1 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const input = { provider: 'openai' as const, model: 'model-a', baseUrl, apiKey: 'local-secret-fixture' };
    assert.equal((await settings.testAiSettings(input, admin)).ok, true);
    const saved = await settings.saveAiSettings(input, admin);
    assert.equal(probes, 2);
    assert.equal(saved.source, 'database');
    assert.equal(saved.keySource, 'database');
    assert.doesNotMatch(JSON.stringify(saved), /local-secret-fixture|apiKey|credentialCiphertext/);
    const current = await settings.getAiSettings(admin);
    assert.equal(current.model, 'model-a');
    assert.doesNotMatch(JSON.stringify(current), /local-secret-fixture|apiKey|credentialCiphertext/);
    const document = await model.AgentAiSettings.findOne({ key: 'global' }).select('+credentialCiphertext +credentialIv +credentialTag');
    assert.ok(document?.credentialCiphertext && document.credentialIv && document.credentialTag);
    assert.notEqual(document.credentialCiphertext, 'local-secret-fixture');
    assert.equal(crypto.decryptAiCredential({ ciphertext: document.credentialCiphertext, iv: document.credentialIv, tag: document.credentialTag }), 'local-secret-fixture');
    assert.throws(() => crypto.decryptCredential({ ciphertext: document.credentialCiphertext!, iv: document.credentialIv!, tag: document.credentialTag! }));
    const active = await settings.resolveAgentProvider();
    assert.equal(active.name, 'openai');
    assert.equal(active.model, 'model-a');
    assert.equal(active.isAvailable(), true);
  } finally { global.fetch = originalFetch; }
});

test('failed provider test never overwrites the working configuration', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(settings.saveAiSettings({ provider: 'openai', model: 'broken', baseUrl, apiKey: 'replacement' }, admin), { statusCode: 400 });
    assert.equal((await settings.getAiSettings(admin)).model, 'model-a');
    assert.equal((await settings.resolveAgentProvider()).model, 'model-a');
  } finally { global.fetch = originalFetch; }
});

test('mock mode switches without a network call and preserves encrypted key for later use', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => { throw new Error('mock mode must not fetch'); }) as typeof fetch;
  try {
    const saved = await settings.saveAiSettings({ provider: 'mock', model: 'model-a', baseUrl }, admin);
    assert.equal(saved.provider, 'mock');
    assert.equal(saved.keyConfigured, true);
    assert.equal((await settings.resolveAgentProvider()).name, 'mock');
  } finally { global.fetch = originalFetch; }
});

test('admin can replace an unreadable stored key without exposing it', async () => {
  await model.AgentAiSettings.updateOne({ key: 'global' }, { $set: { provider: 'openai', credentialTag: 'corrupt' } });
  const current = await settings.getAiSettings(admin);
  assert.equal(current.keyConfigured, true);
  assert.equal(current.keySource, 'database');
  assert.doesNotMatch(JSON.stringify(current), /credentialTag|apiKey/);
  await assert.rejects(settings.resolveAgentProvider(), { statusCode: 500 });

  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({
    status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    usage: { input_tokens: 2, output_tokens: 1 },
  }), { status: 200 })) as typeof fetch;
  try {
    const saved = await settings.saveAiSettings({ provider: 'openai', model: 'replacement-model', baseUrl, apiKey: 'replacement-secret' }, admin);
    assert.equal(saved.model, 'replacement-model');
    assert.equal((await settings.resolveAgentProvider()).model, 'replacement-model');
  } finally { global.fetch = originalFetch; }
});
