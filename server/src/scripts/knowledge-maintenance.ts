/** Local-only administration, never imports bootstrap/mail workers. Credentials via private config file. */
import mongoose from 'mongoose';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { knowledgeOperations, codeVersion, workingTreeDirty } from '../services/knowledge/operations';
import { indexActor, requestIndex, startKnowledgeIndexWorker, stopKnowledgeIndexWorker } from '../services/knowledge/index.service';
import { startKnowledgeDocumentWorker, stopKnowledgeDocumentWorker } from '../services/knowledge/document.service';
import { semanticPool } from '../services/knowledge/embedding';
import { AgentKnowledge } from '../models/AgentKnowledge';
const command = process.argv[2];
let stop: NodeJS.Timeout | undefined;
async function main() {
    if (!['status', 'preflight', 'rebuild', 'worker'].includes(command))
        throw Error('invalid_command');
    const config = z.object({ mongodbUri: z.string().max(2048), projectId: z.string().regex(/^[a-f0-9]{24}$/i), actorId: z.string().regex(/^[a-f0-9]{24}$/i), receiptFile: z.string().min(1) }).strict().parse(JSON.parse(await readFile(process.argv[3], 'utf8')));
    const uri = new URL(config.mongodbUri);
    if (uri.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname))
        throw Error('loopback_mongo_required');
    await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 15000 });
    const actor = await indexActor({ id: config.actorId, projectId: config.projectId, role: 'admin', username: 'maintenance', displayName: 'maintenance' });
    if (actor.role !== 'admin')
        throw Error('admin_required');
    if (command === 'worker') {
        startKnowledgeDocumentWorker();
        startKnowledgeIndexWorker();
        await writeFile(config.receiptFile, JSON.stringify({ pid: process.pid, codeSha: codeVersion(), workingTreeDirty: workingTreeDirty(), startedAt: new Date(), mode: 'knowledge-only', mailWorkers: false, agentWorkers: false }));
        const close = async () => { stopKnowledgeDocumentWorker(); stopKnowledgeIndexWorker(); semanticPool.close(); if (stop)
            clearInterval(stop); await mongoose.disconnect(); };
        process.once('SIGINT', () => void close());
        process.once('SIGTERM', () => void close());
        stop = setInterval(() => undefined, 1000);
        return;
    }
    const result = command === 'preflight' ? { readOnly: true, codeSha: codeVersion(), compatibility: 'Existing revisions/82 real drafts are not rewritten', drafts: await AgentKnowledge.countDocuments({ projectId: config.projectId, approvedVersion: 0 }), publications: await AgentKnowledge.countDocuments({ projectId: config.projectId, approvedVersion: { $gt: 0 }, archived: false }), operations: await knowledgeOperations(actor) } : command === 'status' ? await knowledgeOperations(actor) : await requestIndex(actor, crypto.randomUUID());
    await writeFile(config.receiptFile, JSON.stringify(result, null, 2), { mode: 0o600 });
}
void main().catch(() => { console.error(JSON.stringify({ event: 'knowledge_maintenance_failed', action: command })); process.exitCode = 1; }).finally(async () => { if (command !== 'worker' || process.exitCode) {
    semanticPool.close();
    await mongoose.disconnect();
} });
