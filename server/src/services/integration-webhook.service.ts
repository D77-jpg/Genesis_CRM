import mongoose, { Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { IntegrationWebhook, IntegrationWebhookEvent, IntegrationWebhookAttempt } from '../models/IntegrationWebhook';
import { Customer, CustomerEvent, Quotation, Project, AuditLog } from '../models';
import { IntegrationInquiry } from '../models/IntegrationInquiry';
import { getTenantContext, runWithTenant } from '../models/tenant-context';
import { managementScope } from './integration-management.service';
import { encryptCredential, decryptCredential } from './credential-crypto';
import { webhookTarget, postWebhook } from './integration-webhook-http';
import { signWebhook } from './integration-webhook-signature';
import { ApiError } from '../utils/ApiError';
import type { AuthUser } from '../types/express';
export const WEBHOOK_EVENTS = ['lead.status_changed', 'deal.won', 'deal.lost', 'quotation.sent'] as const;
const now = () => new Date(), oid = (v: string) => new Types.ObjectId(v);
export function webhookScope(projectId: string) {
    const ctx = getTenantContext();
    if (!ctx?.organizationId || ctx.bypass || !Types.ObjectId.isValid(projectId))
        throw ApiError.projectMismatch();
    return { organizationId: oid(ctx.organizationId), projectId: oid(projectId) };
}
export function configDto(c: any) { return { id: String(c._id), projectId: String(c.projectId), targetUrl: c.targetUrl, events: c.events, enabled: c.enabled, revision: c.revision, generation: c.generation, keyId: String(c.keyId), activeSince: c.activeSince.toISOString(), updatedAt: c.updatedAt.toISOString() }; }
export function deliveryDto(e: any) { return { id: String(e._id), type: e.type, status: e.status, occurredAt: e.occurredAt.toISOString(), createdAt: e.createdAt.toISOString(), attempts: e.attempts, nextAttemptAt: e.nextAttemptAt.toISOString(), lastStatusCode: e.lastStatusCode ?? null, lastErrorCode: e.lastErrorCode ?? null, generation: e.generation }; }
function seal(c: any, secret: string) { return encryptCredential(JSON.stringify({ organizationId: String(c.organizationId), configId: String(c._id), secret })); }
export function signingSecret(c: any) { const data = JSON.parse(decryptCredential(c.secret)); if (data.organizationId !== String(c.organizationId) || data.configId !== String(c._id) || !/^[a-f0-9]{64}$/.test(data.secret))
    throw Error('WEBHOOK_SECRET_INVALID'); return data.secret as string; }
export function eventBody(e: any) { const d = JSON.parse(decryptCredential(e.secret)); if (d.organizationId !== String(e.organizationId) || d.eventId !== String(e._id))
    throw Error('WEBHOOK_PAYLOAD_INVALID'); return Buffer.from(d.body, 'utf8'); }
export async function getWebhook(actor: AuthUser) { const s = await managementScope(actor); const c = await IntegrationWebhook.findOne({ organizationId: s.organizationId, projectId: s.projectId }); return { config: c ? configDto(c) : null }; }
async function audit(session: mongoose.ClientSession, actor: AuthUser, action: string, id: string) { await AuditLog.create([{ actorId: actor.id, actorRole: actor.role, projectId: actor.projectId, action, targetType: 'integration_webhook', targetId: id, success: true, detail: {} }], { session }); }
export async function saveWebhook(actor: AuthUser, input: {
    revision: number;
    targetUrl: string;
    events: string[];
    enabled: boolean;
}, rotate = false) {
    const s = await managementScope(actor), scope = { organizationId: s.organizationId, projectId: s.projectId };
    const existing = await IntegrationWebhook.findOne(scope).select('+secret');
    if (existing && existing.revision !== input.revision || !existing && input.revision !== 0)
        throw ApiError.conflict('WEBHOOK_REVISION_CONFLICT');
    const target = input.targetUrl.trim();
    if (!existing || target !== existing.targetUrl || input.enabled)
        await webhookTarget(target);
    let issued: string | null = null, result: any;
    await mongoose.connection.transaction(async (session) => {
        const c = await IntegrationWebhook.findOne(scope).select('+secret').session(session);
        if (c && c.revision !== input.revision || !c && input.revision !== 0)
            throw ApiError.conflict('WEBHOOK_REVISION_CONFLICT');
        const events = [...input.events].sort();
        const changed = !c || rotate || c.targetUrl !== target || c.enabled !== input.enabled || JSON.stringify([...c.events].sort()) !== JSON.stringify(events);
        if (c?.ioUntil && c.ioUntil > now())
            throw ApiError.conflict('WEBHOOK_BUSY');
        if (!changed) {
            result = c;
            return;
        }
        const id = c ? c._id : new Types.ObjectId(), generation = (c?.generation ?? 0) + 1, stamp = now();
        const secret = rotate || !c ? (issued = randomBytes(32).toString('hex')) : signingSecret(c);
        const patch = { targetUrl: target, events, enabled: input.enabled, revision: (c?.revision ?? 0) + 1, generation, keyId: rotate || !c ? new Types.ObjectId() : c.keyId, activeSince: stamp, statusScan: null, quotationScan: null, ioUntil: null, ioOwner: null, secret: seal({ _id: id, organizationId: s.organizationId }, secret) };
        if (c) {
            const updated = await IntegrationWebhook.findOneAndUpdate({ ...scope, _id: id, revision: input.revision, $or: [{ ioUntil: null }, { ioUntil: { $lte: stamp } }] }, { $set: patch }, { new: true, session });
            if (!updated)
                throw ApiError.conflict('WEBHOOK_BUSY');
            result = updated;
        }
        else
            [result] = await IntegrationWebhook.create([{ ...scope, _id: id, ...patch }], { session });
        await IntegrationWebhookEvent.updateMany({ ...scope, configId: id, status: { $in: ['pending', 'running', 'failed'] } }, { $set: { status: 'cancelled', lastErrorCode: 'WEBHOOK_CONFIGURATION_CHANGED' } }, { session });
        await audit(session, actor, rotate ? 'integration.webhook.rotated' : 'integration.webhook.saved', String(id));
    });
    return { config: configDto(result), signingSecret: issued };
}
export async function rotateWebhook(actor: AuthUser, revision: number) { const s = await managementScope(actor), c = await IntegrationWebhook.findOne({ organizationId: s.organizationId, projectId: s.projectId }); if (!c)
    throw ApiError.notFound(); return saveWebhook(actor, { revision, targetUrl: c.targetUrl, events: c.events, enabled: c.enabled }, true); }
export async function listWebhookDeliveries(actor: AuthUser, q: {
    cursor?: string;
    limit: number;
    status?: string;
}) {
    const s = await managementScope(actor), rows = await IntegrationWebhookEvent.find({ organizationId: s.organizationId, projectId: s.projectId, ...(q.cursor ? { _id: { $lt: oid(q.cursor) } } : {}), ...(q.status ? { status: q.status } : {}) }).sort({ _id: -1 }).limit(q.limit + 1);
    return { items: rows.slice(0, q.limit).map(deliveryDto), hasMore: rows.length > q.limit, nextCursor: rows.length > q.limit ? String(rows[q.limit - 1]._id) : null };
}
export async function listWebhookAttempts(actor: AuthUser, id: string, q: {
    cursor?: string;
    limit: number;
}) {
    const s = await managementScope(actor), scope = { organizationId: s.organizationId, projectId: s.projectId };
    if (!await IntegrationWebhookEvent.exists({ ...scope, _id: id }))
        throw ApiError.notFound();
    const rows = await IntegrationWebhookAttempt.find({ ...scope, deliveryId: id, ...(q.cursor ? { _id: { $lt: oid(q.cursor) } } : {}) }).sort({ _id: -1 }).limit(q.limit + 1);
    return { items: rows.slice(0, q.limit).map(a => ({ id: String(a._id), deliveryId: String(a.deliveryId), attempt: a.attempt, status: a.status, startedAt: a.startedAt.toISOString(), finishedAt: a.finishedAt?.toISOString() ?? null, statusCode: a.statusCode ?? null, errorCode: a.errorCode ?? null, durationMs: a.durationMs ?? null })), hasMore: rows.length > q.limit, nextCursor: rows.length > q.limit ? String(rows[q.limit - 1]._id) : null };
}
export async function retryWebhook(actor: AuthUser, id: string) {
    const s = await managementScope(actor), scope = { organizationId: s.organizationId, projectId: s.projectId };
    let result: any;
    await mongoose.connection.transaction(async (session) => {
        const c = await IntegrationWebhook.findOne(scope).session(session), e = await IntegrationWebhookEvent.findOne({ ...scope, _id: id }).session(session);
        if (!e || !c)
            throw ApiError.notFound();
        if (!c.enabled || e.generation !== c.generation || String(e.configId) !== String(c._id))
            throw ApiError.conflict('WEBHOOK_CONFIGURATION_CHANGED');
        if (!['failed', 'delivered', 'pending'].includes(e.status) || c.ioUntil && c.ioUntil > now())
            throw ApiError.conflict('WEBHOOK_BUSY');
        const guard = await IntegrationWebhook.updateOne({ ...scope, _id: c._id, revision: c.revision, $or: [{ ioUntil: null }, { ioUntil: { $lte: now() } }] }, { $inc: { ioFence: 1 } }, { session });
        if (!guard.modifiedCount)
            throw ApiError.conflict('WEBHOOK_BUSY');
        result = await IntegrationWebhookEvent.findOneAndUpdate({ ...scope, _id: id, status: e.status }, { $set: { status: 'pending', nextAttemptAt: now(), lastErrorCode: null } }, { new: true, session });
        // Total attempts remain monotonic for logs; each manual redelivery gets another bounded retry cycle.
        await IntegrationWebhookEvent.updateOne({ ...scope, _id: id }, { $set: { retryBase: e.attempts } }, { session });
        await audit(session, actor, 'integration.webhook.retried', id);
    });
    return deliveryDto(result);
}
export const webhookTransport = { post: postWebhook };
const processOwner = randomUUID();
function leaseFilter(c: any) { return { ...webhookScope(String(c.projectId)), _id: c._id, generation: c.generation, enabled: true, ioOwner: c.ioOwner, ioFence: c.ioFence, ioUntil: { $gt: now() } }; }
async function assertLease(c: any, session: mongoose.ClientSession) { const r = await IntegrationWebhook.updateOne(leaseFilter(c), { $set: { ioUntil: new Date(Date.now() + 60000) } }, { session }); if (!r.matchedCount)
    throw Error('WEBHOOK_LEASE_LOST'); }
async function captureSource(c: any, kind: 'status' | 'quotation') {
    const scope = webhookScope(String(c.projectId)), field = kind === 'status' ? 'statusScan' : 'quotationScan', progress = c[field] ?? {}, model = kind === 'status' ? CustomerEvent : Quotation;
    const filter = kind === 'status' ? { type: 'status_changed', createdAt: { $gte: c.activeSince } } : { globalSiteSentAt: { $gte: c.activeSince } };
    const src = await (model as any).findOne({ ...scope, ...filter, ...(progress.pendingSource ? { _id: progress.pendingSource } : progress.lastSource ? { _id: { $gt: progress.lastSource } } : {}) }).select('+globalSiteSentAt').sort({ _id: 1 }).lean();
    if (!src) {
        await IntegrationWebhook.updateOne(leaseFilter(c), { $set: { [field]: null } });
        return;
    }
    const at = kind === 'status' ? src.at : src.globalSiteSentAt, eligibilityTime = kind === 'status' ? src.createdAt : at;
    const customer = await Customer.findOne({ ...scope, _id: src.customerId, $or: [{ globalSiteSource: true }, { leadSource: 'globalsite' }, { externalSystem: 'globalsite' }] }).select('_id');
    const links = customer ? await IntegrationInquiry.find({ ...scope, customerId: customer._id, sourceSystem: 'globalsite', createdAt: { $lte: eligibilityTime }, ...(progress.pendingSource && progress.inquiryCursor ? { _id: { $gt: progress.inquiryCursor } } : {}) }).sort({ _id: 1 }).limit(51) : [];
    const types = kind === 'quotation' ? ['quotation.sent'] : ['lead.status_changed', ...(src.toStatus === 'won' ? ['deal.won'] : src.toStatus === 'lost' ? ['deal.lost'] : [])];
    await mongoose.connection.transaction(async (session) => {
        await assertLease(c, session);
        for (const link of links.slice(0, 50))
            for (const type of types.filter(t => c.events.includes(t))) {
                const eventId = new Types.ObjectId(), body = { schemaVersion: '1.0', eventId: String(eventId), type, projectId: String(c.projectId), occurredAt: new Date(at).toISOString(), data: { sourceEventId: String(src._id), customerId: String(src.customerId), prospectId: null, crmInquiryId: String(link._id), externalInquiryId: link.externalInquiryId, fromStatus: kind === 'status' ? src.fromStatus ?? null : null, toStatus: kind === 'status' ? src.toStatus ?? null : null, quotationId: kind === 'quotation' ? String(src._id) : null } };
                const sourceKey = kind + ':' + src._id + ':' + type + ':' + link._id;
                await IntegrationWebhookEvent.updateOne({ ...scope, configId: c._id, generation: c.generation, sourceKey }, { $setOnInsert: { _id: eventId, type, occurredAt: at, secret: encryptCredential(JSON.stringify({ organizationId: String(c.organizationId), eventId: String(eventId), body: JSON.stringify(body) })), status: 'pending', nextAttemptAt: now() } }, { upsert: true, session });
            }
        await IntegrationWebhook.updateOne(leaseFilter(c), { $set: { [field]: links.length > 50 ? { lastSource: progress.lastSource ?? null, pendingSource: String(src._id), inquiryCursor: String(links[49]._id) } : { lastSource: String(src._id) } } }, { session });
    });
}
async function deliver(c: any) {
    const scope = webhookScope(String(c.projectId));
    let e: any, attempt: any;
    await mongoose.connection.transaction(async (session) => {
        await assertLease(c, session);
        const exhausted = await IntegrationWebhookEvent.find({ ...scope, configId: c._id, generation: c.generation, status: 'running', $expr: { $gte: [{ $subtract: ['$attempts', { $ifNull: ['$retryBase', 0] }] }, 8] } }).select('_id').session(session);
        await IntegrationWebhookAttempt.updateMany({ ...scope, deliveryId: { $in: exhausted.map(x => x._id) }, status: 'started' }, { $set: { status: 'unknown', finishedAt: now(), errorCode: 'WEBHOOK_PREVIOUS_ATTEMPT_UNKNOWN' } }, { session });
        await IntegrationWebhookEvent.updateMany({ ...scope, configId: c._id, generation: c.generation, status: 'running', $expr: { $gte: [{ $subtract: ['$attempts', { $ifNull: ['$retryBase', 0] }] }, 8] } }, { $set: { status: 'failed', lastErrorCode: 'WEBHOOK_RETRY_EXHAUSTED' } }, { session });
        e = await IntegrationWebhookEvent.findOneAndUpdate({ ...scope, configId: c._id, generation: c.generation, status: { $in: ['pending', 'running'] }, $expr: { $lt: [{ $subtract: ['$attempts', { $ifNull: ['$retryBase', 0] }] }, 8] }, nextAttemptAt: { $lte: now() } }, { $set: { status: 'running' }, $inc: { attempts: 1 } }, { new: true, session, sort: { nextAttemptAt: 1 } }).select('+secret');
        if (!e)
            return;
        await IntegrationWebhookAttempt.updateMany({ ...scope, deliveryId: e._id, status: 'started' }, { $set: { status: 'unknown', finishedAt: now(), errorCode: 'WEBHOOK_PREVIOUS_ATTEMPT_UNKNOWN' } }, { session });
        [attempt] = await IntegrationWebhookAttempt.create([{ ...scope, deliveryId: e._id, attempt: e.attempts, status: 'started', startedAt: now() }], { session });
    });
    if (!e)
        return;
    let status: number | null = null, errorCode: string | null = null, sourceUnavailable = false;
    const started = Date.now();
    try {
        if (!await IntegrationWebhook.exists(leaseFilter(c)))
            throw Error('WEBHOOK_LEASE_LOST');
        const body = eventBody(e), timestamp = String(Math.floor(Date.now() / 1000)), headers = { 'X-GlobalCRM-Timestamp': timestamp, 'X-GlobalCRM-Signature': signWebhook(body, timestamp, signingSecret(c)), 'X-GlobalCRM-Event-Id': String(e._id), 'X-GlobalCRM-Key-Id': String(c.keyId) };
        const payload = JSON.parse(body.toString('utf8'));
        if (payload.projectId !== String(c.projectId) || !await Project.exists({ organizationId: scope.organizationId, _id: c.projectId, status: 'active' }) || !await Customer.exists({ ...scope, _id: payload.data.customerId, $or: [{ globalSiteSource: true }, { leadSource: 'globalsite' }, { externalSystem: 'globalsite' }] }) || !await IntegrationInquiry.exists({ ...scope, _id: payload.data.crmInquiryId, customerId: payload.data.customerId, externalInquiryId: payload.data.externalInquiryId, sourceSystem: 'globalsite' })) {
            sourceUnavailable = true;
            throw Error('WEBHOOK_SOURCE_UNAVAILABLE');
        }
        const r = await webhookTransport.post(c.targetUrl, body, headers);
        status = r.status;
        if (status < 200 || status >= 300)
            errorCode = 'WEBHOOK_HTTP_FAILED';
    }
    catch {
        errorCode = sourceUnavailable ? 'WEBHOOK_SOURCE_UNAVAILABLE' : 'WEBHOOK_DELIVERY_FAILED';
    }
    const success = !errorCode, retry = !sourceUnavailable && !success && (e.attempts - (e.retryBase ?? 0)) < 8;
    await mongoose.connection.transaction(async (session) => {
        await assertLease(c, session);
        await IntegrationWebhookAttempt.updateOne({ ...scope, _id: attempt._id, status: 'started' }, { $set: { status: success ? 'delivered' : 'failed', finishedAt: now(), statusCode: status, errorCode, durationMs: Math.max(0, Date.now() - started) } }, { session });
        await IntegrationWebhookEvent.updateOne({ ...scope, _id: e._id, status: 'running', attempts: e.attempts }, { $set: { status: success ? 'delivered' : sourceUnavailable ? 'cancelled' : retry ? 'pending' : 'failed', lastStatusCode: status, lastErrorCode: errorCode, nextAttemptAt: new Date(Date.now() + Math.min(86400000, 30000 * 2 ** Math.min(e.attempts - (e.retryBase ?? 0) - 1, 12))) } }, { session });
    });
}
export async function tickWebhookConfig(id: string, projectId: string) {
    const scope = webhookScope(projectId);
    const c = await IntegrationWebhook.findOneAndUpdate({ ...scope, _id: id, enabled: true, $or: [{ ioUntil: null }, { ioUntil: { $lte: now() } }] }, { $set: { ioOwner: processOwner, ioUntil: new Date(Date.now() + 60000), lastTickAt: now() }, $inc: { ioFence: 1 } }, { new: true }).select('+secret');
    if (!c)
        return;
    const heart = setInterval(() => { void IntegrationWebhook.updateOne(leaseFilter(c), { $set: { ioUntil: new Date(Date.now() + 60000) } }).catch(() => undefined); }, 15000);
    try {
        if (!await Project.exists({ organizationId: scope.organizationId, _id: c.projectId, status: 'active' }))
            return;
        await captureSource(c, 'status');
        await captureSource(c, 'quotation');
        await deliver(c);
    }
    finally {
        clearInterval(heart);
        await IntegrationWebhook.updateOne(leaseFilter(c), { $unset: { ioOwner: 1, ioUntil: 1 } });
    }
}
let timer: NodeJS.Timeout | undefined, running: Promise<void> | undefined;
export async function tickWebhooks() {
    const rows = await runWithTenant({ bypass: true, source: 'webhook-scheduler' }, () => IntegrationWebhook.find({ enabled: true }).sort({ lastTickAt: 1, _id: 1 }).limit(20).select('_id organizationId projectId').lean().exec());
    for (let offset = 0; offset < rows.length; offset += 4)
        await Promise.allSettled(rows.slice(offset, offset + 4).map(c => runWithTenant({ organizationId: String(c.organizationId), source: 'webhook-worker' }, () => tickWebhookConfig(String(c._id), String(c.projectId)))));
}
export function startWebhookWorker() { if (timer)
    return; timer = setInterval(() => { if (!running)
    running = tickWebhooks().catch(() => undefined).finally(() => { running = undefined; }); }, 1500); }
export function stopWebhookWorker() { if (timer)
    clearInterval(timer); timer = undefined; }
