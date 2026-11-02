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
let service: typeof import('../src/services/agent/ai-settings.service');
let providerModel: typeof import('../src/models/AgentAiProvider');

const admin: AuthUser = { id: new Types.ObjectId().toString(), username: 'admin', displayName: 'Admin', role: 'admin', projectId: new Types.ObjectId().toString() };
const salesperson: AuthUser = { ...admin, id: new Types.ObjectId().toString(), role: 'user' };
const baseUrl = 'https://124.222.23.70/v1';

before(async () => {
  memory = await MongoMemoryServer.create();
  mongoose = await import('mongoose');
  await mongoose.default.connect(memory.getUri(), { dbName: 'ai-providers-tests' });
  providerModel = await import('../src/models/AgentAiProvider');
  await providerModel.AgentAiProvider.init();
  service = await import('../src/services/agent/ai-settings.service');
});

after(async () => {
  await mongoose.default.disconnect();
  await memory.stop();
});

test('admin can manage multiple providers, and active provider follows activation', async () => {
  await assert.rejects(service.listAiProviders(salesperson), { statusCode: 403 });

  const first = await service.createAiProvider({ name: '演示 A', kind: 'mock', model: '', baseUrl: '' }, admin);
  assert.equal(first.kind, 'mock');
  assert.equal(first.keyConfigured, false);

  let catalog = await service.listAiProviders(admin);
  assert.equal(catalog.providers.length, 1);
  assert.equal(catalog.activeProviderId, null);

  await service.activateAiProvider(first.id, admin);
  catalog = await service.listAiProviders(admin);
  assert.equal(catalog.activeProviderId, first.id);
  assert.equal(catalog.providers[0]?.isActive, true);
  assert.equal((await service.resolveAgentProvider()).name, 'mock');

  await assert.rejects(service.deleteAiProvider(first.id, admin), { statusCode: 409 });

  const second = await service.createAiProvider({ name: '演示 B', kind: 'mock', model: '', baseUrl: '' }, admin);
  await service.activateAiProvider(second.id, admin);
  await service.deleteAiProvider(first.id, admin);
  catalog = await service.listAiProviders(admin);
  assert.deepEqual(catalog.providers.map((provider) => provider.name), ['演示 B']);
  assert.equal((await service.resolveAgentProvider()).name, 'mock');
});

test('live provider keys stay encrypted and edits keep the existing key', async () => {
  const originalFetch = global.fetch;
  let probes = 0;
  global.fetch = (async (url, options) => {
    probes += 1;
    assert.match(String(url), /\/responses$/);
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer live-secret');
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
      usage: { input_tokens: 2, output_tokens: 1 },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const created = await service.createAiProvider({
      name: 'Live A', kind: 'openai', model: 'model-a', baseUrl, apiKey: 'live-secret',
    }, admin);
    assert.equal(created.keyConfigured, true);
    assert.doesNotMatch(JSON.stringify(created), /live-secret|apiKey|credentialCiphertext/);

    const stored = await providerModel.AgentAiProvider.findById(created.id).select('+credentialCiphertext');
    assert.ok(stored?.credentialCiphertext);
    assert.notEqual(stored.credentialCiphertext, 'live-secret');

    await service.activateAiProvider(created.id, admin);
    const active = await service.resolveAgentProvider();
    assert.equal(active.name, 'openai');
    assert.equal(active.model, 'model-a');

    const updated = await service.updateAiProvider(created.id, {
      name: 'Live A', kind: 'openai', model: 'model-b', baseUrl,
    }, admin);
    assert.equal(updated.model, 'model-b');
    assert.equal(updated.keyConfigured, true);
    assert.equal((await service.resolveAgentProvider()).model, 'model-b');
    assert.ok(probes >= 2);
  } finally {
    global.fetch = originalFetch;
  }
});
