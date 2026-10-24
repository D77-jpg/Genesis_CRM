/**
 * 从邮件建客户
 * ------------------------------------------------------------------
 * 邮件中心里「未关联客户」的信，绝大多数是客户自己找上来的（询盘、订单、报价），
 * 他们不是等开发的线索，而是已有往来但 CRM 里从没建过档案的客户。
 *
 * 这个服务把这类发件人直接建成客户（状态=待跟进，来源=邮件来访），并把来信挂上去。
 * 供应商/对账/发票、平台通知、我们自己人一律不建客户。
 */
import { Types } from 'mongoose';
import { MailMessage } from '../models/MailMessage';
import { Prospect } from '../models/Prospect';
import { isBlockedEmail } from './prospecting/lead-source';
import { findCustomerDuplicates } from './customer-duplicate';
import { createCustomer } from './customer.service';
import { createCustomerSchema } from '../validators/customer.validator';
import type { AuthUser } from '../types/express';

/** 平台/系统通知：阿里、Google、Apple、企业微信、建站工具等，永远不会是客户 */
const PLATFORM_DOMAIN = /(?:^|\.)(?:alibaba|alicdn|taobao|tmall|1688|aliexpress|google|googleapis|googlemail|apple|microsoft|office365|weixin|wechat|facebookmail|facebook|instagram|linkedin|amazonses|amazonaws|amazon|sendgrid|mailchimp|shopify|cloudflare|wordpress|godaddy|wix|squarespace|exmail)\.[a-z.]+$/i;
/** 我们自己人 */
const OWN_DOMAIN = /(?:^|\.)(?:genesisbags\.com|genesisgroup\.cn)$/i;
/** 免费邮箱：不能按域名合并，只能按人（邮箱地址）单独建 */
const FREE_DOMAIN = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.jp', 'hotmail.com', 'outlook.com',
  'qq.com', '163.com', '126.com', 'foxmail.com', 'aol.com', 'icloud.com', 'me.com', 'live.com', 'msn.com',
  'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'yandex.com', 'mail.ru', 'web.de', 'seznam.cz',
  'onet.pl', 'o2.pl', 'interia.pl', 'wp.pl', 'ukr.net', 'bigpond.com', 'comcast.net', 'verizon.net']);
/** 供应商/账务往来：发票、对账、月度供货清单这类，不是销售对象 */
const SUPPLIER_SUBJECT = /(?:invoice|proforma|pro forma|statement|remittance|payment reminder|debit note|credit note|packing list|bill of lading|daily\b|对账|发票|账单|装箱单|提单|货款|月结|付款通知|付款记录)/i;
/** 已知不是客户的域名：货代、供应商、系统通知 */
const KNOWN_NON_CUSTOMER_DOMAIN = /(?:^|\.)(?:interstellarltd\.com|kineflowgroup\.com|szylc\.com|sourceflowhub\.com|taocafe\.com\.au)$/i;
/** 职能邮箱：不能当联系人 */
const ROLE_LOCAL = /^(?:accountspayable|ap|ar|accounts?|billing|invoice|payment|remittance|finance|sales|info|contact|hello|hi|support|service|customerservice|office|admin|enquiries|enquiry|inquiry|marketing|orders?|noreply|no-reply)$/i;
/** 系统类邮件（隔离提醒、退信、投递失败）：跟客户无关 */
const SYSTEM_SUBJECT = /(?:垃圾邮件隔离|隔离提醒|退信通知|投递失败|邮件退信|undeliverable|delivery status notification|mail delivery (?:failed|subsystem)|abuse report)/i;
/** 自动回复：我们主动发信的回执，不是客户来信 */
const AUTO_REPLY_SUBJECT = /^(?:thank you for (?:your )?(?:e-?mail|contacting|reaching)|thanks for (?:getting in touch|reaching out|contacting|your (?:message|inquiry))|ticket received|automatic reply|auto ?reply|autoreply|自動返信|автоответ|自动回复|自动回覆|out of office|abwesenheitsnotiz)/i;
/** 询盘/订单/报价：明确是客户在问我们要东西 */
const INQUIRY_SUBJECT = /(?:inquiry|inquiries|enquiry|enquiries|quotation|quote|rfq|order|sample|price|pricing|packaging|pouch|box|bag|询盘|询价|报价|打样|订单|定制|礼盒|包装)/i;
const SYSTEM_LOCAL = /^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|notifications?|alerts?|support@)/i;

export type SenderKind = 'customer' | 'supplier' | 'system' | 'auto';

const stripPrefix = (subject: string) => subject.replace(/^\s*(?:(?:re|fw|fwd|aw|sv|vs|答复|回复|转发)\s*[:：]\s*)+/i, '').trim();

/** 单封信的性质：平台通知 / 账务（供应商）/ 业务往来 */
export function classifyMail(input: { from: string; subject?: string }): SenderKind {
  const address = (input.from || '').trim().toLowerCase();
  const domain = address.split('@')[1] || '';
  if (!domain) return 'system';
  if (PLATFORM_DOMAIN.test(domain) || OWN_DOMAIN.test(domain) || KNOWN_NON_CUSTOMER_DOMAIN.test(domain)) return 'system';
  if (SYSTEM_LOCAL.test(address)) return 'system';
  const subject = stripPrefix(input.subject || '');
  if (SYSTEM_SUBJECT.test(subject)) return 'system';
  if (AUTO_REPLY_SUBJECT.test(subject)) return 'auto';
  if (SUPPLIER_SUBJECT.test(subject) && !INQUIRY_SUBJECT.test(subject)) return 'supplier';
  return 'customer';
}

/** snugzusa.com → Snugzusa；we-are-ffe.com → We Are Ffe */
function companyFromDomain(domain: string): string {
  const label = domain.split('.').slice(0, 1).join('');
  const words = label.replace(/[-_]+/g, ' ').trim();
  if (!words) return domain;
  return words.split(/\s+/).map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase())).join(' ');
}

interface GroupMail {
  id: Types.ObjectId;
  from: string;
  fromName?: string;
  subject?: string;
  sentAt: Date;
  mailboxUserId?: Types.ObjectId;
  kind: SenderKind;
}

export interface MailCustomerPlanItem {
  key: string;
  name: string;
  company?: string;
  email: string;
  website?: string;
  ownerId?: string;
  mailCount: number;
  lastAt: Date;
  firstSubject: string;
  /** create=新建客户；link=已有客户/线索，只挂邮件；skip-supplier / skip-system / skip-prospect / skip-blocked */
  action: 'create' | 'link' | 'skip-supplier' | 'skip-system' | 'skip-prospect' | 'skip-blocked' | 'skip-auto';
  customerId?: string;
  reason?: string;
}

export interface MailCustomerPlan {
  items: MailCustomerPlanItem[];
  totals: { create: number; link: number; skipSupplier: number; skipSystem: number; skipProspect: number; skipBlocked: number; skipAuto: number; mails: number };
}

/** 只算「未关联客户」的来信，按公司（域名）或个人（免费邮箱）分组 */
export async function buildMailCustomerPlan(projectId: string, options: { limit?: number } = {}): Promise<MailCustomerPlan> {
  const limit = Math.min(Math.max(options.limit ?? 5000, 1), 20000);
  const rows = await MailMessage.find({ projectId, deleted: { $ne: true }, customerId: null })
    .select('_id from fromName subject sentAt mailboxUserId').sort({ sentAt: -1 }).limit(limit).lean();

  const groups = new Map<string, GroupMail[]>();
  for (const row of rows as unknown as GroupMail[]) {
    const address = String(row.from || '').trim().toLowerCase();
    const domain = address.split('@')[1] || '';
    const key = FREE_DOMAIN.has(domain) || !domain ? `e:${address}` : `d:${domain}`;
    const kind = classifyMail({ from: address, subject: row.subject });
    groups.set(key, [...(groups.get(key) || []), { ...row, from: address, kind }]);
  }

  const items: MailCustomerPlanItem[] = [];
  const totals = { create: 0, link: 0, skipSupplier: 0, skipSystem: 0, skipProspect: 0, skipBlocked: 0, skipAuto: 0, mails: 0 };

  for (const [key, list] of groups) {
    const domain = key.startsWith('d:') ? key.slice(2) : '';
    const sample = list[0];
    const real = list.filter((mail) => mail.kind === 'customer');
    const supplierMails = list.filter((mail) => mail.kind === 'supplier');
    const base = {
      key,
      email: sample.from,
      mailCount: list.length,
      lastAt: sample.sentAt,
      firstSubject: String(list.find((m) => m.kind === 'customer')?.subject || sample.subject || '').slice(0, 160),
      website: domain ? `https://${domain}` : undefined,
    };
    if (!real.length) {
      const autoMails = list.filter((mail) => mail.kind === 'auto');
      const kind = supplierMails.length ? 'skip-supplier' : autoMails.length ? 'skip-auto' : 'skip-system';
      const reason = supplierMails.length ? '账务/供应商往来' : autoMails.length ? '自动回复（我们主动发的信）' : '平台通知';
      items.push({ ...base, name: sample.from, action: kind, reason });
      if (kind === 'skip-supplier') totals.skipSupplier += list.length;
      else if (kind === 'skip-auto') totals.skipAuto += list.length;
      else totals.skipSystem += list.length;
      continue;
    }
    // 联系人：优先真人邮箱（排除 accountspayable / noreply / billing 这类职能邮箱）
    const roleAddress = (address: string) => ROLE_LOCAL.test(address.split('@')[0] || '');
    const person = real.find((mail) => !roleAddress(mail.from) && mail.fromName && /\p{L}{2,}\s+\p{L}{2,}/u.test(mail.fromName))
      || real.find((mail) => !roleAddress(mail.from))
      || real.find((mail) => mail.fromName)
      || real[0];
    const contactEmail = person.from;
    const name = String(person.fromName || '').trim().slice(0, 120) || (domain ? companyFromDomain(domain) : person.from.split('@')[0]);
    const company = domain ? companyFromDomain(domain) : undefined;
    const ownerCount = new Map<string, number>();
    for (const mail of list) if (mail.mailboxUserId) ownerCount.set(String(mail.mailboxUserId), (ownerCount.get(String(mail.mailboxUserId)) || 0) + 1);
    const ownerId = [...ownerCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    if (isBlockedEmail(sample.from)) {
      items.push({ ...base, email: contactEmail, name, company, action: 'skip-blocked', reason: '邮箱在黑名单里', ownerId });
      totals.skipBlocked += list.length;
      continue;
    }
    const duplicate = await findCustomerDuplicates(projectId, { email: contactEmail, website: base.website, company, name }, { strictDomain: false });
    if (duplicate.hard.length) {
      items.push({ ...base, email: contactEmail, name, company, action: 'link', customerId: duplicate.hard[0].id, reason: `已有客户：${duplicate.hard[0].name}`, ownerId });
      totals.link += list.length;
      continue;
    }
    const prospect = await Prospect.findOne({
      projectId, $or: [{ emails: contactEmail }, ...(domain && !FREE_DOMAIN.has(domain) ? [{ domain }] : [])],
    }).select('_id company').lean();
    if (prospect) {
      items.push({ ...base, email: contactEmail, name, company, action: 'skip-prospect', reason: '已在线索池', ownerId });
      totals.skipProspect += list.length;
      continue;
    }
    items.push({ ...base, email: contactEmail, name, company, action: 'create', ownerId });
    totals.create += list.length;
  }

  totals.mails = items.filter((item) => item.action === 'create' || item.action === 'link')
    .reduce((sum, item) => sum + item.mailCount, 0);
  items.sort((a, b) => b.mailCount - a.mailCount);
  return { items, totals };
}

export interface MailCustomerResult extends MailCustomerPlan {
  created: { id: string; name: string; email: string; mails: number }[];
  linkedMails: number;
  failures: { email: string; reason: string }[];
}

/** dryRun=true 只看方案不落库；false 直接建客户并把来信挂上 */
export async function importMailCustomers(input: {
  projectId: string;
  actor: AuthUser;
  dryRun?: boolean;
  limit?: number;
}): Promise<MailCustomerResult> {
  const plan = await buildMailCustomerPlan(input.projectId, { limit: input.limit });
  const created: { id: string; name: string; email: string; mails: number }[] = [];
  const failures: { email: string; reason: string }[] = [];
  let linkedMails = 0;
  if (input.dryRun) return { ...plan, created, linkedMails, failures };

  for (const item of plan.items) {
    const ids = await MailMessage.find({
      projectId: input.projectId, deleted: { $ne: true }, customerId: null,
      ...(item.key.startsWith('d:') ? { from: new RegExp(`@${item.key.slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } : { from: item.email }),
    }).select('_id').lean();
    if (!ids.length) continue;

    if (item.action === 'link' && item.customerId) {
      await MailMessage.updateMany({ _id: { $in: ids.map((row) => row._id) } }, { $set: { customerId: new Types.ObjectId(item.customerId) } });
      linkedMails += ids.length;
      continue;
    }
    if (item.action !== 'create') continue;

    const payload = createCustomerSchema.parse({
      name: item.name,
      company: item.company,
      email: item.email,
      website: item.website,
      // 已经有真实往来，不是待开发的陌生客户：用「已联系」，别再进今日开发的初次开发队列
      status: 'contacted',
      priority: 'medium',
      leadSource: '邮件来访',
      tags: ['邮件来访'],
      notes: [
        `来源：邮件往来（客户主动来信，共 ${item.mailCount} 封）`,
        `最近来信：${item.lastAt.toISOString().slice(0, 10)}`,
        item.firstSubject ? `首个主题：${item.firstSubject}` : '',
        '档案里的联系人/公司名由邮箱和发件人自动生成，请按实际核对后补全。',
      ].filter(Boolean).join('\n').slice(0, 5000),
    });
    let customer;
    try {
      customer = await createCustomer(payload, input.actor, {
        source: 'mail',
        ...(item.ownerId ? { ownerId: item.ownerId } : {}),
      });
    } catch (error) {
      failures.push({ email: item.email, reason: error instanceof Error ? error.message : '建客户失败' });
      continue;
    }
    await MailMessage.updateMany({ _id: { $in: ids.map((row) => row._id) } }, { $set: { customerId: new Types.ObjectId(customer.id) } });
    created.push({ id: customer.id, name: customer.name, email: item.email, mails: ids.length });
    linkedMails += ids.length;
  }
  return { ...plan, created, linkedMails, failures };
}
