import { randomUUID, createHash } from 'node:crypto';
import { IntegrationInquiry, IntegrationInquiryAttachment } from '../models/IntegrationInquiry';
import { Project } from '../models';
import { runWithTenant } from '../models/tenant-context';
import { inquiryPayload, inquiryScope, ownGlobalSiteInquiry } from './integration-inquiry.service';
import { downloadInquiryAttachment } from './integration-download.service';
import { putObject, getObject } from './storage.service';
import { imageMime } from './integration-publication.service';
import { ApiError } from '../utils/ApiError';
import type { AuthUser } from '../types/express';
export const inquiryAttachmentTransport = { download: downloadInquiryAttachment };
const owner = randomUUID();
const fence = (j: any) => ({ _id: j._id, organizationId: j.organizationId, projectId: j.projectId, status: 'running', owner: j.owner, fence: j.fence, leaseUntil: { $gt: new Date() } });
export async function processInquiryAttachment(job: any) {
    const scope = inquiryScope(String(job.projectId));
    if (!await IntegrationInquiryAttachment.exists({ ...fence(job), ...scope }))
        return;
    const row = await IntegrationInquiry.findOne({ ...scope, _id: job.inquiryId }).select('+secret');
    try {
        if (!row || !await Project.exists({ _id: scope.projectId, organizationId: scope.organizationId, status: 'active' }))
            throw Error('ATTACHMENT_SOURCE_UNAVAILABLE');
        const a = inquiryPayload(row).attachments.find(a => a.id === job.attachmentId);
        if (!a || new Date(a.expiresAt).getTime() <= Date.now())
            throw Error('ATTACHMENT_LINK_EXPIRED');
        const bytes = await inquiryAttachmentTransport.download(a.downloadUrl, 2097152);
        const mime = imageMime(bytes) ?? (bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null);
        if (bytes.length !== a.bytes || mime !== a.mime || createHash('sha256').update(bytes).digest('hex') !== a.sha256)
            throw Error('ATTACHMENT_CONTENT_MISMATCH');
        if (!await IntegrationInquiryAttachment.exists(fence(job)))
            return;
        const key = 'globalsite-' + job.organizationId + '-' + job._id;
        await putObject(key, bytes, mime);
        await IntegrationInquiryAttachment.updateOne(fence(job), { $set: { status: 'stored', key, mime, bytes: bytes.length }, $unset: { owner: 1, leaseUntil: 1, errorCode: 1 } });
    }
    catch (e) {
        const code = ['ATTACHMENT_LINK_EXPIRED', 'ATTACHMENT_CONTENT_MISMATCH', 'ATTACHMENT_SOURCE_UNAVAILABLE'].includes((e as Error)?.message) ? (e as Error).message : 'ATTACHMENT_DOWNLOAD_FAILED';
        const retry = code === 'ATTACHMENT_DOWNLOAD_FAILED' && job.attempts < 8;
        await IntegrationInquiryAttachment.updateOne(fence(job), { $set: { status: retry ? 'pending' : 'failed', errorCode: code, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts)) }, $unset: { owner: 1, leaseUntil: 1 } });
    }
}
let running: Promise<void> | undefined, timer: NodeJS.Timeout | undefined;
export async function tickInquiryAttachments() {
    const j = await runWithTenant({ bypass: true, source: 'inquiry-scheduler' }, () => IntegrationInquiryAttachment.findOneAndUpdate({ nextAttemptAt: { $lte: new Date() }, $or: [{ status: 'pending' }, { status: 'running', leaseUntil: { $lte: new Date() } }] }, { $set: { status: 'running', owner, leaseUntil: new Date(Date.now() + 60000) }, $inc: { fence: 1, attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1 } }));
    if (!j)
        return;
    await runWithTenant({ organizationId: String(j.organizationId), source: 'inquiry-worker' }, () => processInquiryAttachment(j));
}
export function startInquiryAttachmentWorker() { if (timer)
    return; timer = setInterval(() => { if (!running)
    running = tickInquiryAttachments().catch(() => undefined).finally(() => { running = undefined; }); }, 1500); }
export function stopInquiryAttachmentWorker() { if (timer)
    clearInterval(timer); timer = undefined; }
export async function downloadStoredInquiryAttachment(id: string, attachmentId: string, actor: AuthUser) {
    const row = await ownGlobalSiteInquiry(id, actor), scope = inquiryScope(actor.projectId!), job = await IntegrationInquiryAttachment.findOne({ ...scope, inquiryId: row._id, attachmentId, status: 'stored' });
    if (!job?.key)
        throw ApiError.notFound('附件尚未就绪');
    const a = inquiryPayload(row).attachments.find(a => a.id === attachmentId);
    if (!a)
        throw ApiError.notFound('附件不存在');
    return { bytes: await getObject(job.key, 2097152), mime: job.mime, name: a.fileName };
}
