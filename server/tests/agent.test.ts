import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AuthUser } from '../src/types/express';

let memory: MongoMemoryServer;
let mongoose: typeof import('mongoose');
let service: typeof import('../src/services/agent/agent.service');
let tools: typeof import('../src/services/agent/tool-registry');
let workflow: typeof import('../src/services/agent/scratchpad-customer.service');
let analysisWorkflow: typeof import('../src/services/agent/customer-analysis.service');

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
  await Promise.all([
    models.AgentSession.init(), models.AgentMessage.init(), models.AgentRun.init(), models.AgentAction.init(),
    models.AgentCustomerPreview.init(), models.Scratchpad.init(), models.Customer.init(), models.User.init(),
    models.AgentCustomerAnalysis.init(), models.DevelopmentLetter.init(), models.FollowUp.init(), models.CustomerEvent.init(), models.Quotation.init(),
  ]);
  await models.User.insertMany([
    { _id: userA, username: 'alice', passwordHash: 'test-hash', displayName: 'Alice', role: 'user', projectIds: [projectA] },
    { _id: userB, username: 'bob', passwordHash: 'test-hash', displayName: 'Bob', role: 'user', projectIds: [projectA] },
  ]);
  service = await import('../src/services/agent/agent.service');
  tools = await import('../src/services/agent/tool-registry');
  workflow = await import('../src/services/agent/scratchpad-customer.service');
  analysisWorkflow = await import('../src/services/agent/customer-analysis.service');
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

test('scratchpad customer workflow extracts, isolates, updates, confirms once, and keeps the note', async () => {
  const { AgentAction, Customer, Scratchpad } = await import('../src/models');
  const note = [
    '公司: Northstar Trading Ltd',
    '联系人: Mia Chen',
    '邮箱: mia.v11@example.com',
    '电话: +86 138 0013 8000',
    '国家: Singapore',
    '行业: Consumer Electronics',
    '需求: 需要 500 台便携式储能产品，先寄样品',
    '来源: Exhibition',
    '优先级: 高',
  ].join('\n');
  await Scratchpad.create({ projectId: projectA, userId: userA, content: note, version: 1 });

  const preview = await workflow.createScratchpadCustomerPreview({ idempotencyKey: 'extract-v11-00000001' }, actorA);
  assert.equal(preview.fields.company, 'Northstar Trading Ltd');
  assert.equal(preview.fields.name, 'Mia Chen');
  assert.equal(preview.fields.priority, 'high');
  assert.equal(preview.duplicates.length, 0);

  const repeated = await workflow.createScratchpadCustomerPreview({ idempotencyKey: 'extract-v11-00000001' }, actorA);
  assert.equal(repeated.id, preview.id);
  await assert.rejects(
    () => workflow.getScratchpadCustomerPreview(preview.id, actorB),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404),
  );
  await assert.rejects(
    () => workflow.getScratchpadCustomerPreview(preview.id, actorOtherProject),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404),
  );

  const updated = await workflow.updateScratchpadCustomerPreview(preview.id, {
    expectedVersion: preview.version,
    fields: { ...preview.fields, requirementNotes: `${preview.fields.requirementNotes}；交期 30 天` },
  }, actorA);
  assert.equal(updated.version, preview.version + 1);
  const created = await workflow.confirmScratchpadCustomerPreview(preview.id, {
    expectedVersion: updated.version, idempotencyKey: 'confirm-v11-00000001', duplicateAcknowledged: false,
  }, actorA);
  assert.ok(created.customerId);
  const repeatedConfirmation = await workflow.confirmScratchpadCustomerPreview(preview.id, {
    expectedVersion: updated.version, idempotencyKey: 'confirm-v11-00000001', duplicateAcknowledged: false,
  }, actorA);
  assert.equal(repeatedConfirmation.customerId, created.customerId);
  assert.equal(repeatedConfirmation.idempotent, true);
  assert.equal(await Customer.countDocuments({ projectId: projectA, email: 'mia.v11@example.com' }), 1);
  assert.equal((await Scratchpad.findOne({ projectId: projectA, userId: userA }).lean())?.content, note);

  const audit = await AgentAction.findOne({ projectId: projectA, userId: userA, workflowId: preview.id, toolName: 'create_customer_from_scratchpad' }).lean();
  assert.equal(audit?.approvalStatus, 'approved');
  assert.equal(audit?.executionStatus, 'succeeded');
  assert.ok(audit?.approvedAt);
});

test('duplicate preview warns; cancellation and failed creation never modify scratchpad', async () => {
  const { Customer, Scratchpad } = await import('../src/models');
  await Scratchpad.updateOne({ projectId: projectA, userId: userA }, { $set: {
    content: '公司: Duplicate Co\n联系人: Duplicate Buyer\n邮箱: duplicate.v11@example.com\n需求: test',
  }, $inc: { version: 1 } });
  await Customer.create({ projectId: projectA, ownerId: userA, name: 'Existing Duplicate', email: 'duplicate.v11@example.com', source: 'manual' });
  const original = await Scratchpad.findOne({ projectId: projectA, userId: userA }).lean();

  const cancelledPreview = await workflow.createScratchpadCustomerPreview({ idempotencyKey: 'extract-v11-cancel01' }, actorA);
  assert.ok(cancelledPreview.duplicates.some((item) => item.reasons.includes('邮箱相同')));
  const cancelled = await workflow.cancelScratchpadCustomerPreview(cancelledPreview.id, actorA);
  assert.equal(cancelled.status, 'cancelled');
  await assert.rejects(
    () => workflow.confirmScratchpadCustomerPreview(cancelled.id, {
      expectedVersion: cancelled.version, idempotencyKey: 'confirm-v11-cancel01', duplicateAcknowledged: true,
    }, actorA),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 409),
  );

  const failedPreview = await workflow.createScratchpadCustomerPreview({ idempotencyKey: 'extract-v11-failed01' }, actorA);
  await assert.rejects(() => workflow.confirmScratchpadCustomerPreview(failedPreview.id, {
    expectedVersion: failedPreview.version, idempotencyKey: 'confirm-v11-failed01', duplicateAcknowledged: true,
  }, actorA));
  const failed = await workflow.getScratchpadCustomerPreview(failedPreview.id, actorA);
  assert.equal(failed.status, 'failed');
  const after = await Scratchpad.findOne({ projectId: projectA, userId: userA }).lean();
  assert.equal(after?.content, original?.content);
  assert.equal(after?.version, original?.version);
});

test('concurrent confirmation is locked and creates at most one customer', async () => {
  const { Customer, Scratchpad } = await import('../src/models');
  const note = '公司: Concurrent Co\n联系人: Lock Test\n邮箱: lock.v11@example.com\n来源: Website';
  await Scratchpad.updateOne({ projectId: projectA, userId: userA }, { $set: { content: note }, $inc: { version: 1 } });
  const preview = await workflow.createScratchpadCustomerPreview({ idempotencyKey: 'extract-v11-lock0001' }, actorA);
  const payload = { expectedVersion: preview.version, idempotencyKey: 'confirm-v11-lock0001', duplicateAcknowledged: false };
  const outcomes = await Promise.allSettled([
    workflow.confirmScratchpadCustomerPreview(preview.id, payload, actorA),
    workflow.confirmScratchpadCustomerPreview(preview.id, payload, actorA),
  ]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(await Customer.countDocuments({ projectId: projectA, email: 'lock.v11@example.com' }), 1);
  const retry = await workflow.confirmScratchpadCustomerPreview(preview.id, payload, actorA);
  assert.equal(retry.idempotent, true);
  assert.equal((await Scratchpad.findOne({ projectId: projectA, userId: userA }).lean())?.content, note);
});

test('customer analysis separates sourced facts and suggestions, then saves only a draft and schedules follow-up after confirmation', async () => {
  const { AgentAction, Customer, CustomerEvent, DevelopmentLetter } = await import('../src/models');
  const customer = await Customer.create({
    projectId: projectA, ownerId: userA, name: 'Olivia Stone', company: 'Northwind Retail', email: 'olivia.analysis@example.com',
    country: 'United Kingdom', industry: 'Retail', requirementNotes: 'Looking for 800 recycled tote bags for a spring campaign.',
    priority: 'high', source: 'manual',
  });
  const analysis = await analysisWorkflow.createCustomerAnalysis({
    customerId: customer.id, idempotencyKey: 'analysis-v12-create-0001',
  }, actorA);
  assert.ok(analysis.facts.length > 0);
  assert.ok(analysis.recommendations.length > 0);
  assert.ok(analysis.facts.every((claim) => claim.sourceIds.length > 0));
  assert.ok(analysis.recommendations.every((claim) => claim.sourceIds.length > 0));
  const knownSources = new Set(analysis.sources.map((source) => source.sourceId));
  assert.ok(analysis.facts.flatMap((claim) => claim.sourceIds).every((id) => knownSources.has(id)));
  assert.match(analysis.emailDraft.bodyText, /^Dear Olivia Stone,/);

  const repeated = await analysisWorkflow.createCustomerAnalysis({
    customerId: customer.id, idempotencyKey: 'analysis-v12-create-0001',
  }, actorA);
  assert.equal(repeated.id, analysis.id);
  await assert.rejects(
    () => analysisWorkflow.getCustomerAnalysis(analysis.id, actorB),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404),
  );

  const dueAt = new Date(Date.now() + 5 * 86400000);
  const edited = await analysisWorkflow.updateCustomerAnalysis(analysis.id, {
    expectedVersion: analysis.version,
    emailDraft: { subject: 'Recycled tote bag requirements', bodyText: 'Dear Olivia,\n\nCould you confirm the preferred dimensions and delivery date?\n\nBest regards,' },
    followUpPlan: { method: 'email', content: 'Confirm dimensions and delivery date.', dueAt },
  }, actorA);
  const emailSaved = await analysisWorkflow.saveAnalysisEmailDraft(analysis.id, {
    expectedVersion: edited.version, idempotencyKey: 'analysis-v12-email-0001',
  }, actorA);
  assert.equal(emailSaved.analysis.emailStatus, 'saved');
  const draft = await DevelopmentLetter.findById(emailSaved.letterId).lean();
  assert.equal(draft?.status, 'draft');
  assert.equal(draft?.sentAt, undefined);
  assert.equal(draft?.subject, 'Recycled tote bag requirements');
  assert.equal((await Customer.findById(customer._id).lean())?.letterCount, 0);
  const repeatedEmail = await analysisWorkflow.saveAnalysisEmailDraft(analysis.id, {
    expectedVersion: edited.version, idempotencyKey: 'analysis-v12-email-0001',
  }, actorA);
  assert.equal(repeatedEmail.idempotent, true);
  assert.equal(await DevelopmentLetter.countDocuments({ projectId: projectA, requestKey: `agent-analysis-email:${analysis.id}` }), 1);

  const scheduled = await analysisWorkflow.scheduleAnalysisFollowUp(analysis.id, {
    expectedVersion: emailSaved.analysis.version, idempotencyKey: 'analysis-v12-followup-01',
  }, actorA);
  assert.equal(scheduled.analysis.followUpStatus, 'scheduled');
  assert.equal((await Customer.findById(customer._id).lean())?.nextFollowUpAt?.getTime(), dueAt.getTime());
  assert.equal(await CustomerEvent.countDocuments({ projectId: projectA, customerId: customer._id, type: 'followup_scheduled' }), 1);
  const repeatedSchedule = await analysisWorkflow.scheduleAnalysisFollowUp(analysis.id, {
    expectedVersion: emailSaved.analysis.version, idempotencyKey: 'analysis-v12-followup-01',
  }, actorA);
  assert.equal(repeatedSchedule.idempotent, true);

  const actions = await AgentAction.find({ projectId: projectA, userId: userA, workflowId: analysis.id }).lean();
  const saveAction = actions.find((action) => action.toolName === 'save_agent_email_draft');
  const followUpAction = actions.find((action) => action.toolName === 'schedule_agent_followup');
  assert.equal(saveAction?.approvalStatus, 'approved');
  assert.equal(saveAction?.executionStatus, 'succeeded');
  assert.equal(followUpAction?.approvalStatus, 'approved');
  assert.equal(followUpAction?.executionStatus, 'succeeded');
});

test('OpenAI adapter uses stateless Responses API with strict server-side tools', async () => {
  const { OpenAIResponsesProvider } = await import('../src/services/agent/openai-provider');
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedHeaders: HeadersInit | undefined;
  const capturedBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = init?.headers;
    const capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedBodies.push(capturedBody);
    if ((capturedBody.text as { format?: { name?: string } } | undefined)?.format?.name === 'customer_analysis_and_email_draft') {
      return new Response(JSON.stringify({
        status: 'completed',
        output_text: JSON.stringify({
          facts: [{ text: 'Structured fact', sourceIds: ['profile:1'] }],
          gaps: [{ text: 'Structured gap', sourceIds: ['profile:1'] }],
          recommendations: [{ text: 'Structured recommendation', rationale: 'Structured rationale', sourceIds: ['profile:1'] }],
          emailDraft: { subject: 'Next steps', bodyText: 'Dear Ava,\n\nHello.\n\nBest regards,' },
          followUpPlan: { method: 'email', content: 'Follow up', dueAt: '2030-01-02T03:04:05.000Z' },
        }),
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (capturedBody.text) {
      return new Response(JSON.stringify({
        status: 'completed',
        output_text: JSON.stringify({
          fields: { company: 'Structured Co', name: 'Ava', email: '', phone: '', country: '', industry: '', requirementNotes: '', leadSource: '', priority: 'medium' },
          uncertainties: [{ field: 'email', reason: 'missing', confidence: 0.2 }],
        }),
        usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
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
    assert.equal(capturedBodies[0]?.store, false);
    assert.equal(capturedBodies[0]?.parallel_tool_calls, false);
    assert.deepEqual(capturedBodies[0]?.include, ['reasoning.encrypted_content']);
    assert.equal((capturedBodies[0]?.tools as { strict: boolean }[]).every((tool) => tool.strict), true);
    assert.equal(turn.toolCalls[0]?.name, 'get_dashboard_summary');
    assert.equal(turn.usage.totalTokens, 16);
    const extraction = await adapter.extractCustomer({ content: 'Company: Structured Co', safetyIdentifier: 'hashed-user' });
    assert.equal(extraction.fields.company, 'Structured Co');
    assert.equal(extraction.usage.totalTokens, 12);
    const format = (capturedBodies[1]?.text as { format?: { type?: string; strict?: boolean; schema?: { additionalProperties?: boolean } } }).format;
    assert.equal(format?.type, 'json_schema');
    assert.equal(format?.strict, true);
    assert.equal(format?.schema?.additionalProperties, false);
    assert.equal(capturedBodies[1]?.store, false);
    const analysis = await adapter.analyzeCustomer({
      input: { customerName: 'Ava', sourceCatalog: [{ sourceId: 'profile:1', kind: 'profile', label: 'profile', content: { name: 'Ava' } }] },
      safetyIdentifier: 'hashed-user',
    });
    assert.equal(analysis.facts[0]?.sourceIds[0], 'profile:1');
    const analysisFormat = (capturedBodies[2]?.text as { format?: { name?: string; type?: string; strict?: boolean } }).format;
    assert.equal(analysisFormat?.name, 'customer_analysis_and_email_draft');
    assert.equal(analysisFormat?.type, 'json_schema');
    assert.equal(analysisFormat?.strict, true);
    assert.equal(capturedBodies[2]?.store, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
