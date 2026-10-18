import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { LocalProcessPool } from '../src/services/knowledge/process-pool';
const python = process.env.KNOWLEDGE_PYTHON!;
const config = () => ({ key: 'test-worker', python, script: join(__dirname, 'fixtures/knowledge-s7/pool.py'), env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, PYTHONIOENCODING: 'utf-8' } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pool = (extra = {}) => new LocalProcessPool(config, { workers: 1, queue: 2, queueTimeoutMs: 2000, timeoutMs: 2000, cooldownMs: 100, maxCalls: 10, ...extra });
test('S7 pool reuses actual process; incompatible model identity rotates it', async () => { const p = pool(); try {
    assert.ok(python);
    const a = await p.run({ identity: 'v1' }) as {
        pid: number;
    };
    const b = await p.run({ identity: 'v1' }) as {
        pid: number;
    };
    const c = await p.run({ identity: 'v2' }) as {
        pid: number;
    };
    assert.equal(a.pid, b.pid);
    assert.notEqual(a.pid, c.pid);
    assert.equal(p.status().completed, 3);
}
finally {
    p.close();
} });
test('S7 both warm workers survive between concurrent batches', async () => { const p = pool({ workers: 2 }); try {
    const first = await Promise.all([p.run({ delay: .05 }), p.run({ delay: .05 })]) as {
        pid: number;
    }[];
    const second = await Promise.all([p.run({ delay: .05 }), p.run({ delay: .05 })]) as {
        pid: number;
    }[];
    assert.deepEqual(first.map(r => r.pid).sort(), second.map(r => r.pid).sort());
    assert.equal(p.status().restarts, 2);
}
finally {
    p.close();
} });
test('S7 queue revoked after waiting never enters actual worker', async () => { const p = pool(); try {
    const first = p.run({ delay: .2 });
    let allowed = true;
    const next = p.run({ identity: 'private' }, undefined, async () => { if (!allowed)
        throw Error('authority_changed'); });
    allowed = false;
    await assert.rejects(next, /authority_changed/);
    await first;
    assert.equal(p.status().completed, 1);
}
finally {
    p.close();
} });
test('S7 active cancellation kills process, later request starts fresh process', async () => { const p = pool(); try {
    const a = await p.run({}) as {
        pid: number;
    }, abort = new AbortController();
    const run = p.run({ delay: 1 }, abort.signal);
    setTimeout(() => abort.abort(), 50);
    await assert.rejects(run, /cancelled/);
    const b = await p.run({}) as {
        pid: number;
    };
    assert.notEqual(a.pid, b.pid);
}
finally {
    p.close();
} });
test('S7 queue is bounded and waiting timeout never invokes worker', async () => { const p = pool({ queueTimeoutMs: 50, timeoutMs: 2000 }); try {
    const first = p.run({ delay: .2 });
    await sleep(15);
    const queued = [p.run({}), p.run({})];
    await assert.rejects(p.run({}), /capacity_busy/);
    await Promise.all(queued.map(v => assert.rejects(v, /queue_timeout/)));
    await first;
    assert.equal(p.status().completed, 1);
}
finally {
    p.close();
} });
test('S7 real hung process times out and restart is observable', async () => { const p = pool({ timeoutMs: 120 }); try {
    await assert.rejects(p.run({ delay: 1 }), /timeout/);
    await p.run({});
    assert.equal(p.status().restarts, 2);
}
finally {
    p.close();
} });
test('S7 three infrastructure failures open circuit, cooldown admits actual probe', async () => { const p = pool(); try {
    for (let n = 0; n < 3; n++)
        await p.run({ fail: true });
    assert.equal(p.status().circuitOpen, true);
    await assert.rejects(p.run({}), /circuit_open/);
    await sleep(110);
    await p.run({});
    assert.equal(p.status().circuitOpen, false);
}
finally {
    p.close();
} });
test('S7 shutdown rejects pending work; new requests do not restart component', async () => { const p = pool(); const results = [p.run({ delay: 1 }), p.run({})]; const checks = results.map(v => assert.rejects(v, /runtime_stopped/)); await sleep(30); p.close(); await Promise.all(checks); await assert.rejects(p.run({}), /runtime_stopped/); assert.equal(p.status().workers.length, 0); });
test('S7 bounded logs omit raw messages, document/email bodies, credentials and unsafe error codes', async () => {
    const { createLogger, logStatus } = await import('../src/config/logger');
    const lines: string[] = [];
    const original = console.log;
    console.log = (...parts: unknown[]) => { lines.push(parts.join(' ')); };
    try {
        const log = createLogger('s7-test');
        for (let n = 0; n < 200; n++)
            log.info('PRIVATE_DOCUMENT_SENTINEL', { subject: 'PRIVATE_EMAIL_SENTINEL', apiKey: 'PRIVATE_CREDENTIAL_SENTINEL', code: 'PRIVATECODE', status: 200 });
        assert.ok(lines.length <= 100);
        assert.ok(lines.every(l => Buffer.byteLength(l) <= 1024));
        assert.ok(!lines.join('').includes('PRIVATE'));
        assert.ok(logStatus().suppressed >= 100);
    }
    finally {
        console.log = original;
    }
});
test('S7 actual loopback LLM fault/timeout/circuit metrics never retry or change destination', async () => {
    const { createServer } = await import('node:http');
    const { guardedModelFetch, modelTransportStatus } = await import('../src/services/agent/model-transport');
    let calls = 0;
    const server = createServer((req, res) => { calls++; if (req.url === '/slow') {
        setTimeout(() => res.end('{}'), 100);
        return;
    } res.writeHead(req.url === '/good' ? 200 : 503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.url === '/good' ? { output_text: 'synthetic', usage: { input_tokens: 3, output_tokens: 4 } } : { error: { code: 'PRIVATE_UPSTREAM_ERROR', message: 'PRIVATE_BODY' } })); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
    try {
        for (let n = 0; n < 3; n++)
            await guardedModelFetch(base + '/failure', {});
        await assert.rejects(guardedModelFetch(base + '/failure', {}), { code: 'OPENAI_CIRCUIT_OPEN' });
        assert.equal(calls, 3);
        await assert.rejects(guardedModelFetch(base + '/slow', { signal: AbortSignal.timeout(20) }));
        const good = await guardedModelFetch(base + '/good', {});
        assert.equal(good.status, 200);
        const metrics = modelTransportStatus();
        assert.ok(metrics.failed >= 4);
        assert.ok(metrics.unknownUsage >= 4);
        assert.ok(metrics.inputTokens >= 3);
        assert.ok(!JSON.stringify(metrics).includes('PRIVATE'));
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    }
});
test('S7 encrypted actual Mongo/raw/version snapshot restores only to empty isolated target, then real semantic index rebuilds', async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Types } = mongoose;
    const { mkdtemp, rm, readFile, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { randomBytes } = await import('node:crypto');
    const { snapshotDatabase, restoreDatabase, createSnapshotKey } = await import('../src/services/knowledge/snapshot');
    const memory = await MongoMemoryServer.create(), suffix = randomBytes(6).toString('hex'), dir = await mkdtemp(join(tmpdir(), 's7-restore-')), key = join(dir, 'key.bin'), source = 's7_fictional_' + suffix, target = 's7_restore_test_' + suffix;
    const client = new mongoose.mongo.MongoClient(memory.getUri());
    await client.connect();
    const { Project } = await import('../src/models/Project'), { User } = await import('../src/models/User'), { AgentKnowledge } = await import('../src/models/AgentKnowledge');
    const { KnowledgeBlob, KnowledgeDocument, KnowledgeParsing } = await import('../src/models/KnowledgeDocument');
    const { requestIndex, processKnowledgeIndex } = await import('../src/services/knowledge/index.service');
    const { retrieveKnowledge } = await import('../src/services/agent/knowledge.service');
    const { KnowledgeIndexGeneration: Gen } = await import('../src/models/KnowledgeIndex');
    const { semanticPool } = await import('../src/services/knowledge/embedding');
    let facts: Record<string, unknown> = {};
    try {
        await mongoose.connect(memory.getUri(source));
        const project = new Types.ObjectId(), user = new Types.ObjectId();
        await Project.create({ _id: project, name: 'S7 FICTIONAL', slug: 's7-restore', code: 'S7', companyName: 'SYNTHETIC', mailProfileKey: 's7' });
        await User.create({ _id: user, username: 's7-restore', displayName: 'S7', passwordHash: 'not-a-login', role: 'admin', projectIds: [project] });
        const original = Buffer.from('# FICTIONAL velvet pouch\nSoft velvet drawstring bags for necklaces.\n'), { createHash } = await import('node:crypto');
        const rawHash = createHash('sha256').update(original).digest('hex');
        const blob = await KnowledgeBlob.create({ projectId: project, sha256: rawHash, data: original });
        const doc = await KnowledgeDocument.create({ projectId: project, kind: 'project_document', originalName: 'fictional.md', extension: '.md', bytes: original.length, sha256: rawHash, blobKey: blob._id, uploadedBy: user, source: 'fixture://s7', category: 'product' });
        await KnowledgeParsing.create({ projectId: project, documentId: doc._id, requestedBy: user, revision: 1, parserVersion: 'fixture-only', configHash: 'fixture-only', state: 'succeeded', chunkCount: 1 });
        await AgentKnowledge.create({ projectId: project, version: 2, approvedVersion: 1, archived: false, revisions: [1, 2].map(v => ({ version: v, title: 'Fictional velvet drawstring pouch', category: 'product', content: v === 1 ? 'Soft velvet drawstring bags for jewelry and necklaces.' : 'Unpublished revision canary', approved: v === 1, accessScope: 'project', products: [], terms: [], validFrom: new Date('2020-01-01'), source: 'fixture://s7', createdBy: user, createdAt: new Date() })) });
        await createSnapshotKey(key);
        const backup = join(dir, 'backup'), before = await client.db(source).collection('agentknowledges').countDocuments();
        await assert.rejects(snapshotDatabase(client.db(source), join(dir, 'denied'), key, { acknowledgeAllWritersStopped: false, configurationFiles: [] }), /quiescence_required/);
        await Promise.all(Object.values(mongoose.models).map(m => m.init()));
        const saved = await snapshotDatabase(client.db(source), backup, key, { acknowledgeAllWritersStopped: true, configurationFiles: [join(__dirname, '../semantic/model.json'), join(__dirname, '../semantic/reranker.json'), join(__dirname, '../semantic/runtime.py')] });
        const encrypted = await readFile(join(backup, 'database.aesgcm'));
        assert.ok(!encrypted.includes(Buffer.from('Unpublished revision')));
        await assert.rejects(restoreDatabase(client.db(source), backup, key), /fresh_restore_database_required/);
        const wrongKey = join(dir, 'wrong.key');
        await createSnapshotKey(wrongKey);
        await assert.rejects(restoreDatabase(client.db(target), backup, wrongKey));
        assert.equal((await client.db(target).listCollections().toArray()).length, 0);
        const restored = await restoreDatabase(client.db(target), backup, key);
        assert.equal(restored.verified, true);
        await assert.rejects(restoreDatabase(client.db(target), backup, key), /target_not_empty/);
        assert.equal(await client.db(source).collection('agentknowledges').countDocuments(), before);
        await mongoose.disconnect();
        await mongoose.connect(memory.getUri(target));
        const restoredBlob = await KnowledgeBlob.findById(blob._id).select('+data');
        assert.equal(createHash('sha256').update(restoredBlob!.data!).digest('hex'), rawHash);
        const record = await AgentKnowledge.findOne({ projectId: project });
        assert.equal(record!.approvedVersion, 1);
        assert.equal(record!.version, 2);
        assert.equal(record!.revisions.length, 2);
        process.env.KNOWLEDGE_INDEX_DIR = join(dir, 'rebuilt-index');
        process.env.KNOWLEDGE_RETRIEVAL_MODE = 'semantic';
        const actor = { id: String(user), projectId: String(project), username: 's7-restore', displayName: 'S7', role: 'admin' as const };
        const started = Date.now(), job = await requestIndex(actor, crypto.randomUUID());
        await processKnowledgeIndex(job.id);
        assert.equal((await Gen.findById(job.id))!.state, 'ready');
        const result = await retrieveKnowledge(actor, '柔软绒布珠宝抽绳袋');
        assert.equal(result.status, 'ready');
        assert.equal(result.sources[0].version, 1);
        assert.ok(!result.sources[0].content.includes('Unpublished'));
        facts = { snapshot: saved, restored, rebuildMs: Date.now() - started, retrieval: result.status, rawHashVerified: true, publishedVersion: 1, latestDraftVersion: 2, sourceUnchanged: true, externalCalls: 0 };
        // Actual queue gap: membership is revoked while two slots are waiting to dispatch.
        const { localEmbedding, embeddingIdentity } = await import('../src/services/knowledge/embedding');
        const identity = await embeddingIdentity();
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const blockers = [0, 1].map(() => localEmbedding.run({ command: 'embed', projectId: actor.projectId, texts: ['synthetic queue blocker'] }, identity, undefined, async () => gate));
        const querying = retrieveKnowledge(actor, 'velvet pouch');
        const deadline = Date.now() + 10000;
        while (semanticPool.status().queued < 1 && Date.now() < deadline)
            await sleep(10);
        assert.ok(semanticPool.status().queued >= 1);
        await User.updateOne({ _id: user }, { $set: { role: 'user', projectIds: [] } });
        release();
        await Promise.all(blockers);
        const revoked = await querying;
        assert.equal(revoked.status, 'retrieval_failed');
        assert.ok(revoked.issues.some(i => i.code === 'authority_changed' || i.code === 'retrieval_failed'));
        assert.deepEqual(revoked.sources, []);
        await User.updateOne({ _id: user }, { $set: { role: 'admin', projectIds: [project] } });
        // Exercise the operator CLI and real knowledge-only process, isolated from mail bootstrap.
        const { spawn } = await import('node:child_process');
        const configFile = join(dir, 'maintenance.json'), receiptFile = join(dir, 'receipt.json');
        await writeFile(configFile, JSON.stringify({ mongodbUri: memory.getUri(target), projectId: actor.projectId, actorId: actor.id, receiptFile }), { mode: 0o600 });
        const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'KNOWLEDGE_PYTHON', 'KNOWLEDGE_TOKENIZER_DIR', 'KNOWLEDGE_EMBEDDING_PYTHON', 'KNOWLEDGE_MODEL_DIR', 'KNOWLEDGE_INDEX_DIR', 'KNOWLEDGE_RERANKER_DIR'].includes(key)));
        const launch = (action: string) => spawn(process.execPath, ['--require', './tests/os-user-info.cjs', '--import', 'tsx', 'src/scripts/knowledge-maintenance.ts', action, configFile], { cwd: join(__dirname, '..'), env: { ...childEnv, NODE_ENV: 'development' }, windowsHide: true, stdio: 'ignore' });
        const preflight = launch('preflight');
        const [exit] = await once(preflight, 'close');
        assert.equal(exit, 0);
        assert.equal(JSON.parse(await readFile(receiptFile, 'utf8')).readOnly, true);
        await rm(receiptFile);
        const worker = launch('worker');
        try {
            const until = Date.now() + 10000;
            let receipt: Record<string, unknown> | undefined;
            while (Date.now() < until) {
                try {
                    receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
                    break;
                }
                catch {
                    await sleep(30);
                }
            }
            assert.ok(receipt);
            assert.equal(receipt.mailWorkers, false);
            assert.equal(receipt.agentWorkers, false);
            assert.equal(receipt.mode, 'knowledge-only');
            assert.match(String(receipt.codeSha), /^[a-f0-9]{40}$/);
            facts.maintenanceWorker = { started: true, mailWorkers: false, agentWorkers: false, codeSha: receipt.codeSha };
        }
        finally {
            const end = once(worker, 'close');
            worker.kill();
            await end;
        }
        const { knowledgeOperations } = await import('../src/services/knowledge/operations');
        const ops = await knowledgeOperations(actor);
        assert.equal(ops.projectId, String(project));
        assert.ok(ops.retrieval.some((row: {
            status: string;
        }) => row.status === 'ready'));
        await assert.rejects(knowledgeOperations({ ...actor, role: 'user' }));
        const { createApp } = await import('../src/app'), { signToken } = await import('../src/services/auth.service');
        const http = createApp().listen(0, '127.0.0.1');
        await once(http, 'listening');
        const url = 'http://127.0.0.1:' + (http.address() as import('node:net').AddressInfo).port + '/api/knowledge-index/operations';
        try {
            const headers = { Authorization: 'Bearer ' + signToken(actor).token, 'X-Project-Id': actor.projectId };
            assert.equal((await fetch(url)).status, 401);
            assert.equal((await fetch(url, { headers })).status, 200);
            assert.equal((await fetch(url + '?projectId=' + new Types.ObjectId(), { headers })).status, 422);
        }
        finally {
            await new Promise<void>(resolve => http.close(() => resolve()));
        }
    }
    finally {
        if (process.env.S7_RESTORE_REPORT)
            await writeFile(process.env.S7_RESTORE_REPORT, JSON.stringify(facts, null, 2));
        await mongoose.disconnect();
        await client.close();
        await memory.stop();
        await rm(dir, { recursive: true, force: true });
    }
});
test('S7 rotated file logs retain at most three bounded copies', async () => {
    const { mkdtemp, writeFile, stat, readdir, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { createLogger } = await import('../src/config/logger');
    const dir = await mkdtemp(join(tmpdir(), 's7-log-')), file = join(dir, 'runtime.log'), saved = process.env.CRM_LOG_FILE, log = console.log;
    process.env.CRM_LOG_FILE = file;
    console.log = () => undefined;
    try {
        for (let n = 0; n < 4; n++) {
            await writeFile(file, Buffer.alloc(2097150, 32));
            createLogger('operations').info('PRIVATE_DOCUMENT');
        }
        const files = await readdir(dir);
        assert.ok(files.length <= 3);
        for (const name of files)
            assert.ok((await stat(join(dir, name))).size <= 2097152);
    }
    finally {
        console.log = log;
        if (saved)
            process.env.CRM_LOG_FILE = saved;
        else
            delete process.env.CRM_LOG_FILE;
        await rm(dir, { recursive: true, force: true });
    }
});
test('S7 parser repeated local infrastructure failure opens circuit without consuming documents again', async () => {
    const { runParser, parserRuntimeStatus } = await import('../src/services/knowledge/parser-process');
    const saved = process.env.KNOWLEDGE_PYTHON;
    process.env.KNOWLEDGE_PYTHON = join(__dirname, 'missing-python.exe');
    try {
        for (let n = 0; n < 3; n++)
            await assert.rejects(runParser(Buffer.from('FICTIONAL'), '.txt', 'fixture', new AbortController().signal, async () => undefined));
        assert.equal(parserRuntimeStatus().circuitOpen, true);
        await assert.rejects(runParser(Buffer.from('FICTIONAL'), '.txt', 'fixture', new AbortController().signal, async () => undefined), { code: 'circuit_open' });
    }
    finally {
        process.env.KNOWLEDGE_PYTHON = saved;
    }
});
