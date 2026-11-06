import mongoose, { Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { IntegrationInquiry, IntegrationInquiryAttachment, IntegrationInquiryLock } from '../models/IntegrationInquiry';
import { Customer, Project, User, IntegrationIdempotency, Product } from '../models';
import { getTenantContext } from '../models/tenant-context';
import { ApiError } from '../utils/ApiError';
import { encryptCredential, decryptCredential } from './credential-crypto';
import { reserveIdempotency, completeIdempotency, abandonIdempotency, fillEmptyFields, stableJson, findIntegrationCustomerByEmail } from './integration.service';
import { normalizeCountry } from '../utils/country';
import type { InquiryInput } from '../validators/integration-inquiry.validator';
import type { AuthUser } from '../types/express';
import { customerScope, assertCustomerAccess } from '../utils/access';
import { getCustomerByIdOrThrow } from './customer.service';
import { isEmailSuppressed } from './mail-compliance.service';
import { sendLetter } from './letter.service';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const literal = (s: string) => s.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
export function inquiryScope(projectId: string) {
    const ctx = getTenantContext();
    if (!ctx?.organizationId || ctx.bypass)
        throw ApiError.projectMismatch();
    return { projectId: new Types.ObjectId(projectId), organizationId: new Types.ObjectId(ctx.organizationId) };
}
export function inquiryPayload(row: any) { const data = JSON.parse(decryptCredential(row.secret)); if (data.organizationId !== String(row.organizationId) || data.inquiryId !== String(row._id))
    throw ApiError.internal('询盘数据校验失败'); return data.body as InquiryInput; }
export function inquiryHash(body: InquiryInput) { return hash(stableJson({ ...body, attachments: body.attachments.map(({ downloadUrl: _url, expiresAt: _expires, ...a }) => a) })); }
const publicMail = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'qq.com', '163.com', '126.com', 'mail.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'yandex.com']);
async function ownerFor(scope: ReturnType<typeof inquiryScope>, session: mongoose.ClientSession) {
    const project = await Project.findOne({ _id: scope.projectId, organizationId: scope.organizationId, status: 'active' }).session(session);
    if (!project)
        throw ApiError.projectMismatch();
    const allowed = { $or: [{ role: 'admin' }, { role: 'project_admin', projectIds: scope.projectId }] };
    const creator = project.createdBy ? await User.findOne({ _id: project.createdBy, organizationId: scope.organizationId, status: { $ne: 'disabled' }, ...allowed }).session(session) : null;
    return creator ?? await User.findOne({ organizationId: scope.organizationId, status: { $ne: 'disabled' }, ...allowed }).sort({ _id: 1 }).session(session);
}
export async function receiveInquiry(input: {
    credentialId: string;
    projectId: string;
    key: string;
    body: InquiryInput;
}) {
    const scope = inquiryScope(input.projectId), body = input.body, requestHash = inquiryHash(body);
    const reservation = await reserveIdempotency<any>(input.credentialId, input.projectId, 'inq:' + hash(input.key), hash('inquiries:' + input.projectId + ':' + requestHash));
    if (reservation.kind === 'replay')
        return { result: reservation.result, statusCode: reservation.statusCode };
    let result: any;
    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await mongoose.connection.transaction(async (session) => {
                    const live = await IntegrationIdempotency.exists({ _id: reservation.id, state: 'processing', owner: reservation.owner, leaseExpiresAt: { $gt: new Date() } }).session(session);
                    if (!live)
                        throw ApiError.conflict('幂等处理租约已被接管');
                    await IntegrationInquiryLock.findOneAndUpdate(scope, { $inc: { version: 1 } }, { upsert: true, new: true, session });
                    const prior = await IntegrationInquiry.findOne({ ...scope, sourceSystem: 'globalsite', externalInquiryId: body.externalInquiryId }).select('+secret').session(session);
                    if (prior) {
                        if (prior.requestHash !== requestHash)
                            throw ApiError.conflict('外部询盘ID已被不同内容使用');
                        result = prior.response;
                        return;
                    }
                    const owner = await ownerFor(scope, session);
                    for (const p of body.products)
                        if (p.crmProductId && !await Product.exists({ ...scope, _id: p.crmProductId }).session(session))
                            throw ApiError.projectMismatch();
                    const email = body.contact.email.toLowerCase();
                    let customer = await findIntegrationCustomerByEmail(input.projectId, email).where({ organizationId: scope.organizationId }).session(session);
                    if (!customer) {
                        const matches = await Customer.find({ ...scope, email: new RegExp('^' + literal(email) + '$', 'i') }).limit(2).session(session);
                        if (matches.length === 1)
                            customer = matches[0];
                    }
                    const domain = email.split('@')[1];
                    if (!customer && !publicMail.has(domain)) {
                        const matches = await Customer.find({ ...scope, email: new RegExp('@' + literal(domain) + '$', 'i') }).limit(2).session(session);
                        if (matches.length === 1)
                            customer = matches[0];
                    }
                    const created = !customer;
                    const fields = { schemaVersion: '1.0', sourceSystem: 'globalsite', externalId: body.externalInquiryId, name: body.contact.name, email, phone: body.contact.phone.slice(0, 60), company: body.contact.company, country: normalizeCountry(body.contact.country) ?? '', interestedProducts: body.products.map(p => p.name).join(', ').slice(0, 500), expectedQuantity: body.quantity === null ? '' : String(body.quantity), leadSource: 'globalsite' };
                    if (!customer) {
                        [customer] = await Customer.create([{ ...scope, ...fields, status: 'pending', source: 'integration', externalSystem: 'globalsite', externalId: 'contact:' + hash(email), ...(owner ? { ownerId: owner._id } : {}), tags: ['globalsite'] }], { session });
                    }
                    else {
                        fillEmptyFields(customer, fields);
                        await customer.save({ session });
                    }
                    customer.set('globalSiteSource', true);
                    customer.set('globalSiteLastInquiryAt', new Date(body.submittedAt));
                    customer.set('globalSiteLastSiteName', body.site.name);
                    customer.set('globalSiteLastPageUrl', body.source.pageUrl);
                    await customer.save({ session });
                    const inquiryId = new Types.ObjectId();
                    result = { inquiryId: String(inquiryId), customerId: String(customer._id), prospectId: null, customerUrl: '/customers/' + customer._id, projectId: input.projectId, action: created ? 'created' : 'linked', attachmentStatus: body.attachments.length ? 'pending' : 'none', sourceSystem: 'globalsite' };
                    const notify = [...new Set([owner ? String(owner._id) : null, customer.ownerId ? String(customer.ownerId) : null].filter(Boolean))];
                    await IntegrationInquiry.create([{ ...scope, _id: inquiryId, sourceSystem: 'globalsite', externalInquiryId: body.externalInquiryId, customerId: customer._id, requestHash, secret: encryptCredential(JSON.stringify({ organizationId: String(scope.organizationId), inquiryId: String(inquiryId), body })), submittedAt: new Date(body.submittedAt), siteName: body.site.name, notifyUserIds: notify, readBy: [], response: result }], { session });
                    for (const a of body.attachments)
                        await IntegrationInquiryAttachment.create([{ ...scope, inquiryId, attachmentId: a.id, status: 'pending', nextAttemptAt: new Date() }], { session });
                });
                break;
            }
            catch (error) {
                if ((error as any)?.code === 11000 && attempt < 2)
                    continue;
                throw error;
            }
        }
        return await completeIdempotency(reservation, result, 201);
    }
    catch (error) {
        await abandonIdempotency(reservation);
        throw error;
    }
}
export async function ownGlobalSiteInquiry(id: string, actor: AuthUser) {
    if (!/^[a-f0-9]{24}$/.test(id))
        throw ApiError.notFound('询盘不存在');
    const scope = inquiryScope(actor.projectId!);
    const row = await IntegrationInquiry.findOne({ ...scope, _id: id }).select('+secret');
    if (!row)
        throw ApiError.notFound('询盘不存在');
    const c = await Customer.findOne({ ...scope, _id: row.customerId });
    if (!c)
        throw ApiError.notFound('客户不存在');
    assertCustomerAccess(actor, c.ownerId, c.projectId);
    return row;
}
export async function listGlobalSiteInquiries(actor: AuthUser, query: {
    customerId?: string;
    cursor?: string;
    limit: number;
}) {
    const scope = inquiryScope(actor.projectId!);
    const customers = await Customer.find({ ...scope, ...customerScope(actor), ...(query.customerId ? { _id: query.customerId } : {}) }).select('_id').lean();
    const rows = await IntegrationInquiry.find({ ...scope, customerId: { $in: customers.map(c => c._id) }, ...(query.cursor ? { _id: { $lt: query.cursor } } : {}) }).select('+secret').sort({ _id: -1 }).limit(query.limit + 1);
    const items = [];
    for (const row of rows.slice(0, query.limit)) {
        const body = inquiryPayload(row), jobs = await IntegrationInquiryAttachment.find({ ...scope, inquiryId: row._id });
        items.push({ id: String(row._id), customerId: String(row.customerId), externalInquiryId: row.externalInquiryId, site: body.site, submittedAt: body.submittedAt, contact: body.contact, products: body.products, quantity: body.quantity, message: body.message, source: body.source, spamScore: body.spamScore, read: row.readBy.map(String).includes(actor.id), attachments: body.attachments.map(a => { const j = jobs.find(j => j.attachmentId === a.id); return { id: a.id, fileName: a.fileName, mime: a.mime, bytes: a.bytes, status: j?.status === 'stored' ? 'stored' : j?.status === 'failed' ? 'failed' : 'pending', errorCode: j?.errorCode ?? null, url: j?.status === 'stored' ? '/api/globalsite-inquiries/' + row._id + '/attachments/' + encodeURIComponent(a.id) : null }; }) });
    }
    return { items, hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit ? String(rows[query.limit - 1]._id) : null };
}
export async function inquiryNotifications(actor: AuthUser) {
    const scope = inquiryScope(actor.projectId!);
    const customers = await Customer.find({ ...scope, ...customerScope(actor) }).select('_id').lean();
    const filter = { ...scope, customerId: { $in: customers.map(c => c._id) }, notifyUserIds: actor.id, readBy: { $ne: actor.id } };
    const [rows, count] = await Promise.all([IntegrationInquiry.find(filter).sort({ _id: -1 }).limit(20), IntegrationInquiry.countDocuments(filter)]);
    return { items: rows.map(r => ({ id: String(r._id), customerId: String(r.customerId), url: '/customers/' + r.customerId + '#globalsite-inquiries', siteName: r.siteName, submittedAt: r.submittedAt.toISOString() })), count };
}
export async function markInquiryRead(id: string, actor: AuthUser) {
    const row = await ownGlobalSiteInquiry(id, actor);
    await IntegrationInquiry.updateOne({ _id: row._id, ...inquiryScope(actor.projectId!) }, { $addToSet: { readBy: actor.id } });
    return { read: true };
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export async function draftInquiryReply(id: string, actor: AuthUser) {
    const row = await ownGlobalSiteInquiry(id, actor), body = inquiryPayload(row);
    await getCustomerByIdOrThrow(String(row.customerId), actor);
    if (await isEmailSuppressed(actor.projectId!, body.contact.email))
        throw ApiError.conflict('该收件人已进入不再发送名单');
    const subject = 'Re: Your inquiry from ' + body.site.name;
    const paragraphs = ['Dear ' + body.contact.name + ',', 'Thank you for your inquiry. We have received your requirements and will review them with our team.', body.products.length ? 'We will review your interest in ' + body.products.map(p => p.name).join(', ') + '.' : 'Please share any additional application or specification details you would like us to consider.', 'We will confirm product suitability, availability and commercial terms separately before making a proposal.'];
    const content = paragraphs.map(s => '<p>' + escape(s) + '</p>').join('');
    const saved = await sendLetter({ customerId: String(row.customerId), subject: subject.slice(0, 300), content, recipientEmail: body.contact.email, saveAsDraft: true, markAsDeveloped: false, requestKey: 'globalsite_inquiry_' + row._id }, actor);
    return { letterId: saved.letter.id, customerId: String(row.customerId), status: 'draft', url: '/customers/' + row.customerId + '#letters' };
}
