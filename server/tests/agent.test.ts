import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AuthUser } from '../src/types/express';

let memory: MongoMemoryServer;
let mongoose: typeof import('mongoose');
let service: typeof import('../src/services/agent/agent.service');
let tools: typeof import('../src/services/agent/tool-registry');

const projectA = new Types.ObjectId();
const projectB = new Types.ObjectId();
const userA = new Types.ObjectId();
const userB = new Types.ObjectId();

const actorA: AuthUser = { id: userA.toString(), username: 'alice', displayName: 'Alice', role: 'user', projectId: projectA.toString() };
const actorB: AuthUser = { id: userB.toString(), username: 'bob', displayName: 'Bob', role: 'user', projectId: projectA.toString() };
const actorOtherProject: AuthUser = { ...actorA, projectId: projectB.toString() };

before(async () => {
  memory = await MongoMemoryServer.create();
  mongoose = await import('mongoose');
  await mongoose.default.connect(memory.getUri(), { dbName: 'agent-tests' });
  const models = await import('../src/models');
  await Promise.all([models.AgentSession.init(), models.AgentMessage.init(), models.AgentRun.init(), models.AgentAction.init(), models.Customer.init(), models.User.init()]);
  await models.User.insertMany([
    { _id: userA, username: 'alice', passwordHash: 'test-hash', displayName: 'Alice', role: 'user', projectIds: [projectA] },
    { _id: userB, username: 'bob', passwordHash: 'test-hash', displayName: 'Bob', role: 'user', projectIds: [projectA] },
  ]);
  service = await import('../src/services/agent/agent.service');
  tools = await import('../src/services/agent/tool-registry');
});

after(async () => {
  await mongoose.default.disconnect();
  await memory.stop();
});

test('tool registry exposes read-only tools only', () => {
  const registered = tools.listAgentTools();
  assert.deepEqual(registered.map((tool) => tool.name).sort(), [
    'get_current_customer',
    'get_customer_followups',
    'get_customer_quotations',
    'get_customer_timeline',
    'get_dashboard_summary',
    'get_mail_thread',
  ]);
  assert.ok(registered.every((tool) => tool.riskLevel === 'read'));
  assert.ok(tools.agentToolSchemas().every((tool) => tool.strict && tool.parameters.additionalProperties === false));
});

test('sessions and messages are isolated by user and project', async () => {
  const created = await service.createAgentSession({ context: { type: 'global' } }, actorA);
  assert.equal((await service.listAgentSessions(actorA)).length, 1);
  assert.equal((await service.listAgentSessions(actorB)).length, 0);
  assert.equal((await service.listAgentSessions(actorOtherProject)).length, 0);

  const result = await service.sendAgentMessage(created.id, '总结今天的销售工作区', actorA);
  assert.equal(result.degraded, false);
  assert.equal(result.assistantMessage.status, 'completed');
  assert.equal((await service.listAgentMessages(created.id, actorA)).length, 2);
  await assert.rejects(() => service.listAgentMessages(created.id, actorB), (error: unknown) => (
    Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404)
  ));

  const actions = await service.listAgentActions(actorA);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.toolName, 'get_dashboard_summary');
  assert.equal(actions[0]?.riskLevel, 'read');
  assert.equal(actions[0]?.approvalStatus, 'not_required');
});

test('customer tools enforce customer ownership before returning data', async () => {
  const { Customer } = await import('../src/models');
  const customer = await Customer.create({ projectId: projectA, ownerId: userA, name: 'Authorized Buyer', source: 'manual' });
  const own = await tools.executeAgentTool('get_current_customer', { actor: actorA }, { customerId: customer.id }) as { name: string };
  assert.equal(own.name, 'Authorized Buyer');
  await assert.rejects(
    () => tools.executeAgentTool('get_current_customer', { actor: actorB }, { customerId: customer.id }),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404),
  );
  await assert.rejects(
    () => tools.executeAgentTool('delete_customer', { actor: actorA }, { customerId: customer.id }),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 400),
  );
});

test('status is safe to expose and never contains the API key', () => {
  const status = service.getAgentStatus();
  const serialized = JSON.stringify(status);
  assert.equal(status.readOnly, true);
  assert.equal(status.toolCount, 6);
  assert.equal('apiKey' in status, false);
  assert.equal(serialized.includes('OPENAI_API_KEY'), false);
  assert.equal(serialized.includes('Bearer '), false);
});

test('OpenAI adapter uses stateless Responses API with strict server-side tools', async () => {
  const { OpenAIResponsesProvider } = await import('../src/services/agent/openai-provider');
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = init?.headers;
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'call_1', name: 'get_dashboard_summary', arguments: '{}' }],
      usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const adapter = new OpenAIResponsesProvider({ apiKey: 'server-only-test-key', model: 'test-model', baseUrl: 'https://api.openai.test/v1/', timeoutMs: 5000 });
    const turn = await adapter.createTurn({
      instructions: 'read only',
      input: [{ role: 'user', content: 'summary' }],
      tools: tools.agentToolSchemas(),
      context: { type: 'global' },
      userPrompt: 'summary',
      safetyIdentifier: 'hashed-user',
    });
    assert.equal(capturedUrl, 'https://api.openai.test/v1/responses');
    assert.equal(new Headers(capturedHeaders).get('Authorization'), 'Bearer server-only-test-key');
    assert.equal(capturedBody.store, false);
    assert.equal(capturedBody.parallel_tool_calls, false);
    assert.deepEqual(capturedBody.include, ['reasoning.encrypted_content']);
    assert.equal((capturedBody.tools as { strict: boolean }[]).every((tool) => tool.strict), true);
    assert.equal(turn.toolCalls[0]?.name, 'get_dashboard_summary');
    assert.equal(turn.usage.totalTokens, 16);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
