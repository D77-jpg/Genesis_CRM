import { randomUUID } from 'node:crypto';
import { DevelopmentLetter, Customer, User } from '../models';
import env from '../config/env';
import { sendMail, type SendMailPayload, type SendMailResult } from './mailer.service';
import { createLogger } from '../config/logger';

const logger = createLogger('mail-queue');
export const newMessageId = () => `<${randomUUID()}@crm.genesis.local>`;

// Apply counter + idempotency marker in ONE atomic customer update. A crash
// between this update and the job update is safe, including multiple workers.
async function reconcile(id: string): Promise<void> {
  const letter = await DevelopmentLetter.findById(id);
  if (!letter || !['sent', 'opened'].includes(letter.status)) return;
  await Customer.updateOne({ _id: letter.customerId, projectId: letter.projectId, mailEffectIds: { $ne: letter._id } }, {
    $inc: { letterCount: 1 }, $addToSet: { mailEffectIds: letter._id },
    $max: { lastContactAt: letter.sentAt || letter.createdAt },
  });
  if (letter.markAsDeveloped) await Customer.updateOne({ _id: letter.customerId, projectId: letter.projectId, status: 'pending' }, { $set: { status: 'contacted' } });
  await DevelopmentLetter.updateOne({ _id: id, projectId: letter.projectId, status: { $in: ['sent', 'opened'] } }, { $set: { effectsPending: false } });
}

/** The atomic state transition is the only permission to contact SMTP. */
export async function processMailJob(id?: string, deliver: (payload: SendMailPayload) => Promise<SendMailResult> = sendMail): Promise<void> {
  const job = await DevelopmentLetter.findOneAndUpdate({
    ...(id ? { _id: id } : {}),
    status: { $in: ['queued', 'scheduled', 'retrying'] },
    nextAttemptAt: { $lte: new Date() },
  }, {
    $set: { status: 'sending', claimedAt: new Date() },
    $inc: { attempts: 1 },
    $push: { history: { at: new Date(), status: 'sending' } },
  }, { new: true, sort: { nextAttemptAt: 1 } }).select('+deliveryContent');
  if (!job) return;

  // A reassignment/disabled user/deleted customer must also revoke pending sends.
  const [customer, user] = await Promise.all([
    Customer.findOne({ _id: job.customerId, projectId: job.projectId }), job.sentBy ? User.findById(job.sentBy) : null,
  ]);
  const projectAccess = user?.role === 'admin' || user?.projectIds.some((id) => String(id) === String(job.projectId));
  if (!customer || !user || user.status === 'disabled' || !projectAccess || (user.role !== 'admin' && String(customer.ownerId) !== String(user._id))) {
    await DevelopmentLetter.updateOne({ _id: job._id, status: 'sending' }, {
      $set: { status: 'cancelled', error: '客户或发送人权限已变化，任务已取消' },
      $push: { history: { at: new Date(), status: 'cancelled' } },
    });
    return;
  }

  let result: SendMailResult;
  try {
    result = await deliver({ projectId: String(job.projectId), from: job.senderAddress, to: job.recipientEmail, toName: job.recipientName, subject: job.subject,
      html: job.deliveryContent || job.content, text: job.contentText, messageId: job.messageId,
      inReplyTo: job.inReplyTo, references: job.references });
  } catch {
    result = { accepted: false, channel: job.channel, uncertain: true, error: 'SMTP 结果未知，请核实邮箱后处理', durationMs: 0 };
  }
  const retry = !result.accepted && result.retryable && !result.uncertain && job.attempts < env.MAIL_MAX_ATTEMPTS;
  const status = result.accepted ? 'sent' : retry ? 'retrying' : 'failed';
  const at = new Date();
  // Never retry SMTP if this DB write fails: the durable state stays 'sending'
  // and recovery marks it for human reconciliation.
  await DevelopmentLetter.updateOne({ _id: job._id, status: 'sending' }, {
    $set: { status, channel: result.channel, sentAt: result.accepted ? at : undefined,
      error: result.accepted ? '' : result.error || 'SMTP 发送失败',
      needsReview: Boolean(result.uncertain), effectsPending: result.accepted,
      'tracking.enabled': Boolean(result.accepted && job.tracking?.prepared),
      nextAttemptAt: new Date(at.getTime() + env.MAIL_RETRY_DELAY_MS * 2 ** (job.attempts - 1)) },
    $push: { history: { at, status, error: result.accepted ? undefined : result.error } },
  });
  if (result.accepted) await reconcile(String(job._id));
}

let running = false;
export async function runMailQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await DevelopmentLetter.updateMany({ status: 'sending', claimedAt: { $lt: new Date(Date.now() - 120000) } }, {
      $set: { status: 'failed', needsReview: true, error: '发送期间服务中断，投递结果未知；请核实，系统不会自动重发' },
      $push: { history: { at: new Date(), status: 'failed', error: '投递结果待核实' } },
    });
    for (let i = 0; i < 10; i++) await processMailJob();
    const pending = await DevelopmentLetter.find({ effectsPending: true, status: { $in: ['sent', 'opened'] } }).limit(100).select('_id');
    for (const job of pending) await reconcile(String(job._id));
  } catch {
    logger.warn('发送队列本轮失败，下轮继续；未输出原始错误以保护邮件配置');
  } finally { running = false; }
}
