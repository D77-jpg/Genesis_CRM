/**
 * 发信署名解析
 * ------------------------------------------------------------------
 * 开发信结尾第一行必须是「实际发这封信的业务员」，不能所有账号共用一个名字，
 * 也不能出现「Genesis Admin / Sales Team」这种对客户无意义的落款。
 *
 * 解析顺序（逐个尝试，命中即返回）：
 *   1. 客户负责人（ownerId）的个人发件邮箱显示名 → 登录账号姓名 → 登录名
 *   2. 当前操作账号（actorId）的个人发件邮箱显示名 → 登录账号姓名 → 登录名
 *   3. 项目「发件人署名」→ 环境变量 SENDER_NAME
 *
 * 说明：邮箱显示名优先，因为它就是客户在收件箱里看到的名字；账号姓名其次；
 * 登录名（username）兜底，保证任何情况下都不会退回成一句泛称。
 */
import { Types } from 'mongoose';
import { Project, User, UserMailAccount } from '../models';
import env from '../config/env';
import { signatureName } from './letter-signature';

export interface SignerQuery {
  projectId?: Types.ObjectId | string | null;
  /** 客户负责人：这封信「应该由谁发」 */
  ownerId?: Types.ObjectId | string | null;
  /** 当前操作账号：没有负责人时的兜底（也是实际点发送的人） */
  actorId?: string | null;
}

/** 单个账号的落款候选：邮箱显示名 → 账号姓名 → 登录名 */
async function nameForUser(userId: string, projectId?: Types.ObjectId | string | null): Promise<string> {
  if (!Types.ObjectId.isValid(userId)) return '';
  const [account, user] = await Promise.all([
    UserMailAccount.findOne({ userId, ...(projectId ? { projectId } : {}) }).select('displayName').lean(),
    User.findById(userId).select('displayName username').lean(),
  ]);
  const fromAccount = (account?.displayName || '').trim();
  // 邮箱显示名被多个账号共用（例如两个账号都填成同一个英文名）时不可信：
  // 那不是「这个人在客户收件箱里的名字」，退回账号自己的姓名。
  if (fromAccount) {
    const shared = await UserMailAccount.countDocuments({
      displayName: account?.displayName,
      ...(projectId ? { projectId } : {}),
      userId: { $ne: userId },
    });
    if (!shared) return fromAccount;
  }
  return ((user?.displayName || user?.username) || '').trim();
}

/** 解析开发信/邮件结尾第一行的署名 */
export async function resolveSignerName(query: SignerQuery): Promise<string> {
  const candidates = [query.ownerId, query.actorId]
    .map((value) => (value ? String(value) : ''))
    .filter(Boolean);

  for (const userId of candidates) {
    const name = await nameForUser(userId, query.projectId);
    if (name) return signatureName(name);
  }

  const project = query.projectId
    ? await Project.findById(query.projectId).select('senderName').lean()
    : null;
  return signatureName(project?.senderName, env.SENDER_NAME);
}
