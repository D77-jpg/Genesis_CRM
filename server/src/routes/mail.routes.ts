import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import path from 'node:path';
import fs from 'node:fs/promises';
import env from '../config/env';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, buildPaginated } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { customerRefScope, isAdmin, projectScope } from '../utils/access';
import { MailMessage, MailSyncState } from '../models/MailMessage';
import { DevelopmentLetter, Customer } from '../models';
import { getCustomerByIdOrThrow } from '../services/customer.service';
import { findThread, mailboxKey, personalMailboxKey, syncInbox, syncPersonalInbox } from '../services/mail-sync.service';
import { sendLetterSchema } from '../validators/letter.validator';
import { sendLetter } from '../services/letter.service';
import type { AuthUser } from '../types/express';
import { safeMailHtml } from '../services/mail-security';
import { trackingSummary } from '../services/mail-tracking.service';
import { getProjectMailConfig, imapConfigured, smtpConfigured } from '../services/project-mail-config.service';
import { getMailAccount } from '../services/mail-account.service';

const router = Router();
router.use(requireAuth);
const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/);
const params = z.object({ id: idSchema });
const listQuery = z.object({
  folder: z.enum(['inbox', 'unknown', 'sent', 'tasks']).default('inbox'),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
});
async function withCustomerNames<T extends { customerId?: unknown }>(items: T[]) {
  const ids = items.map(i => i.customerId).filter(Boolean);
  const customers = await Customer.find({ _id: { $in: ids } }).select('name');
  const names = new Map(customers.map(c => [String(c._id), c.name]));
  return items.map(i => ({ ...i, html: '', text: '', history: undefined, customerName: names.get(String(i.customerId)) }));
}
async function inbound(id: string, actor: AuthUser) {
  const doc = await MailMessage.findOne({ deleted: { $ne: true }, _id: id, ...await customerRefScope(actor) });
  if (!doc) throw ApiError.notFound('邮件不存在或无权访问');
  return doc;
}
async function outgoing(id: string, actor: AuthUser) {
  const doc = await DevelopmentLetter.findOne({ _id: id, ...await customerRefScope(actor) });
  if (!doc) throw ApiError.notFound('邮件不存在或无权访问');
  return doc;
}

function incomingDto(doc: InstanceType<typeof MailMessage>, actor: AuthUser) {
  const raw = doc.toObject();
  return { ...raw, id: String(doc._id), direction: 'inbound', read: doc.readBy.includes(actor.id),
    readBy: undefined, dedupKey: undefined, html: safeMailHtml(doc.html),
    attachments: doc.attachments.map(a => ({ id: String(a._id), name: a.name, mimeType: a.mimeType, size: a.size, blocked: a.blocked })) };
}
function outgoingDto(doc: InstanceType<typeof DevelopmentLetter>) {
  return { id: String(doc._id), customerId: doc.customerId, direction: 'outbound',
    subject: doc.subject, from: doc.senderAddress || env.MAIL_FROM, to: [doc.recipientEmail], cc: [],
    html: safeMailHtml(doc.content), text: doc.contentText, status: doc.status, sentAt: doc.sentAt || doc.createdAt,
    scheduledAt: doc.scheduledAt, nextAttemptAt: doc.nextAttemptAt, attempts: doc.attempts,
    error: doc.error, needsReview: doc.needsReview, channel: doc.channel, history: doc.history,
    tracking: trackingSummary(doc.tracking),
    messageId: doc.messageId, inReplyTo: doc.inReplyTo, references: doc.references,
    threadId: doc.threadId || String(doc._id), attachments: [], read: true };
}

router.get('/status', asyncHandler(async (req, res) => {
  const projectId = req.user!.projectId!;
  const [config, account] = await Promise.all([getProjectMailConfig(projectId), getMailAccount(projectId, req.user!.id)]);
  const personal = Boolean(account?.imapEnabled);
  const useLegacyProjectInbox = !personal && isAdmin(req.user);
  const stateKey = personal && account?.imapUsername
    ? personalMailboxKey({ projectId, accountId: account.id, username: account.imapUsername, mailbox: 'INBOX' })
    : useLegacyProjectInbox ? await mailboxKey(projectId) : null;
  const state = stateKey ? await MailSyncState.findById(stateKey).select('lastSyncAt lastError skipped failedUids') : null;
  const enabled = personal ? account?.status === 'active' : useLegacyProjectInbox && config.imap.enabled;
  const configured = personal
    ? Boolean(account?.imapHost && account?.imapUsername && account?.credentialSet)
    : useLegacyProjectInbox && imapConfigured(config);
  sendSuccess(res, { enabled: Boolean(enabled), configured, source: personal || !useLegacyProjectInbox ? 'personal' : 'project',
    verificationStatus: personal ? account?.imapVerificationStatus : configured ? 'verified' : 'unverified',
    mailboxAddress: personal ? account?.email : undefined,
    smtpConfigured: personal ? account?.verificationStatus === 'verified' : smtpConfigured(config), channel: config.transport,
    lastSyncAt: state?.lastSyncAt, lastError: state?.lastError || (personal ? account?.lastImapVerificationError : undefined),
    skipped: state?.skipped || 0, failedCount: state?.failedUids.length || 0 });
}));
router.post('/sync', asyncHandler(async (req, res) => {
  const projectId = req.user!.projectId!;
  const account = await getMailAccount(projectId, req.user!.id);
  if (account?.imapEnabled) {
    if (account.status !== 'active' || account.imapVerificationStatus !== 'verified') {
      throw ApiError.conflict('个人收件邮箱尚未验证或已停用');
    }
    void syncPersonalInbox(projectId, req.user!.id);
    return sendSuccess(res, { message: '已请求同步当前个人收件邮箱' }, 202);
  }
  if (!isAdmin(req.user)) throw ApiError.notFound();
  const config = await getProjectMailConfig(projectId);
  void syncInbox(projectId);
  sendSuccess(res, { message: config.imap.enabled ? '已请求当前项目后台同步' : '当前项目 IMAP 未启用，请配置后重启' }, 202);
}));
router.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => {
  const { folder, page, limit } = req.query as unknown as z.infer<typeof listQuery>;
  const scope = await customerRefScope(req.user);
  if (folder === 'unknown' && !isAdmin(req.user)) throw ApiError.notFound();
  if (folder === 'sent' || folder === 'tasks') {
    const filter = { ...scope, status: folder === 'sent' ? { $in: ['sent', 'opened', 'failed'] } : { $in: ['queued', 'scheduled', 'sending', 'retrying', 'cancelled'] } };
    const [docs, total] = await Promise.all([DevelopmentLetter.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), DevelopmentLetter.countDocuments(filter)]);
    sendSuccess(res, buildPaginated(await withCustomerNames(docs.map(outgoingDto)), total, page, limit));
  } else {
    const filter = { deleted: { $ne: true }, ...scope, ...(folder === 'unknown' ? { customerId: null } : {}) };
    const [docs, total] = await Promise.all([MailMessage.find({ ...filter, deleted: { $ne: true } }).sort({ sentAt: -1 }).skip((page - 1) * limit).limit(limit), MailMessage.countDocuments(filter)]);
    sendSuccess(res, buildPaginated(await withCustomerNames(docs.map(d => incomingDto(d, req.user!))), total, page, limit));
  }
}));
router.get('/:id', validate({ params, query: z.object({ direction: z.enum(['inbound', 'outbound']).default('inbound') }) }), asyncHandler(async (req, res) => {
  const isOut = req.query.direction === 'outbound';
  const doc = isOut ? await outgoing(req.params.id, req.user!) : await inbound(req.params.id, req.user!);
  const threadId = doc.threadId || String(doc._id);
  const scope = await customerRefScope(req.user);
  // Filter every thread member again, including customer identity, not only the root.
  const filter = { ...scope, customerId: doc.customerId || null, threadId };
  const [received, sent] = await Promise.all([
    MailMessage.find(filter).sort({ sentAt: 1 }).limit(200),
    DevelopmentLetter.find({ ...filter, status: { $ne: 'draft' } }).sort({ createdAt: 1 }).limit(200),
  ]);
  const mail = isOut ? outgoingDto(doc as InstanceType<typeof DevelopmentLetter>) : incomingDto(doc as InstanceType<typeof MailMessage>, req.user!);
  const thread = [...received.map(d => incomingDto(d, req.user!)), ...sent.map(outgoingDto)];
  if (!thread.some(m => m.id === mail.id)) thread.push(mail);
  thread.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
  const customer = doc.customerId ? await getCustomerByIdOrThrow(String(doc.customerId), req.user) : null;
  sendSuccess(res, { mail, thread, customer });
}));
router.post('/:id/read', validate({ params, body: z.object({ read: z.boolean() }) }), asyncHandler(async (req, res) => {
  await inbound(req.params.id, req.user!);
  const change = req.body.read ? { $addToSet: { readBy: req.user!.id } } : { $pull: { readBy: req.user!.id } };
  await MailMessage.updateOne({ _id: req.params.id, ...await customerRefScope(req.user) }, change);
  sendSuccess(res, { read: req.body.read });
}));
router.post('/:id/link', validate({ params, body: z.object({ customerId: idSchema }) }), asyncHandler(async (req, res) => {
  // Unknown mailbox is admin-only, including its mutation endpoints.
  if (!isAdmin(req.user)) throw ApiError.notFound();
  const doc = await inbound(req.params.id, req.user!);
  const customer = await getCustomerByIdOrThrow(req.body.customerId, req.user);
  if (doc.customerId) throw ApiError.conflict('邮件已关联客户');
  const threadId = await findThread(customer._id, doc.subject, [...doc.references, doc.inReplyTo || ''], doc.from,
    req.user!.projectId, doc.mailAccountId ? String(doc.mailAccountId) : undefined);
  const result = await MailMessage.updateOne({ _id: doc._id, customerId: null, ...projectScope(req.user) }, { $set: { customerId: customer._id, threadId } });
  if (!result.modifiedCount) throw ApiError.conflict('邮件已关联客户');
  sendSuccess(res, { id: String(doc._id), customerId: String(customer._id) });
}));
router.post('/:id/reply', validate({ params, body: sendLetterSchema }), asyncHandler(async (req, res) => {
  const doc = await inbound(req.params.id, req.user!);
  if (!doc.customerId) throw ApiError.badRequest('请先关联客户再回复');
  if (doc.mailboxUserId && String(doc.mailboxUserId) !== req.user!.id) {
    throw ApiError.conflict('该邮件属于其他业务员的个人邮箱，请由邮箱所属业务员回复');
  }
  const result = await sendLetter({ ...req.body, customerId: String(doc.customerId), replyToId: String(doc._id), saveAsDraft: false }, req.user);
  sendSuccess(res, result, 201);
}));
router.post('/:id/cancel', validate({ params }), asyncHandler(async (req, res) => {
  await outgoing(req.params.id, req.user!);
  const doc = await DevelopmentLetter.findOneAndUpdate({ _id: req.params.id, ...await customerRefScope(req.user), status: { $in: ['scheduled', 'queued', 'retrying'] } }, {
    $set: { status: 'cancelled' }, $push: { history: { at: new Date(), status: 'cancelled' } },
  }, { new: true });
  if (!doc) throw ApiError.conflict('任务已开始发送或已结束，无法取消');
  sendSuccess(res, outgoingDto(doc));
}));
router.post('/:id/resolve', validate({ params, body: z.object({ outcome: z.enum(['sent', 'not_sent']) }) }), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw ApiError.notFound();
  const status = req.body.outcome === 'sent' ? 'sent' : 'failed';
  const pending = await DevelopmentLetter.findOne({ _id: req.params.id, ...projectScope(req.user), status: 'failed', needsReview: true }).select('tracking.prepared');
  const doc = await DevelopmentLetter.findOneAndUpdate({ _id: req.params.id, ...projectScope(req.user), status: 'failed', needsReview: true }, {
    $set: { needsReview: false, status, effectsPending: status === 'sent',
      'tracking.enabled': Boolean(status === 'sent' && pending?.tracking?.prepared),
      ...(status === 'sent' ? { sentAt: new Date() } : {}), error: status === 'sent' ? '' : '管理员已核实未投递，可重新发送' },
    $push: { history: { at: new Date(), status, error: `管理员核实：${req.body.outcome}` } },
  }, { new: true });
  if (!doc) throw ApiError.conflict('任务不处于待核实状态');
  sendSuccess(res, outgoingDto(doc));
}));
router.get('/:id/attachments/:attachmentId', validate({ params: params.extend({ attachmentId: idSchema }) }), asyncHandler(async (req, res) => {
  await inbound(req.params.id, req.user!);
  const doc = await MailMessage.findOne({ _id: req.params.id, ...await customerRefScope(req.user) }).select('+attachments.filename');
  if (!doc) throw ApiError.notFound('邮件不存在或无权访问');
  const att = doc?.attachments.id(new Types.ObjectId(req.params.attachmentId));
  if (!att?.filename || att.blocked || path.basename(att.filename) !== att.filename) throw ApiError.notFound('附件不存在或被安全策略拦截');
  let buffer: Buffer;
  try { buffer = await fs.readFile(path.join(env.UPLOAD_DIR, 'mail', String(doc.projectId), att.filename)); } catch {
    // V2.5 以前附件位于 mail 根目录；只对已通过项目权限校验的记录回退读取。
    try { buffer = await fs.readFile(path.join(env.UPLOAD_DIR, 'mail', att.filename)); } catch { throw ApiError.notFound('附件文件不存在'); }
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(att.name || 'attachment')}`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}));

export default router;
