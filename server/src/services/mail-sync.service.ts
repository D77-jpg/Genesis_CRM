import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import env from '../config/env';
import { MailMessage, MailSyncState } from '../models/MailMessage';
import { Customer, DevelopmentLetter, Project } from '../models';
import { attachmentAllowed, mailError, normalizeSubject, safeMailHtml } from './mail-security';
import { createLogger } from '../config/logger';
import { htmlToPlainText } from '../utils/text';
import { getProjectMailConfig } from './project-mail-config.service';
import { getPersonalImapConfig, listPersonalImapConfigs, type PersonalImapConfig } from './mail-account.service';

const logger = createLogger('imap-sync');
const addresses = (value?: AddressObject | AddressObject[]) => (value ? (Array.isArray(value) ? value : [value]).flatMap(a => a.value.map(v => (v.address || '').trim().toLowerCase()).filter(Boolean)) : []);
async function resolveProjectId(projectId?: string): Promise<string> {
  if (projectId && /^[a-f\d]{24}$/i.test(projectId)) return projectId;
  const project = await Project.findOne({ status: 'active' }).sort({ isDefault: -1, createdAt: 1 }).select('_id');
  if (!project) throw new Error('NO_ACTIVE_PROJECT');
  return String(project._id);
}

/** 保留 V2.1 的同步状态 key 计算方式，避免升级后默认邮箱重复全量拉取。 */
export const mailboxKey = (projectId?: string) => createHash('sha256')
  .update(`${projectId || 'legacy'}|${env.IMAP_HOST}|${env.IMAP_USER}|${env.IMAP_MAILBOX}`)
  .digest('hex');

async function mailboxKeyForProject(projectId: string): Promise<string> {
  const config = await getProjectMailConfig(projectId);
  if (config.profileKey === 'genesis-bags') return mailboxKey();
  return createHash('sha256')
    .update(`${projectId}|${config.imap.host}|${config.imap.user}|${config.imap.mailbox}`)
    .digest('hex');
}

export async function findThread(customerId: unknown, subject: string, references: string[], sender: string, projectId?: string, mailAccountId?: string): Promise<string> {
  const scopedProjectId = await resolveProjectId(projectId);
  // Header references are only trusted WITHIN a matched customer. A forged
  // reference must never join two owners' mail or expose unknown messages.
  if (customerId) {
    const outgoing = await DevelopmentLetter.findOne({ projectId: scopedProjectId, customerId,
      ...(mailAccountId ? { mailAccountId } : {}), messageId: { $in: references } }).sort({ createdAt: -1 });
    if (outgoing) {
      const threadId = outgoing.threadId || String(outgoing._id);
      await DevelopmentLetter.updateOne({ _id: outgoing._id, projectId: scopedProjectId, threadId: { $exists: false } }, { $set: { threadId } });
      return threadId;
    }
  }
  const incoming = await MailMessage.findOne({ projectId: scopedProjectId, customerId: customerId || null, from: sender,
    ...(mailAccountId ? { mailAccountId } : {}), messageId: { $in: references } }).sort({ sentAt: -1 });
  if (incoming) return incoming.threadId;
  // Subject fallback is bounded to the same customer/sender and a 30-day window.
  if (normalizeSubject(subject) && /^(re|fw|fwd|回复|答复|转发)\s*[:：]/i.test(subject.trim())) {
    const recent = await MailMessage.findOne({ projectId: scopedProjectId, customerId: customerId || null, from: sender,
      ...(mailAccountId ? { mailAccountId } : {}),
      normalizedSubject: normalizeSubject(subject), sentAt: { $gte: new Date(Date.now() - 30 * 86400000) } }).sort({ sentAt: -1 });
    if (recent) return recent.threadId;
    if (customerId) {
      const outgoing = await DevelopmentLetter.find({ projectId: scopedProjectId, customerId, recipientEmail: sender,
        ...(mailAccountId ? { mailAccountId } : {}), status: { $in: ['sent', 'opened'] }, sentAt: { $gte: new Date(Date.now() - 30 * 86400000) } }).sort({ sentAt: -1 }).limit(100);
      const match = outgoing.find(m => normalizeSubject(m.subject) === normalizeSubject(subject));
      if (match) {
        const threadId = match.threadId || String(match._id);
        await DevelopmentLetter.updateOne({ _id: match._id, projectId: scopedProjectId }, { $set: { threadId } });
        return threadId;
      }
    }
  }
  return randomUUID();
}

/** Shared by real IMAP and MIME fixture tests. No credentials in this interface. */
export async function importMail(source: Buffer, account?: string, projectId?: string, mailbox?: {
  mailAccountId: string; userId: string; address: string;
}) {
  const scopedProjectId = await resolveProjectId(projectId);
  const accountKey = account ?? await mailboxKeyForProject(scopedProjectId);
  if (source.length > env.IMAP_MAX_MESSAGE_SIZE) throw new Error('MAIL_TOO_LARGE');
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: env.IMAP_MAX_MESSAGE_SIZE });
  const from = addresses(parsed.from)[0] || '';
  if (!from) throw new Error('MAIL_MISSING_SENDER');
  const messageId = parsed.messageId?.trim().slice(0, 998);
  const dedupKey = createHash('sha256').update(`${accountKey}|${messageId || createHash('sha256').update(source).digest('hex')}`).digest('hex');
  const exists = await MailMessage.findOne({ projectId: scopedProjectId, dedupKey });
  if (exists) return exists;
  const matches = await Customer.find({ projectId: scopedProjectId, email: from,
    ...(mailbox ? { ownerId: mailbox.userId } : {}) }).limit(2).select('_id');
  const customerId = matches.length === 1 ? matches[0]._id : null;
  const references = (Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []).slice(-50);
  const threadId = await findThread(customerId, parsed.subject || '', [...references, parsed.inReplyTo || ''], from, scopedProjectId, mailbox?.mailAccountId);
  const savedFiles: string[] = [];
  const attachments: { name: string; mimeType: string; size: number; filename?: string; blocked?: string }[] = [];
  try {
    const mailDir = path.join(env.UPLOAD_DIR, 'mail', scopedProjectId);
    await fs.mkdir(mailDir, { recursive: true });
    for (const att of parsed.attachments) {
      const name = path.basename((att.filename || 'attachment').replace(/\\/g, '/')).replace(/[\x00-\x1f]/g, '').slice(0, 200) || 'attachment';
      const meta = { name, mimeType: att.contentType, size: att.size };
      if (attachments.length >= 20 || !attachmentAllowed(name, att.contentType, att.content, env.MAX_ATTACHMENT_SIZE)) {
        attachments.push({ ...meta, blocked: '附件类型、大小或数量超限，未保存文件' });
        continue;
      }
      const filename = `${randomUUID()}${path.extname(name).toLowerCase()}`;
      const full = path.join(mailDir, filename);
      await fs.writeFile(full, att.content, { flag: 'wx' });
      savedFiles.push(full);
      attachments.push({ ...meta, filename });
    }
    const sentAt = parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date : new Date();
    const doc = await MailMessage.create({ projectId: scopedProjectId, dedupKey, customerId, threadId, messageId, inReplyTo: parsed.inReplyTo,
      ...(mailbox ? { mailAccountId: mailbox.mailAccountId, mailboxUserId: mailbox.userId, mailboxAddress: mailbox.address } : {}),
      references, subject: (parsed.subject || '').slice(0, 998), normalizedSubject: normalizeSubject(parsed.subject || ''),
      from, fromName: parsed.from?.value[0]?.name, to: addresses(parsed.to), cc: addresses(parsed.cc),
      html: safeMailHtml(parsed.html || ''), text: parsed.text || htmlToPlainText(safeMailHtml(parsed.html || '')), sentAt, attachments });
    // Incoming timeline events are derived from MailMessage in the EXISTING service.
    return doc;
  } catch (error) {
    await Promise.all(savedFiles.map(p => fs.unlink(p).catch(() => undefined)));
    if ((error as { code?: number }).code === 11000) return (await MailMessage.findOne({ projectId: scopedProjectId, dedupKey }))!;
    throw error;
  }
}

const syncing = new Set<string>();
type ClientFactory = (options: ConstructorParameters<typeof ImapFlow>[0]) => ImapFlow;

interface MailboxSyncConfig {
  syncId: string;
  key: string;
  projectId: string;
  host?: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  mailbox: string;
  personal?: { mailAccountId: string; userId: string; address: string };
}

export const personalMailboxKey = (config: Pick<PersonalImapConfig, 'projectId' | 'accountId' | 'username' | 'mailbox'>) => createHash('sha256')
  .update(`${config.projectId}|${config.accountId}|${config.username}|${config.mailbox}`)
  .digest('hex');

async function syncMailbox(config: MailboxSyncConfig, makeClient: ClientFactory): Promise<void> {
  if (syncing.has(config.syncId)) return;
  syncing.add(config.syncId);
  const { key, projectId } = config;
  const token = randomUUID();
  let client: ImapFlow | undefined;
  let renew: NodeJS.Timeout | undefined;
  let leaseLost = false;
  try {
    await MailSyncState.updateOne({ _id: key }, { $setOnInsert: { projectId, lastUid: 0 } }, { upsert: true });
    const state = await MailSyncState.findOneAndUpdate({ _id: key, $or: [{ leaseUntil: { $lt: new Date() } }, { leaseUntil: null }] },
      { $set: { leaseOwner: token, leaseUntil: new Date(Date.now() + 120000) } }, { new: true });
    if (!state) return;
    if (!config.host || !config.username || !config.password) {
      await MailSyncState.updateOne({ _id: key, leaseOwner: token }, { $set: { lastError: 'IMAP 配置不完整，请填写服务器、账号和密码' } });
      return;
    }
    client = makeClient({ host: config.host, port: config.port, secure: config.secure,
      doSTARTTLS: config.secure ? undefined : true,
      auth: { user: config.username, pass: config.password }, logger: false,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 45000, disableAutoIdle: true });
    client.on('error', () => { logger.warn('IMAP 连接错误，下轮继续同步'); });
    renew = setInterval(() => {
      void MailSyncState.updateOne({ _id: key, leaseOwner: token }, { $set: { leaseUntil: new Date(Date.now() + 120000) } })
        .then(r => { if (!r.matchedCount) { leaseLost = true; client?.close(); } })
        .catch(() => { leaseLost = true; client?.close(); });
    }, 30000);
    await client.connect();
    const lock = await client.getMailboxLock(config.mailbox, { readOnly: true });
    try {
      if (!client.mailbox) throw new Error('NO_MAILBOX');
      const validity = String(client.mailbox.uidValidity);
      const lastUid = state.uidValidity === validity ? state.lastUid : 0;
      const oldFailed = state.uidValidity === validity ? state.failedUids : [];
      const high = client.mailbox.uidNext - 1;
      const newUids = high > lastUid ? await client.search({ uid: `${lastUid + 1}:${high}` }, { uid: true }) : [];
      // Reserve space for new mail: poison messages cannot starve the inbox.
      const uids = [...new Set([...oldFailed.slice(0, 20), ...(newUids || []).slice(0, 80)])].sort((a, b) => a - b);
      const failed = new Set(oldFailed);
      let cursor = lastUid;
      for (const uid of uids) {
        if (leaseLost) break;
        try {
          const meta = await client.fetchOne(uid, { size: true }, { uid: true });
          if (meta && (meta.size ?? Infinity) <= env.IMAP_MAX_MESSAGE_SIZE) {
            const data = await client.fetchOne(uid, { source: { start: 0, maxLength: env.IMAP_MAX_MESSAGE_SIZE + 1 } }, { uid: true });
            if (data && data.source) await importMail(data.source, key, projectId, config.personal);
          } else if (meta) {
            await MailSyncState.updateOne({ _id: key, leaseOwner: token }, { $inc: { skipped: 1 } });
          }
          failed.delete(uid);
        } catch {
          failed.delete(uid);
          failed.add(uid);
          logger.warn(`IMAP 单封邮件同步失败 UID=${uid}，其余邮件继续`);
        }
        cursor = Math.max(cursor, uid);
        await MailSyncState.updateOne({ _id: key, leaseOwner: token }, { $set: { uidValidity: validity, lastUid: cursor, failedUids: [...failed] } });
      }
      await MailSyncState.updateOne({ _id: key, leaseOwner: token }, { $set: { lastSyncAt: new Date(), lastError: failed.size ? `${failed.size} 封邮件待重试` : '' } });
    } finally { lock.release(); }
  } catch (error) {
    logger.warn(mailError(error, 'IMAP'));
    await MailSyncState.updateOne({ _id: key, leaseOwner: token }, { $set: { lastError: mailError(error, 'IMAP') } }).catch(() => undefined);
  } finally {
    if (renew) clearInterval(renew);
    client?.close();
    await MailSyncState.updateOne({ _id: key, leaseOwner: token }, { $unset: { leaseOwner: 1, leaseUntil: 1 } }).catch(() => undefined);
    syncing.delete(config.syncId);
  }
}

async function syncProject(projectId: string, makeClient: ClientFactory): Promise<void> {
  const project = await getProjectMailConfig(projectId);
  if (!project.imap.enabled) return;
  await syncMailbox({
    syncId: `project:${projectId}`,
    key: await mailboxKeyForProject(projectId),
    projectId,
    host: project.imap.host,
    port: project.imap.port,
    secure: project.imap.secure,
    username: project.imap.user,
    password: project.imap.password,
    mailbox: project.imap.mailbox,
  }, makeClient);
}

async function syncPersonal(config: PersonalImapConfig, makeClient: ClientFactory): Promise<void> {
  await syncMailbox({
    syncId: `account:${config.accountId}`,
    key: personalMailboxKey(config),
    projectId: config.projectId,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    password: config.password,
    mailbox: config.mailbox,
    personal: { mailAccountId: config.accountId, userId: config.userId, address: config.mailboxAddress },
  }, makeClient);
}

export async function syncPersonalInbox(projectId: string, userId: string, clientFactory?: ClientFactory): Promise<boolean> {
  const config = await getPersonalImapConfig(projectId, userId);
  if (!config) return false;
  await syncPersonal(config, clientFactory ?? (options => new ImapFlow(options)));
  return true;
}

/** 无 projectId 时同步所有启用项目；传入 projectId 时只同步当前空间。 */
export async function syncInbox(projectIdOrClient?: string | ClientFactory, clientFactory?: ClientFactory): Promise<void> {
  const makeClient = typeof projectIdOrClient === 'function' ? projectIdOrClient : clientFactory ?? (options => new ImapFlow(options));
  const requestedId = typeof projectIdOrClient === 'string' ? projectIdOrClient : undefined;
  if (requestedId) {
    const projectId = await resolveProjectId(requestedId);
    await syncProject(projectId, makeClient);
    for (const account of await listPersonalImapConfigs(projectId)) await syncPersonal(account, makeClient);
    return;
  }
  const projects = await Project.find({ status: 'active' }).select('_id');
  for (const project of projects) await syncProject(String(project._id), makeClient);
  for (const account of await listPersonalImapConfigs()) await syncPersonal(account, makeClient);
}
