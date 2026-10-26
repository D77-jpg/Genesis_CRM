import { parserRuntimeStatus } from './parser-process';
import mongoose, { Schema, model, Types } from 'mongoose';
import { execFileSync } from 'node:child_process';
import { KnowledgeParsing } from '../../models/KnowledgeDocument';
import { KnowledgeIndexState, KnowledgeIndexGeneration } from '../../models/KnowledgeIndex';
import { DevelopmentLetter } from '../../models/DevelopmentLetter';
import { AgentTask } from '../../models/AgentTask';
import { AgentRun, AgentAction } from '../../models/Agent';
import { indexActor } from './index.service';
import { semanticPool, embeddingIdentity } from './embedding';
import { modelTransportStatus } from '../agent/model-transport';
import { logStatus } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../types/express';
const schema = new Schema({ projectId: { type: Schema.Types.ObjectId, required: true }, day: { type: String, required: true }, status: { type: String, required: true }, count: { type: Number, default: 0 }, totalMs: { type: Number, default: 0 }, maxMs: { type: Number, default: 0 }, expiresAt: { type: Date, required: true } }, { versionKey: false });
schema.index({ projectId: 1, day: 1, status: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const KnowledgeMetric = model('KnowledgeMetric', schema);
export async function observeRetrieval(projectId: string, status: string, ms: number) {
    if (!['ready', 'index_not_ready', 'index_stale', 'no_match', 'retrieval_failed', 'expired', 'conflict'].includes(status))
        return;
    await KnowledgeMetric.updateOne({ projectId: new Types.ObjectId(projectId), day: new Date().toISOString().slice(0, 10), status }, { $inc: { count: 1, totalMs: ms }, $max: { maxMs: ms }, $setOnInsert: { expiresAt: new Date(Date.now() + 90 * 86400000) } }, { upsert: true, maxTimeMS: 2000 }).catch(() => undefined);
}
export function codeVersion() { try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, windowsHide: true, timeout: 1000, maxBuffer: 4096, encoding: 'utf8' }).trim();
}
catch {
    return 'unavailable';
} }
export function workingTreeDirty() { try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'server/src', 'server/semantic', 'server/parsers'], { cwd: require('node:path').resolve(__dirname, '../../../..'), windowsHide: true, timeout: 1000, stdio: 'ignore' });
    return false;
}
catch {
    return true;
} }
function processSnapshot() {
    const memory = process.memoryUsage();
    return { uptimeSeconds: Math.round(process.uptime()), rssMiB: Math.round(memory.rss / 1024 / 1024 * 10) / 10, heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024 * 10) / 10 };
}
export async function knowledgeOperations(actor: AuthUser) {
    const current = await indexActor(actor);
    if (current.role !== 'admin')
        throw ApiError.forbidden();
    const projectId = new Types.ObjectId(current.projectId), since = new Date(Date.now() - 7 * 86400000), match = { projectId, createdAt: { $gte: since } };
    const grouped = async (m: {
        aggregate: Function;
    }, field: string) => m.aggregate([{ $match: match }, { $group: { _id: '$' + field, count: { $sum: 1 } } }]).option({ maxTimeMS: 5000 });
    const [parse, task, review, retrieval, indexes, states, cost, tools, citations] = await Promise.all([
        grouped(KnowledgeParsing, 'state'), grouped(AgentTask, 'status'), grouped(DevelopmentLetter, 'knowledgeReview.status'),
        KnowledgeMetric.find({ projectId, day: { $gte: since.toISOString().slice(0, 10) } }).select('-_id -projectId -expiresAt').maxTimeMS(5000).lean(),
        KnowledgeIndexGeneration.find({ projectId }).sort({ createdAt: -1 }).limit(10).select('state total done attempts createdAt updatedAt metrics').maxTimeMS(5000).lean(),
        KnowledgeIndexState.findOne({ projectId }).select('activeGeneration pendingGeneration revision updatedAt').maxTimeMS(5000).lean(),
        AgentRun.aggregate([{ $match: match }, { $group: { _id: '$provider', runs: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' }, estimatedCostUsd: { $sum: '$estimatedCostUsd' }, durationMs: { $sum: '$durationMs' } } }]).option({ maxTimeMS: 5000 }),
        grouped(AgentAction, 'executionStatus'), DevelopmentLetter.aggregate([{ $match: match }, { $unwind: '$knowledgeReview.factAudit.checks' }, { $group: { _id: '$knowledgeReview.factAudit.checks.status', count: { $sum: 1 } } }]).option({ maxTimeMS: 5000 })
    ]);
    const counts = (rows: {
        _id: string;
        count: number;
    }[], key: string) => rows.find(r => r._id === key)?.count ?? 0, parsedTotal = ['succeeded', 'partial', 'failed'].reduce((n, s) => n + counts(parse, s), 0), retrieved = retrieval.reduce((n, r) => n + r.count!, 0);
    return { projectId: String(projectId), windowDays: 7, codeSha: codeVersion(), workingTreeDirty: workingTreeDirty(), identity: await embeddingIdentity(), parse, tasks: task, draftReviewStates: review, citationStates: citations, retrieval, rates: { fullyParsed: parsedTotal ? counts(parse, 'succeeded') / parsedTotal : null, partialParse: parsedTotal ? counts(parse, 'partial') / parsedTotal : null, noMatch: retrieved ? retrieval.filter(r => r.status === 'no_match').reduce((n, r) => n + r.count!, 0) / retrieved : null, conflictDrafts: review.reduce((n: {
                total: number;
                conflicts: number;
            }, r: {
                _id: string;
                count: number;
            }) => ({ total: n.total + r.count, conflicts: n.conflicts + (r._id === 'conflict' ? r.count : 0) }), { total: 0, conflicts: 0 }) }, indexes, state: states, tools, model: cost, costBasis: 'Configured estimates, not vendor invoices; failed/unreported calls may have unknown charges', process: processSnapshot(), mongo: { state: mongoose.connection.readyState === 1 ? 'connected' : 'unavailable' }, component: { parser: parserRuntimeStatus(), semantic: semanticPool.status(), modelTransport: modelTransportStatus(), logs: logStatus() }, limitations: ['Process health is local to this Node instance', 'Draft review states measure saved drafts, not all model judgments', 'Mongo remains authoritative; no multi-host shared index support'] };
}
