import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import PDFDocument from 'pdfkit';
import type { AuthUser } from '../src/types/express';
process.env.NODE_ENV = 'test'; process.env.AI_PROVIDER = 'mock'; process.env.MAIL_CHANNEL = 'mock';
let memory: MongoMemoryServer, mongoose: typeof import('mongoose'), directory: string;
let service: typeof import('../src/services/knowledge/document.service');
let models: typeof import('../src/models/KnowledgeDocument');
let parser: typeof import('../src/services/knowledge/parser-process');
let business: typeof import('../src/models');
let server: Server, base: string, token: string;
const projectId = new Types.ObjectId(), userId = new Types.ObjectId(), otherProject = new Types.ObjectId();
const actor: AuthUser = { id: String(userId), projectId: String(projectId), role: 'admin', username: 's1-fixture-admin', displayName: 'S1 Fixture' };
const other = { ...actor, projectId: String(otherProject) };
async function upload(name: string, data?: Buffer) {
  return service.uploadDocument({ fileName: name, data: (data ?? await readFile(join(directory, name))).toString('base64'), source: 'FICTIONAL S1 ONLY', category: 'trade' }, actor);
}
async function parsed(name: string, data?: Buffer) {
  const d = await upload(name, data);
  const p = await models.KnowledgeParsing.findOne({ documentId: d.id }).sort({ revision: -1 });
  await service.processKnowledgeDocument(p!.id);
  return service.documentDetail(d.id, actor);
}
before(async () => {
  assert.ok(process.env.KNOWLEDGE_PYTHON, 'Set KNOWLEDGE_PYTHON to the installed isolated runtime');
  assert.ok(process.env.KNOWLEDGE_TOKENIZER_DIR, 'Set pinned local tokenizer path');
  directory = await mkdtemp(join(tmpdir(), 's1-fixtures-'));
  const generated = spawnSync(process.env.KNOWLEDGE_PYTHON!, ['tests/fixtures/knowledge-s1/generate.py', '--output', directory], { encoding: 'utf8', windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  // Generate a real static text PDF independently of the parser under test.
  const pdf = new PDFDocument({ autoFirstPage: true }); const parts: Buffer[] = [];
  const bytes = new Promise<Buffer>(r => { pdf.on('data', b => parts.push(b)); pdf.on('end', () => r(Buffer.concat(parts))); });
  pdf.text('FICTIONAL policy\nMOQ 73 pcs for cotton only.\nUSD 2.35 / pc for 200 pcs.\n* Excludes freight; after artwork approval.'); pdf.end();
  const { writeFile } = await import('node:fs/promises'); await writeFile(join(directory, 'text.pdf'), await bytes);
  memory = await MongoMemoryServer.create({ instance: { dbName: 's1_isolated_fictional' } });
  mongoose = await import('mongoose'); await mongoose.connect(memory.getUri('s1_isolated_fictional'));
  service = await import('../src/services/knowledge/document.service'); models = await import('../src/models/KnowledgeDocument');
  parser = await import('../src/services/knowledge/parser-process'); business = await import('../src/models');
  await Promise.all(Object.values(models).map(m => m.init()));
  await business.Project.insertMany([projectId, otherProject].map((p, i) => ({ _id: p, name: 'FICTIONAL S1 '+i, slug: 's1-fixture-'+i, code: 'S1'+i, companyName: 'FICTIONAL ONLY', mailProfileKey: 's1-fixture' })));
  await business.User.create({ _id: userId, username: actor.username, passwordHash: 'not-a-login-hash', role: 'admin', status: 'active', projectIds: [projectId] });
  const { createApp } = await import('../src/app');
  const { signToken } = await import('../src/services/auth.service');
  const user = await business.User.findById(userId); token = signToken({id:String(user!._id),username:user!.username,displayName:user!.displayName,role:user!.role}).token;
  server = createServer(createApp()); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api';
});
after(async () => { if (server) await new Promise<void>(r => server.close(() => r())); if (mongoose) await mongoose.disconnect(); await memory?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('UTF-8, Markdown headings, exact codepoint positions and complete conditional table rows', async () => {
  const text = await parsed('unicode.txt'); assert.equal(text.revisions[0].state, 'succeeded');
  const raw = Array.from((await readFile(join(directory, 'unicode.txt'))).toString('utf8'));
  for (const c of text.chunks) assert.equal(raw.slice(Number(c.location!.start), Number(c.location!.end)).join('').trim(), c.content);
  const md = await parsed('bilingual.md');
  assert.ok(md.chunks.some(c => c.content?.includes('73') && c.content.includes('19')));
  const row = md.chunks.find(c => c.content?.includes('2.35')); assert.ok(row?.headers?.[0].includes('USD'));
  assert.match(row!.content!, /excludes freight/); assert.ok(row!.headingPath?.includes('Prices'));
  const oversize = await parsed('oversized.txt'); assert.equal(oversize.chunks.length, 1); assert.equal(oversize.chunks[0].indexEligible, false);
  assert.equal(oversize.chunks[0].content, (await readFile(join(directory, 'oversized.txt'))).toString('utf8').trim());
});
test('DOCX, XLSX and CSV retain repeated headers, table conditions, notes, ranges, formulas without evaluation', async () => {
  for (const name of ['conditions.docx', 'conditions.xlsx', 'table.csv']) {
    const d = await parsed(name); assert.ok(['succeeded', 'partial'].includes(d.revisions[0].state), JSON.stringify(d.revisions[0].error));
    const prices = d.chunks.filter(c => c.content?.includes('2.35') || c.content?.includes('3.90'));
    assert.ok(prices.length >= 2, name); for (const c of prices) { assert.match(c.content!, /USD/); assert.match(c.content!, /freight/); assert.ok(c.headers?.length); assert.ok(c.location); assert.ok(c.table); }
    if (name.endsWith('docx')) assert.ok(prices.some(c => c.footnotes?.some(n => n.includes('200 pcs'))));
    if (name.endsWith('xlsx')) { assert.ok(d.chunks.some(c => c.content?.includes('未计算公式: 2+2'))); assert.ok(prices.some(c => c.location?.mergedCells)); }
  }
});
test('static PDF, scanned PDF, PNG/JPEG use real local OCR with page geometry; blank image never succeeds', async () => {
  const pdf = await parsed('text.pdf'); assert.match(pdf.chunks[0].content!, /73 pcs/); assert.equal(pdf.chunks[0].location?.page, 1);
  for (const name of ['scan.png', 'scan.jpg', 'scan.pdf', 'low.png']) {
    const d = await parsed(name); assert.equal(d.revisions[0].state, 'partial', JSON.stringify(d.revisions[0].error));
    assert.ok(d.chunks.length); assert.ok(d.chunks[0].location?.ocrLines); assert.equal(d.chunks[0].indexEligible, false);
    if (name !== 'low.png') { assert.match(d.chunks[0].content!, /73/); assert.match(d.chunks[0].content!, /19/); }
  }
  const blank = await parsed('blank.png'); assert.equal(blank.revisions[0].state, 'failed'); assert.equal(blank.revisions[0].error?.code, 'no_text');
});
test('malicious/corrupt/over-limit files fail individually without executing or fetching content', async () => {
  const cases: [string, string][] = [['encoding.txt', 'encoding'], ['empty.txt', 'no_text'], ['fake.pdf', 'format_mismatch'], ['bad.pdf', 'parse_failed'], ['active.pdf', 'active_pdf'],
    ['macro.docx', 'active_content'], ['external.docx', 'external_links'], ['path.docx', 'unsafe_archive'], ['bomb.docx', 'archive_limit'], ['entity.docx', 'unsafe_xml'],
    ['many-pages.pdf', 'page_limit'], ['many-sheets.xlsx', 'sheet_limit'], ['wide.xlsx', 'cell_limit']];
  for (const [name, code] of cases) { const d = await parsed(name); assert.equal(d.revisions[0].state, 'failed', name); assert.equal(d.revisions[0].error?.code, code, name); assert.equal(d.chunks.length, 0); await assert.rejects(service.originalDocument(d.document.id,actor)); }
  const hostile = await parsed('attack.txt'); assert.ok(hostile.chunks[0].warnings?.some(w => w.includes('疑似指令')));
  assert.equal(await business.DevelopmentLetter.countDocuments(), 0); assert.equal(await business.FollowUp.countDocuments(), 0);
});
test('project deduplication and HTTP permissions, invalid filename/base64/size; original download reauthorizes', async () => {
  const first = await upload('unicode.txt'), second = await upload('renamed.txt', await readFile(join(directory, 'unicode.txt')));
  assert.equal(first.id, second.id); assert.equal(second.duplicate, true);
  assert.equal((await service.originalDocument(first.id, actor)).bytes.toString('utf8'), (await readFile(join(directory, 'unicode.txt'))).toString('utf8'));
  await assert.rejects(service.originalDocument(first.id, other)); await assert.rejects(service.documentDetail(first.id, { ...actor, role: 'user' }));
  await assert.rejects(service.uploadDocument({ fileName: '../bad.txt', data: 'eA==', source: 'Fixture', category: 'trade' }, actor));
  await assert.rejects(service.uploadDocument({ fileName: 'x.txt', data: '%%%!', source: 'Fixture', category: 'trade' }, actor));
  await assert.rejects(service.uploadDocument({ fileName: 'x.exe', data: 'eA==', source: 'Fixture', category: 'trade' }, actor));
  const anon = await fetch(base + '/knowledge-documents'); assert.equal(anon.status, 401);
  const own = await fetch(base + '/knowledge-documents/' + first.id, { headers: { Authorization: 'Bearer ' + token, 'X-Project-Id': String(projectId) } }); assert.equal(own.status, 200);
  const foreign = await fetch(base + '/knowledge-documents/' + first.id + '/original', { headers: { Authorization: 'Bearer ' + token, 'X-Project-Id': String(otherProject) } }); assert.equal(foreign.status, 404);
});
test('cancel queued/running work, retry creates a new revision, expired lease resumes after restart with fenced artifacts', async () => {
  const d = await upload('cancel.txt', Buffer.from('FICTIONAL cancel test. MOQ 73 pcs for cotton only.'));
  let p = (await service.documentDetail(d.id, actor)).revisions[0];
  await service.controlParsing(String(p.id), 'cancel', actor); await service.processKnowledgeDocument(String(p.id));
  assert.equal((await service.documentDetail(d.id, actor)).revisions[0].state, 'cancelled');
  const retry = await service.controlParsing(String(p.id), 'retry', actor);
  await models.KnowledgeParsing.updateOne({ _id: (retry as { id: string }).id }, { $set: { state: 'running', leaseToken: 'dead-worker', leaseUntil: new Date(Date.now()-1000), attempts: 1 } });
  await service.processKnowledgeDocument((retry as { id: string }).id);
  const done = await service.documentDetail(d.id, actor); assert.equal(done.revisions[0].revision, 2); assert.equal(done.revisions[0].state, 'succeeded'); assert.equal(done.revisions.length, 2); assert.equal(done.chunks.length, 1);
  const historical=await service.documentDetail(d.id,actor,0,String(done.revisions[1].id));assert.equal(historical.chunks.length,0);await assert.rejects(service.documentDetail(d.id,other,0,String(done.revisions[0].id)));
  await service.processKnowledgeDocument((retry as { id: string }).id); assert.equal((await service.documentDetail(d.id, actor)).chunks.length, 1);
  const scan = await upload('cancel-scan.png', Buffer.concat([await readFile(join(directory, 'scan.png')), Buffer.from('unique cancellation fixture')])); p = (await service.documentDetail(scan.id, actor)).revisions[0];
  const running = service.processKnowledgeDocument(String(p.id));
  await new Promise(r => setTimeout(r, 300)); await service.controlParsing(String(p.id), 'cancel', actor); await running;
  const cancelled = await service.documentDetail(scan.id, actor); assert.equal(cancelled.revisions[0].state, 'cancelled'); assert.equal(cancelled.chunks.length, 0);
});
test('worker revalidates authority; parser changed, runtime absent, timeout and abort are explicit failures', async () => {
  const d = await upload('revoked.txt', Buffer.from('Fictional revoked task.'));
  const p = (await service.documentDetail(d.id, actor)).revisions[0];
  await business.User.updateOne({ _id: userId }, { $set: { status: 'disabled' } });
  await service.processKnowledgeDocument(String(p.id)); assert.equal((await service.documentDetail(d.id, actor)).revisions[0].error?.code, 'authority_revoked');
  await business.User.updateOne({ _id: userId }, { $set: { status: 'active' } });
  const changed = await upload('changed.txt', Buffer.from('Fictional changed config.'));
  await models.KnowledgeParsing.updateOne({ documentId: changed.id }, { $set: { configHash: 'obsolete' } });
  await service.processKnowledgeDocument(); assert.equal((await service.documentDetail(changed.id, actor)).revisions[0].error?.code, 'parser_changed');
  const old = process.env.KNOWLEDGE_PYTHON; delete process.env.KNOWLEDGE_PYTHON;
  await assert.rejects(parser.runParser(Buffer.from('a'), 'txt', service.digest('a'), new AbortController().signal, async () => {}), /未配置/);
  process.env.KNOWLEDGE_PYTHON = old;
  const abort = new AbortController(); abort.abort();
  await assert.rejects(parser.runParser(Buffer.from('a'), 'txt', service.digest('a'), abort.signal, async () => {}), /取消/);
  assert.equal(resolve(directory).startsWith(tmpdir()), true);
});
test('reviewed chunks save only immutable draft references, repeat save is idempotent; legacy mapping changes no existing version', async () => {
  const { AgentKnowledge } = await import('../src/models/AgentKnowledge');
  const d = await parsed('review.txt', Buffer.from('Fictional reference MOQ 73 pcs for cotton, excludes foil.'));
  const c = d.chunks[0];
  const input = { title: 'FICTIONAL reviewed sample', content: c.content!, category: 'trade' as const, applicability: 'Cotton only, fixture not real policy' };
  const first = await service.saveChunkDraft(c.id, input, actor), second = await service.saveChunkDraft(c.id, input, actor);
  assert.equal(first.id, second.id); const knowledge = await AgentKnowledge.findById(first.id);
  assert.equal(knowledge!.approvedVersion, 0); assert.equal(knowledge!.revisions[0].sourceRefs?.[0].chunkId, c.id);
  const before = JSON.stringify(knowledge!.toObject()); const preview = await service.legacyPreview(actor); assert.equal(preview.changesKnowledge, false);
  const mapped = await service.mapLegacy(first.id, 1, actor); await service.mapLegacy(first.id, 1, actor);
  assert.equal((await service.documentDetail(mapped.id, actor)).chunks.length, 1);
  assert.equal(JSON.stringify((await AgentKnowledge.findById(first.id))!.toObject()), before);
  assert.equal(await business.Customer.countDocuments(), 0); assert.equal(await business.DevelopmentLetter.countDocuments(), 0);
});

test('Agent filters private mailbox text before tools, timeline and outbound-root thread aggregation; missing owner is quarantined', async () => {
  const { MailMessage } = await import('../src/models/MailMessage');
  const { agentMailOrThrow } = await import('../src/services/agent/mail-access');
  const { executeAgentTool } = await import('../src/services/agent/tool-registry');
  const { getCustomerTimeline } = await import('../src/services/timeline.service');
  const a = new Types.ObjectId(), b = new Types.ObjectId();
  const sales: AuthUser = { ...actor, id: String(a), role: 'user' };
  const buyer = await business.Customer.create({ projectId, ownerId: a, name: 'FICTIONAL ACL Buyer', email: 's1-acl@example.test' });
  const baseMail = { projectId, customerId: buyer._id, threadId: 's1-acl-thread', from: buyer.email, subject: 'FICTIONAL', sentAt: new Date() };
  const owned = await MailMessage.create({ ...baseMail, mailboxUserId: a, dedupKey: 's1-own', text: 'OWN_VISIBLE' });
  const foreign = await MailMessage.create({ ...baseMail, mailboxUserId: b, dedupKey: 's1-foreign', text: 'OTHER_PRIVATE_NEVER_ENTER_CONTEXT' });
  const unowned = await MailMessage.create({ ...baseMail, dedupKey: 's1-unowned', text: 'UNKNOWN_OWNER' });
  const shared = await MailMessage.create({ ...baseMail, visibility: 'project_shared', dedupKey: 's1-shared', text: 'EXPLICIT_SHARED' });
  assert.equal((await agentMailOrThrow(owned.id, sales)).id, owned.id);
  await assert.rejects(agentMailOrThrow(foreign.id, sales)); await assert.rejects(agentMailOrThrow(foreign.id, actor));
  await assert.rejects(agentMailOrThrow(unowned.id, actor)); assert.equal((await agentMailOrThrow(shared.id, sales)).id, shared.id);
  const thread = await executeAgentTool('get_mail_thread', { actor: sales }, { mailId: owned.id, direction: 'inbound' });
  assert.doesNotMatch(JSON.stringify(thread), /OTHER_PRIVATE|UNKNOWN_OWNER/); assert.match(JSON.stringify(thread), /OWN_VISIBLE/);
  const timeline = await getCustomerTimeline(buyer.id, 30, sales); assert.doesNotMatch(JSON.stringify(timeline), new RegExp(foreign.id + '|' + unowned.id));
  const outbound = await business.DevelopmentLetter.create({ projectId, customerId: buyer._id, recipientName: buyer.name, recipientEmail: buyer.email, subject: 'Fixture', content: 'Draft only', contentText: 'Draft only', status: 'draft', threadId: baseMail.threadId });
  const fromOutbound = await executeAgentTool('get_mail_thread', { actor: sales }, { mailId: outbound.id, direction: 'outbound' });
  assert.doesNotMatch(JSON.stringify(fromOutbound), /OTHER_PRIVATE|UNKNOWN_OWNER/);
  await business.Customer.updateOne({ _id: buyer._id }, { $set: { ownerId: b } });
  await assert.rejects(agentMailOrThrow(owned.id, { ...sales, id: String(b) }));
  await assert.rejects(agentMailOrThrow(owned.id, sales));
  assert.equal(await business.DevelopmentLetter.countDocuments({ status: { $ne: 'draft' } }), 0);
});

test('source/task insertion gap recovers; timeout kills a real isolated process without a success artifact', async () => {
  const { writeFile } = await import('node:fs/promises');
  const d = await upload('orphan.txt', Buffer.from('Fictional orphan recovery only.'));
  await models.KnowledgeParsing.deleteMany({ documentId: d.id });
  await service.recoverUnqueuedDocuments();
  const p = (await service.documentDetail(d.id, actor)).revisions[0]; assert.equal(p.state, 'queued');
  await service.processKnowledgeDocument(String(p.id)); assert.equal((await service.documentDetail(d.id, actor)).revisions[0].state, 'succeeded');
  const fake = join(directory, 'slow-fixture.py');
  await writeFile(fake, 'import time\ntime.sleep(30)\n');
  await writeFile(join(directory, 'runtime-lock.json'), await readFile(resolve('parsers/runtime-lock.json')));
  const oldScript = process.env.KNOWLEDGE_PARSER_SCRIPT, oldTimeout = parser.parserConfig.timeoutMs;
  try {
    process.env.KNOWLEDGE_PARSER_SCRIPT = fake; parser.parserConfig.timeoutMs = 150;
    await assert.rejects(parser.runParser(Buffer.from('x'), 'txt', service.digest('x'), new AbortController().signal, async () => {}), (e: unknown) => (e as { code: string }).code === 'timeout');
  } finally { parser.parserConfig.timeoutMs = oldTimeout; if (oldScript) process.env.KNOWLEDGE_PARSER_SCRIPT = oldScript; else delete process.env.KNOWLEDGE_PARSER_SCRIPT; }
});

test('actual worker termination and replacement process recover the durable lease without duplicate accepted chunks', async () => {
  const { spawn } = await import('node:child_process');
  const { writeFile, unlink } = await import('node:fs/promises');
  const fake = join(directory, 'crash-wrapper.py'), marker = join(directory, 'crash-marker');
  const originalParser = resolve('parsers/knowledge_parser.py');
  await writeFile(marker, 'FICTIONAL fault injection');
  await writeFile(fake, `from pathlib import Path\nimport time,runpy\nif Path(${JSON.stringify(marker)}).exists(): time.sleep(30)\nrunpy.run_path(${JSON.stringify(originalParser)},run_name='__main__')\n`);
  const old = process.env.KNOWLEDGE_PARSER_SCRIPT;
  process.env.KNOWLEDGE_PARSER_SCRIPT = fake;
  let first: ReturnType<typeof spawn> | undefined;
  try {
    const d = await upload('restart.txt', Buffer.from('FICTIONAL process restart. MOQ 73 pcs for cotton only.'));
    const job = (await service.documentDetail(d.id, actor)).revisions[0];
    const env = { ...process.env, S1_TEST_URI: memory.getUri('s1_isolated_fictional'), S1_TEST_JOB: String(job.id) };
    first = spawn(process.execPath, ['--require', './tests/os-user-info.cjs', 'tests/fixtures/knowledge-s1/worker.cjs'], { env, windowsHide: true, stdio: 'ignore' });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && (await models.KnowledgeParsing.findById(job.id))?.state !== 'running') await new Promise(r => setTimeout(r, 50));
    assert.equal((await models.KnowledgeParsing.findById(job.id))?.state, 'running');
    // Stop the exact isolated test process and only its children. The parser
    // has no database credential and cannot commit anything after parent loss.
    const tree = spawnSync(process.env.KNOWLEDGE_PYTHON!, ['-c', 'import psutil,sys,json;print(json.dumps([p.pid for p in psutil.Process(int(sys.argv[1])).children(recursive=True)]))', String(first.pid)], { encoding: 'utf8', windowsHide: true });
    const childPids: number[] = JSON.parse(tree.stdout || '[]');
    const exited = new Promise<void>(r => first!.once('exit', () => r())); first.kill(); await exited;
    for (const pid of childPids) { try { process.kill(pid); } catch { /* child may have exited first */ } }
    assert.equal((await models.KnowledgeParsing.findById(job.id))?.state, 'running');
    assert.equal((await service.documentDetail(d.id, actor)).chunks.length, 0);
    await unlink(marker);
    // Expire the lease clock explicitly instead of sleeping for its whole TTL.
    await models.KnowledgeParsing.updateOne({ _id: job.id }, { $set: { leaseUntil: new Date(Date.now()-1000) } });
    const replacement = spawn(process.execPath, ['--require', './tests/os-user-info.cjs', 'tests/fixtures/knowledge-s1/worker.cjs'], { env, windowsHide: true, stdio: 'ignore' });
    const exit = await new Promise<number | null>((r, reject) => { replacement.once('error', reject); replacement.once('exit', r); });
    assert.equal(exit, 0);
    const recovered = await service.documentDetail(d.id, actor);
    assert.equal(recovered.revisions[0].state, 'succeeded', JSON.stringify(recovered.revisions[0].error));
    assert.equal(recovered.revisions[0].attempts, 2); assert.equal(recovered.chunks.length, 1);
  } finally { if (first && first.exitCode === null) first.kill(); if (old) process.env.KNOWLEDGE_PARSER_SCRIPT = old; else delete process.env.KNOWLEDGE_PARSER_SCRIPT; }
});

test('file-only HTTP upload and one-click staging preserve text and references without publishing', async () => {
  const { AgentKnowledge } = await import('../src/models/AgentKnowledge');
  const mailCount = await business.DevelopmentLetter.countDocuments(), followupCount = await business.FollowUp.countDocuments();
  const text = 'FICTIONAL file-only sample. Cotton only: MOQ 73 pcs; 19 days after artwork approval. 运费另行确认。';
  const headers = { Authorization: 'Bearer ' + token, 'X-Project-Id': String(projectId), 'Content-Type': 'application/json' };
  const response = await fetch(base + '/knowledge-documents', {method:'POST',headers,body:JSON.stringify({fileName:'虚构资料-仅文件.txt',data:Buffer.from(text).toString('base64')})});
  assert.equal(response.status,201);
  const uploaded = (await response.json()).data as {id:string};
  const before = await service.documentDetail(uploaded.id,actor);
  assert.equal(before.document.source,'虚构资料-仅文件.txt'); assert.equal(before.document.category,'pending');
  assert.equal(before.revisions[0].state,'queued');
  await service.processKnowledgeDocument(String(before.revisions[0].id));
  const detail = await service.documentDetail(uploaded.id,actor), chunk = detail.chunks[0];
  assert.equal(detail.revisions[0].state,'succeeded'); assert.equal(chunk.content,text);
  const stage = await fetch(base + '/knowledge-documents/chunks/'+chunk.id+'/draft',{method:'POST',headers,body:'{}'});
  assert.equal(stage.status,201);
  const draft = (await stage.json()).data as {id:string};
  const saved = await AgentKnowledge.findById(draft.id);
  assert.equal(saved!.approvedVersion,0); assert.equal(saved!.revisions[0].approved,false);
  assert.equal(saved!.revisions[0].title,'虚构资料-仅文件.txt'); assert.equal(saved!.revisions[0].content,text);
  assert.equal(saved!.revisions[0].source,'虚构资料-仅文件.txt');
  assert.equal(saved!.revisions[0].applicability,service.UNREVIEWED_APPLICABILITY);
  assert.equal(saved!.revisions[0].sourceRefs?.[0].chunkId,chunk.id);
  assert.ok(saved!.revisions[0].terms?.every(t=>t.mode==='needs_confirmation'));
  assert.equal((await service.saveChunkDraft(chunk.id,{},actor)).id,draft.id);
  await assert.rejects(service.saveChunkDraft(chunk.id,{},other));
  await assert.rejects(service.saveChunkDraft(chunk.id,{}, {...actor,role:'user'}));
  await assert.rejects(service.uploadDocument({fileName:'forbidden.txt',data:'eA=='},{...actor,role:'user'}));
  assert.equal(await business.DevelopmentLetter.countDocuments(),mailCount); assert.equal(await business.FollowUp.countDocuments(),followupCount);
});

test('optional upload metadata remains editable; staging validates overrides and never truncates long conditions', async () => {
  const { AgentKnowledge } = await import('../src/models/AgentKnowledge');
  const d = await parsed('optional-review.txt',Buffer.from('FICTIONAL manual source. Minimum order 91 pcs for linen only.'));
  assert.equal(d.document.source,'FICTIONAL S1 ONLY'); assert.equal(d.document.category,'trade');
  const chunk = d.chunks[0];
  await assert.rejects(service.saveChunkDraft(chunk.id,{content:'x'.repeat(12001)},actor));
  await assert.rejects(service.saveChunkDraft(chunk.id,{title:''},actor));
  assert.equal(await AgentKnowledge.countDocuments({importKey:'document-chunk:'+chunk.id}),0);
  const staged = await service.saveChunkDraft(chunk.id,{title:'Custom title',applicability:'Fictional linen only'},actor);
  const saved = await AgentKnowledge.findById(staged.id);
  assert.equal(saved!.revisions[0].category,'trade'); assert.equal(saved!.revisions[0].title,'Custom title');
  assert.equal(saved!.revisions[0].applicability,'Fictional linen only'); assert.equal(saved!.approvedVersion,0);
  const long = await parsed('long-conditions.txt',Buffer.from('FICTIONAL '+ 'Keep all conditions together; '.repeat(500)));
  assert.ok(long.chunks[0].content!.length>12000);
  await assert.rejects(service.saveChunkDraft(long.chunks[0].id,{},actor));
  assert.equal(await AgentKnowledge.countDocuments({importKey:'document-chunk:'+long.chunks[0].id}),0);
});
