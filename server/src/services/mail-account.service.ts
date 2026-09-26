import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { Types } from 'mongoose';
import { MailAccountAudit, MailQuotaBucket, User, UserMailAccount, type UserMailAccountDocument } from '../models';
import { ApiError } from '../utils/ApiError';
import { decryptCredential, encryptCredential } from './credential-crypto';
import { getProjectMailConfig, type ProjectMailConfig } from './project-mail-config.service';
import { mailError } from './mail-security';
import type { UpsertMailAccountInput } from '../validators/mail-account.validator';

export interface MailAccountDto {
  id: string;
  projectId: string;
  userId: string;
  email: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUsername: string;
  imapEnabled: boolean;
  imapHost?: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername?: string;
  credentialSet: boolean;
  status: 'active' | 'disabled';
  verificationStatus: 'unverified' | 'verified' | 'failed';
  verifiedAt?: Date;
  lastVerificationError?: string;
  imapVerificationStatus: 'unverified' | 'verified' | 'failed';
  imapVerifiedAt?: Date;
  lastImapVerificationError?: string;
  dailyLimit: number;
  usedToday: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CurrentMailSenderDto {
  channel: 'mock' | 'smtp';
  canSend: boolean;
  reason?: string;
  account: MailAccountDto | null;
  senderAddress: string;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

async function audit(input: {
  projectId: string;
  accountId?: string;
  actorId: string;
  targetUserId: string;
  action: 'created' | 'updated' | 'verified' | 'verification_failed' | 'imap_verified' | 'imap_verification_failed' | 'send_attempt' | 'send_success' | 'send_failed' | 'quota_blocked';
  detail?: Record<string, unknown>;
}): Promise<void> {
  await MailAccountAudit.create({
    projectId: new Types.ObjectId(input.projectId),
    accountId: input.accountId ? new Types.ObjectId(input.accountId) : undefined,
    actorId: new Types.ObjectId(input.actorId),
    targetUserId: new Types.ObjectId(input.targetUserId),
    action: input.action,
    detail: input.detail ?? {},
  });
}

async function usedToday(accountId: Types.ObjectId): Promise<number> {
  const bucket = await MailQuotaBucket.findOne({ mailAccountId: accountId, day: utcDay() }).select('attempts').lean();
  return Number(bucket?.attempts ?? 0);
}

async function toDto(account: UserMailAccountDocument): Promise<MailAccountDto> {
  return {
    id: String(account._id),
    projectId: String(account.projectId),
    userId: String(account.userId),
    email: account.email,
    displayName: account.displayName,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecure: account.smtpSecure,
    smtpRequireTls: account.smtpRequireTls,
    smtpUsername: account.smtpUsername,
    imapEnabled: Boolean(account.imapEnabled),
    ...(account.imapHost ? { imapHost: account.imapHost } : {}),
    imapPort: account.imapPort || 993,
    imapSecure: account.imapSecure !== false,
    ...(account.imapUsername ? { imapUsername: account.imapUsername } : {}),
    credentialSet: Boolean(account.credentialCiphertext),
    status: account.status,
    verificationStatus: account.verificationStatus,
    ...(account.verifiedAt ? { verifiedAt: account.verifiedAt } : {}),
    ...(account.lastVerificationError ? { lastVerificationError: account.lastVerificationError } : {}),
    imapVerificationStatus: account.imapVerificationStatus || 'unverified',
    ...(account.imapVerifiedAt ? { imapVerifiedAt: account.imapVerifiedAt } : {}),
    ...(account.lastImapVerificationError ? { lastImapVerificationError: account.lastImapVerificationError } : {}),
    dailyLimit: account.dailyLimit,
    usedToday: await usedToday(account._id),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

async function assertTargetUser(projectId: string, userId: string): Promise<void> {
  const user = await User.findById(userId).select('role status projectIds');
  if (!user) throw ApiError.notFound('用户不存在');
  if (user.status === 'disabled') throw ApiError.conflict('账号已停用，不能配置发件邮箱');
  if (user.role !== 'admin' && !user.projectIds.some((id) => String(id) === projectId)) {
    throw ApiError.notFound('用户不在当前项目中');
  }
}

async function accountWithSecret(id: string): Promise<UserMailAccountDocument | null> {
  return UserMailAccount.findById(id).select('+credentialCiphertext +credentialIv +credentialTag');
}

export async function getMailAccount(projectId: string, userId: string): Promise<MailAccountDto | null> {
  const account = await UserMailAccount.findOne({ projectId, userId });
  return account ? toDto(account) : null;
}

export async function getCurrentMailSender(projectId: string, userId: string): Promise<CurrentMailSenderDto> {
  const [config, account] = await Promise.all([
    getProjectMailConfig(projectId),
    UserMailAccount.findOne({ projectId, userId }),
  ]);
  if (config.transport === 'mock') {
    return {
      channel: 'mock',
      canSend: true,
      account: account ? await toDto(account) : null,
      senderAddress: config.mailFrom,
      reason: '当前项目为模拟发送，不会真实投递邮件',
    };
  }
  if (!account) {
    return { channel: 'smtp', canSend: false, account: null, senderAddress: '', reason: '尚未分配个人发件邮箱' };
  }
  const usable = account.status === 'active' && account.verificationStatus === 'verified';
  return {
    channel: 'smtp',
    canSend: usable,
    account: await toDto(account),
    senderAddress: formatSender(account),
    reason: account.status !== 'active'
      ? '个人发件邮箱已停用'
      : account.verificationStatus !== 'verified'
        ? '个人发件邮箱尚未验证通过'
        : undefined,
  };
}

export async function upsertMailAccount(
  projectId: string,
  targetUserId: string,
  actorId: string,
  input: UpsertMailAccountInput,
): Promise<MailAccountDto> {
  await assertTargetUser(projectId, targetUserId);
  let account = await UserMailAccount.findOne({ projectId, userId: targetUserId })
    .select('+credentialCiphertext +credentialIv +credentialTag');
  if (!account && !input.password) throw ApiError.badRequest('首次配置必须填写邮箱授权码');

  const connectionChanged = !account
    || account.email !== input.email
    || account.smtpHost !== input.smtpHost
    || account.smtpPort !== input.smtpPort
    || account.smtpSecure !== input.smtpSecure
    || account.smtpRequireTls !== input.smtpRequireTls
    || account.smtpUsername !== input.smtpUsername
    || Boolean(input.password);
  const imapChanged = !account
    || account.imapEnabled !== input.imapEnabled
    || account.imapHost !== (input.imapHost || undefined)
    || account.imapPort !== input.imapPort
    || account.imapSecure !== input.imapSecure
    || account.imapUsername !== (input.imapUsername || undefined)
    || Boolean(input.password);

  const encrypted = input.password ? encryptCredential(input.password) : null;
  if (!account) {
    account = await UserMailAccount.create({
      projectId,
      userId: targetUserId,
      email: input.email,
      displayName: input.displayName,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      smtpRequireTls: input.smtpRequireTls,
      smtpUsername: input.smtpUsername,
      imapEnabled: input.imapEnabled,
      imapHost: input.imapHost || undefined,
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      imapUsername: input.imapUsername || undefined,
      credentialCiphertext: encrypted!.ciphertext,
      credentialIv: encrypted!.iv,
      credentialTag: encrypted!.tag,
      credentialVersion: 1,
      status: input.status,
      verificationStatus: 'unverified',
      imapVerificationStatus: 'unverified',
      dailyLimit: input.dailyLimit,
      createdBy: actorId,
      updatedBy: actorId,
    });
    await audit({ projectId, accountId: String(account._id), actorId, targetUserId, action: 'created', detail: { email: account.email } });
    return toDto(account);
  }

  account.email = input.email;
  account.displayName = input.displayName;
  account.smtpHost = input.smtpHost;
  account.smtpPort = input.smtpPort;
  account.smtpSecure = input.smtpSecure;
  account.smtpRequireTls = input.smtpRequireTls;
  account.smtpUsername = input.smtpUsername;
  account.imapEnabled = input.imapEnabled;
  account.imapHost = input.imapHost || undefined;
  account.imapPort = input.imapPort;
  account.imapSecure = input.imapSecure;
  account.imapUsername = input.imapUsername || undefined;
  account.status = input.status;
  account.dailyLimit = input.dailyLimit;
  account.updatedBy = new Types.ObjectId(actorId);
  if (encrypted) {
    account.credentialCiphertext = encrypted.ciphertext;
    account.credentialIv = encrypted.iv;
    account.credentialTag = encrypted.tag;
    account.credentialVersion += 1;
  }
  if (connectionChanged) {
    account.verificationStatus = 'unverified';
    account.verifiedAt = undefined;
    account.lastVerificationError = undefined;
  }
  if (imapChanged) {
    account.imapVerificationStatus = 'unverified';
    account.imapVerifiedAt = undefined;
    account.lastImapVerificationError = undefined;
  }
  await account.save();
  await audit({ projectId, accountId: String(account._id), actorId, targetUserId, action: 'updated', detail: { connectionChanged, imapChanged, status: account.status } });
  return toDto(account);
}

export async function verifyMailAccount(projectId: string, targetUserId: string, actorId: string): Promise<{
  success: boolean;
  message: string;
  account: MailAccountDto;
}> {
  const account = await UserMailAccount.findOne({ projectId, userId: targetUserId })
    .select('+credentialCiphertext +credentialIv +credentialTag');
  if (!account) throw ApiError.notFound('尚未配置个人发件邮箱');
  let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;
  let imapClient: ImapFlow | undefined;
  try {
    const password = decryptCredential({ ciphertext: account.credentialCiphertext, iv: account.credentialIv, tag: account.credentialTag });
    transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      requireTLS: account.smtpRequireTls,
      auth: { user: account.smtpUsername, pass: password },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await transporter.verify();
    account.verificationStatus = 'verified';
    account.verifiedAt = new Date();
    account.lastVerificationError = undefined;
    await account.save();
    await audit({ projectId, accountId: String(account._id), actorId, targetUserId, action: 'verified' });
  } catch (error) {
    const message = mailError(error, 'SMTP');
    account.verificationStatus = 'failed';
    account.verifiedAt = undefined;
    account.lastVerificationError = message;
    await account.save();
    await audit({ projectId, accountId: String(account._id), actorId, targetUserId, action: 'verification_failed', detail: { message } });
    return { success: false, message, account: await toDto(account) };
  } finally {
    transporter?.close();
  }

  if (!account.imapEnabled) {
    account.imapVerificationStatus = 'unverified';
    account.imapVerifiedAt = undefined;
    account.lastImapVerificationError = undefined;
    await account.save();
    return { success: true, message: 'SMTP 连接与身份验证通过', account: await toDto(account) };
  }

  try {
    if (!account.imapHost || !account.imapUsername) throw new Error('IMAP_CONFIG_MISSING');
    const password = decryptCredential({ ciphertext: account.credentialCiphertext, iv: account.credentialIv, tag: account.credentialTag });
    imapClient = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      doSTARTTLS: account.imapSecure ? undefined : true,
      auth: { user: account.imapUsername, pass: password },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      disableAutoIdle: true,
    });
    imapClient.on('error', () => undefined);
    await imapClient.connect();
    account.imapVerificationStatus = 'verified';
    account.imapVerifiedAt = new Date();
    account.lastImapVerificationError = undefined;
    await account.save();
    await audit({ projectId, accountId: String(account._id), actorId, targetUserId, action: 'imap_verified' });
    return { success: true, message: 'SMTP 与 IMAP 连接验证通过', account: await toDto(account) };
  } catch (error) {
    const message = error instanceof Error && error.message === 'IMAP_CONFIG_MISSING'
      ? 'IMAP 配置不完整'
      : mailError(error, 'IMAP');
    account.imapVerificationStatus = 'failed';
    account.imapVerifiedAt = undefined;
    account.lastImapVerificationError = message;
    await account.save();
    await audit({ projectId, accountId: String(account._id), actorId, targetUserId, action: 'imap_verification_failed', detail: { message } });
    return { success: false, message: `SMTP 已验证，${message}`, account: await toDto(account) };
  } finally {
    if (imapClient?.usable) await imapClient.logout().catch(() => undefined);
    else imapClient?.close();
  }
}

export interface PersonalImapConfig {
  accountId: string;
  projectId: string;
  userId: string;
  mailboxAddress: string;
  profileKey: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: 'INBOX';
}

function toPersonalImapConfig(account: UserMailAccountDocument): PersonalImapConfig | null {
  if (account.status !== 'active' || !account.imapEnabled || account.imapVerificationStatus !== 'verified'
    || !account.imapHost || !account.imapUsername) return null;
  return {
    accountId: String(account._id),
    projectId: String(account.projectId),
    userId: String(account.userId),
    mailboxAddress: account.email,
    profileKey: `user-imap-${account.id}-v${account.credentialVersion}`,
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    username: account.imapUsername,
    password: decryptCredential({ ciphertext: account.credentialCiphertext, iv: account.credentialIv, tag: account.credentialTag }),
    mailbox: 'INBOX',
  };
}

export async function getPersonalImapConfig(projectId: string, userId: string): Promise<PersonalImapConfig | null> {
  const account = await UserMailAccount.findOne({ projectId, userId })
    .select('+credentialCiphertext +credentialIv +credentialTag');
  return account ? toPersonalImapConfig(account) : null;
}

export async function listPersonalImapConfigs(projectId?: string): Promise<PersonalImapConfig[]> {
  const accounts = await UserMailAccount.find({
    ...(projectId ? { projectId } : {}),
    status: 'active', imapEnabled: true, imapVerificationStatus: 'verified',
  }).select('+credentialCiphertext +credentialIv +credentialTag');
  return accounts.map(toPersonalImapConfig).filter((value): value is PersonalImapConfig => Boolean(value));
}

function formatSender(account: Pick<UserMailAccountDocument, 'displayName' | 'email'>): string {
  const safeName = account.displayName.replace(/[\r\n"]/g, ' ').trim();
  return safeName ? `"${safeName}" <${account.email}>` : account.email;
}

export async function resolveSenderIdentity(projectId: string, userId: string | undefined, allowDraft: boolean): Promise<{
  channel: 'mock' | 'smtp';
  senderAddress: string;
  mailAccountId?: Types.ObjectId;
}> {
  const config = await getProjectMailConfig(projectId);
  if (config.transport === 'mock') return { channel: 'mock', senderAddress: config.mailFrom };
  if (!userId) throw ApiError.forbidden('发送任务缺少发送人，不能使用个人邮箱');
  const account = await UserMailAccount.findOne({ projectId, userId });
  if (!account) {
    if (allowDraft) return { channel: 'smtp', senderAddress: config.mailFrom };
    throw ApiError.conflict('尚未分配个人发件邮箱，可以先保存草稿并联系管理员配置');
  }
  if (!allowDraft && account.status !== 'active') throw ApiError.conflict('个人发件邮箱已停用，可以先保存草稿');
  if (!allowDraft && account.verificationStatus !== 'verified') throw ApiError.conflict('个人发件邮箱尚未验证通过，可以先保存草稿');
  return { channel: 'smtp', senderAddress: formatSender(account), mailAccountId: account._id };
}

export async function getMailAccountDeliveryConfig(
  accountId: string,
  projectId: string,
  userId: string,
): Promise<ProjectMailConfig | null> {
  const account = await accountWithSecret(accountId);
  if (!account || String(account.projectId) !== projectId || String(account.userId) !== userId
    || account.status !== 'active' || account.verificationStatus !== 'verified') return null;
  const password = decryptCredential({ ciphertext: account.credentialCiphertext, iv: account.credentialIv, tag: account.credentialTag });
  return {
    projectId,
    profileKey: `user-${account.id}-v${account.credentialVersion}`,
    transport: 'smtp',
    mailFrom: formatSender(account),
    smtp: {
      configured: true,
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      requireTLS: account.smtpRequireTls,
      user: account.smtpUsername,
      pass: password,
    },
    imap: { enabled: false, port: 993, secure: true, mailbox: 'INBOX' },
  };
}

export async function reserveMailAttempt(accountId: string, projectId: string, userId: string): Promise<void> {
  const account = await UserMailAccount.findOne({ _id: accountId, projectId, userId }).select('dailyLimit');
  if (!account) throw ApiError.conflict('个人发件邮箱不存在或无权使用');
  const filter = { mailAccountId: account._id, day: utcDay() };
  await MailQuotaBucket.updateOne(filter, {
    $setOnInsert: { projectId: account.projectId, userId: account.userId, mailAccountId: account._id, day: utcDay(), attempts: 0 },
  }, { upsert: true });
  const reserved = await MailQuotaBucket.findOneAndUpdate({ ...filter, attempts: { $lt: account.dailyLimit } }, { $inc: { attempts: 1 } }, { new: true });
  if (!reserved) {
    await audit({ projectId, accountId, actorId: userId, targetUserId: userId, action: 'quota_blocked', detail: { dailyLimit: account.dailyLimit } });
    throw ApiError.tooManyRequests(`该邮箱今日发送额度已用完（${account.dailyLimit} 封）`);
  }
  await audit({ projectId, accountId, actorId: userId, targetUserId: userId, action: 'send_attempt', detail: { used: reserved.attempts, dailyLimit: account.dailyLimit } });
}

export async function auditMailResult(accountId: string, projectId: string, userId: string, accepted: boolean, _error?: string): Promise<void> {
  await audit({
    projectId,
    accountId,
    actorId: userId,
    targetUserId: userId,
    action: accepted ? 'send_success' : 'send_failed',
    // Never persist transport-library error strings; they may embed SMTP credentials.
    detail: accepted ? {} : { error: 'SMTP 发送失败' },
  });
}
