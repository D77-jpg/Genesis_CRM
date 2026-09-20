/**
 * 数据初始化脚本
 * ------------------------------------------------------------------
 *   npm run seed              幂等写入示例数据（已存在则跳过）
 *   npm run seed -- --reset   先清空业务集合再写入
 *
 * 覆盖的演示数据（用于展示升级后的「基础外贸客户 CRM」全貌）：
 *   - 8 个客户，恰好覆盖 8 段销售状态：待开发 / 已联系 / 已回复 / 有意向 / 报价中 / 谈判中 / 已成交 / 已流失
 *   - 负责人（ownerId）、下一次跟进时间（nextFollowUpAt，相对「今天」计算，
 *     保证 Dashboard 的今日待跟进 / 已逾期 / 即将跟进始终有数据）
 *   - 跟进记录（FollowUp）与状态 / 跟进时间变更事件（CustomerEvent）——共同构成客户 Timeline
 *   - 6 个开发信模板（覆盖全部 6 个分类），复用现有 {{占位符}} 与富文本约定
 *   - 开发信历史（示例取自项目自带的《Monarc Jewellery 深挖精简版》）
 *
 * 幂等策略：客户按 email 判重；开发信按 (customerId, 渲染后主题) 判重；
 *          跟进记录按 (customerId, followUpAt) 判重；事件按 (customerId, type, at) 判重；模板按 name 判重。
 * 时间线说明：客户的 createdAt 会回填为 createdIso（早于其开发信 / 跟进），让 Timeline 时间顺序自然；
 *          「今日新增」演示由未回填 createdIso 的新客户承担（其 createdAt = 脚本运行时刻）。
 */
import env from '../config/env';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db';
import { createLogger } from '../config/logger';
import { bootstrapAdminUser } from '../services/auth.service';
import { migrateLegacyCustomerStatus } from '../services/customer.service';
import { bootstrapProjects } from '../services/project.service';
import {
  Customer,
  CustomerAttachment,
  CustomerEvent,
  DevelopmentLetter,
  FollowUp,
  LetterTemplate,
  Quotation,
  Project,
  User,
  type ICustomer,
} from '../models';
import { htmlToPlainText, renderTemplate, buildPlaceholderValues } from '../utils/text';
import type {
  CustomerEventType,
  CustomerStatus,
  FollowUpMethod,
  FollowUpResult,
  TemplateCategory,
} from '../constants';

const logger = createLogger('seed');

interface SeedLetter {
  subject: string;
  html: string;
  sentAt: string;
}

interface SeedFollowUp {
  method: FollowUpMethod;
  result: FollowUpResult;
  content: string;
  /** 本次跟进发生时间（历史固定值，用作判重键） */
  followUpAt: string;
  /** 当时计划的下一次跟进时间（历史固定值，可空） */
  nextFollowUpAt?: string;
}

interface SeedEvent {
  type: CustomerEventType;
  at: string;
  fromStatus?: CustomerStatus;
  toStatus?: CustomerStatus;
  nextFollowUpAt?: string | null;
}

interface SeedCustomer extends Partial<ICustomer> {
  name: string;
  email: string;
  /** 回填的创建时间（ISO）；留空则用脚本运行时刻（用于演示「今日新增」） */
  createdIso?: string;
  /** 是否分配负责人（默认 true；显式 false 用于演示「未分配」筛选） */
  assignOwner?: boolean;
  /** 相对今天的天数偏移，用于设置 nextFollowUpAt；null / undefined 表示不安排 */
  followUpOffsetDays?: number | null;
  letters: SeedLetter[];
  followUps?: SeedFollowUp[];
  events?: SeedEvent[];
}

interface SeedTemplate {
  name: string;
  subject: string;
  content: string;
  category: TemplateCategory;
}

/** 相对今天 n 天的上午 10 点（固定时刻，避免深夜运行时「今日」窗口抖动） */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d;
}

const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    name: 'Ella Drake',
    company: 'Monarc Jewellery',
    email: 'ella@monarcjewellery.com',
    title: 'Founder',
    industry: 'Jewellery',
    country: 'New Zealand',
    website: 'https://monarcjewellery.com',
    address: 'Auckland, New Zealand',
    grade: 'A',
    status: 'negotiating',
    tags: ['可持续包装', 'FSC', '低MOQ', 'DTC+Wholesale'],
    notes:
      'A级｜新西兰可持续珠宝品牌｜FSC/plastic-free包装｜低库存小批量补货｜主攻100 pcs低MOQ环保珠宝包装。' +
      '官网明确将 ella@ 用于 Stocking / Wholesale enquiries，优先于 info@。Instagram: @monarc_jewellery。',
    createdIso: '2026-08-15T02:00:00.000Z',
    assignOwner: true,
    followUpOffsetDays: 0,
    letters: [
      {
        subject: "Monarc's small-batch packaging",
        sentAt: '2026-08-20T09:30:00.000Z',
        html: `<p>Hi {{firstName}},</p>
<p>I noticed {{company}} combines FSC-certified, plastic-free packaging with a deliberately lean inventory model — replenishing styles as they sell.</p>
<p>That's where custom packaging MOQ can become restrictive.</p>
<p>At {{companyName}}, we can produce FSC-certified custom jewellery packaging from {{moq}}. Most factories start at 500 to 1,000.</p>
<p>It could give {{company}} more room to test packaging for new styles or collaborations without changing your existing sustainability direction or committing to a large run.</p>
<p>Worth sending over a few structures that could fit your current system?</p>
<p>Best,<br>{{companyName}}</p>`,
      },
      {
        subject: "Re: Monarc's small-batch packaging",
        sentAt: '2026-08-27T10:15:00.000Z',
        html: `<p>Hi {{firstName}},</p>
<p>One resource that may be useful for {{company}}'s low-stock replenishment model:</p>
<p><strong>Why You Can't Just Order 50: The Truth About Packaging MOQs</strong><br>
<a href="{{companyWebsite}}/blog/packaging-moq-small-batch/">{{companyWebsite}}/blog/packaging-moq-small-batch/</a></p>
<p>It explains what actually drives packaging MOQs and where smaller runs make sense.</p>
<p>For {{company}}, I'd use it when testing packaging for a new collection or collaboration before committing to a larger replenishment run.</p>
<p>We can start custom jewellery packaging at {{moq}}. Most factories start at 500 to 1,000.</p>
<p>Use it with whoever you buy from now.</p>
<p>Best,<br>{{companyName}}</p>`,
      },
    ],
    followUps: [
      {
        method: 'email',
        result: 'replied',
        content: '客户回复邮件，对 100 pcs 起订量很感兴趣，索要 FSC 证书与打样报价。',
        followUpAt: '2026-08-23T02:10:00.000Z',
        nextFollowUpAt: '2026-08-28T02:00:00.000Z',
      },
      {
        method: 'whatsapp',
        result: 'interested',
        content: 'WhatsApp 沟通确认盒型与尺寸，客户希望先看一版带 logo 的样品。',
        followUpAt: '2026-08-28T07:40:00.000Z',
        nextFollowUpAt: '2026-09-03T07:00:00.000Z',
      },
      {
        method: 'phone',
        result: 'negotiating',
        content: '电话沟通首批 300 pcs 的价格与交期，客户正在比较另一家供应商，进入谈判阶段。',
        followUpAt: '2026-09-03T01:30:00.000Z',
        nextFollowUpAt: '2026-09-09T01:00:00.000Z',
      },
    ],
    events: [
      { type: 'status_changed', at: '2026-08-23T02:15:00.000Z', fromStatus: 'contacted', toStatus: 'interested' },
      { type: 'status_changed', at: '2026-09-03T01:35:00.000Z', fromStatus: 'interested', toStatus: 'negotiating' },
      { type: 'followup_scheduled', at: '2026-09-03T01:40:00.000Z', nextFollowUpAt: '2026-09-09T01:00:00.000Z' },
    ],
  },
  {
    name: 'Marcus Chen',
    company: 'Lumen Fine Jewellery',
    email: 'marcus@lumenfinejewellery.com',
    title: 'Purchasing Manager',
    industry: 'Jewellery',
    country: 'Singapore',
    address: 'Singapore',
    grade: 'A',
    status: 'won',
    tags: ['高端线', '礼盒'],
    notes: '高客单价（£800+），关注礼盒内托保护结构与烫金工艺，MOQ 承受力强。',
    createdIso: '2026-07-28T02:00:00.000Z',
    assignOwner: true,
    followUpOffsetDays: null,
    letters: [
      {
        subject: 'Luxury gift boxes for Lumen Fine Jewellery',
        sentAt: '2026-08-05T08:30:00.000Z',
        html: `<p>Hi {{firstName}},</p>
<p>For a high-value line like {{company}}, the unboxing matters as much as the piece inside.</p>
<p>We build rigid gift boxes with protective inserts and foil stamping from {{moq}}.</p>
<p>Could I send a few structures suited to your £800+ pieces?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
      },
    ],
    followUps: [
      {
        method: 'email',
        result: 'quoted',
        content: '客户索要 200 pcs 礼盒报价与内托保护方案，已发送含烫金选项的报价单。',
        followUpAt: '2026-08-12T07:20:00.000Z',
        nextFollowUpAt: '2026-08-18T07:00:00.000Z',
      },
      {
        method: 'phone',
        result: 'won',
        content: '电话确认首批 200 pcs 订单，客户接受报价，安排打样与定金，成交。',
        followUpAt: '2026-08-19T02:40:00.000Z',
      },
    ],
    events: [
      { type: 'status_changed', at: '2026-08-12T07:25:00.000Z', fromStatus: 'interested', toStatus: 'quoting' },
      { type: 'status_changed', at: '2026-08-19T02:45:00.000Z', fromStatus: 'quoting', toStatus: 'won' },
    ],
  },
  {
    name: 'Amelia Hart',
    company: 'Wildflower Adornments',
    email: 'hello@wildfloweradorn.co.uk',
    title: 'Owner',
    industry: 'Fashion Accessories',
    country: 'United Kingdom',
    website: 'https://wildfloweradorn.co.uk',
    address: 'Bristol, UK',
    grade: 'B',
    status: 'replied',
    tags: [' Etsy 卖家', '可降解'],
    notes: 'Etsy + 独立站双渠道，月出单约 600 单，需要低成本可降解快递袋与棉纸。',
    createdIso: '2026-07-10T02:00:00.000Z',
    assignOwner: true,
    followUpOffsetDays: -2,
    letters: [
      {
        subject: 'Compostable mailers from 100 pcs',
        sentAt: '2026-07-14T08:00:00.000Z',
        html: `<p>Hi {{firstName}},</p>
<p>Running {{company}} on both Etsy and your own site usually means packaging volumes that swing month to month.</p>
<p>We produce home-compostable mailers and tissue paper from {{moq}}, so you can reorder in step with actual demand instead of warehousing a year's supply.</p>
<p>Would a sample set be useful before your next restock?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
      },
    ],
    followUps: [
      {
        method: 'email',
        result: 'replied',
        content: '客户回复邮件，确认可降解快递袋需求，索要样品与价格区间。',
        followUpAt: '2026-07-20T03:10:00.000Z',
        nextFollowUpAt: '2026-07-26T03:00:00.000Z',
      },
    ],
    events: [
      { type: 'status_changed', at: '2026-07-20T03:15:00.000Z', fromStatus: 'contacted', toStatus: 'replied' },
    ],
  },
  {
    name: 'Sarah Lindqvist',
    company: 'Nordic Silver Studio',
    email: 'sarah@nordicsilverstudio.se',
    title: 'Creative Director',
    industry: 'Jewellery',
    country: 'Sweden',
    website: 'https://nordicsilverstudio.se',
    address: 'Stockholm, Sweden',
    grade: 'B',
    status: 'interested',
    tags: ['北欧设计', '小批量'],
    notes: '主打极简银饰，年销量约 8,000 件，包装目前使用通用灰板盒，无品牌定制。',
    createdIso: '2026-08-25T02:00:00.000Z',
    assignOwner: false,
    followUpOffsetDays: 2,
    letters: [
      {
        subject: 'Minimal packaging for Nordic Silver Studio',
        sentAt: '2026-08-28T09:30:00.000Z',
        html: `<p>Hi {{firstName}},</p>
<p>{{company}}'s minimalist silver work deserves packaging that feels just as considered.</p>
<p>We produce clean, plastic-free boxes from {{moq}} — no generic grey board needed.</p>
<p>Worth exploring a branded option for your next collection?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
      },
    ],
    followUps: [
      {
        method: 'chat',
        result: 'interested',
        content: '在线聊天中客户表达了对小批量品牌盒的兴趣，约定后续发送方案。',
        followUpAt: '2026-09-01T06:00:00.000Z',
        nextFollowUpAt: '2026-09-10T06:00:00.000Z',
      },
    ],
    events: [
      { type: 'status_changed', at: '2026-09-01T06:05:00.000Z', fromStatus: 'contacted', toStatus: 'interested' },
    ],
  },
  {
    name: 'Tomás Ferreira',
    company: 'Aurum Atelier',
    email: 'tomas@aurumatelier.pt',
    phone: '+351 912 000 000',
    title: 'Founder',
    industry: 'Jewellery',
    country: 'Portugal',
    address: 'Porto, Portugal',
    grade: 'C',
    status: 'lost',
    tags: ['定制', 'Bespoke'],
    notes: '以 bespoke 定制为主，单笔量小但频次高，适合小批量多次补货模式。',
    createdIso: '2026-08-01T02:00:00.000Z',
    assignOwner: true,
    followUpOffsetDays: null,
    letters: [],
    followUps: [
      {
        method: 'whatsapp',
        result: 'no_need',
        content: 'WhatsApp 联系，客户表示已固定使用本地供应商，暂无更换计划，标记为流失。',
        followUpAt: '2026-08-22T10:00:00.000Z',
      },
    ],
    events: [
      { type: 'status_changed', at: '2026-08-22T10:05:00.000Z', fromStatus: 'contacted', toStatus: 'lost' },
    ],
  },
  {
    name: 'Priya Nair',
    company: 'Saffron Gems',
    email: 'priya@saffrongems.in',
    title: 'Buyer',
    industry: 'Jewellery',
    country: 'India',
    website: 'https://saffrongems.in',
    address: 'Mumbai, India',
    grade: 'B',
    status: 'quoting',
    tags: ['彩色宝石', '礼盒', '中批量'],
    notes: '主营彩色宝石首饰，节日季礼盒需求集中，正在比对多家报价。',
    createdIso: '2026-08-30T02:00:00.000Z',
    assignOwner: true,
    followUpOffsetDays: 1,
    letters: [
      {
        subject: 'Festival-season gift boxes for Saffron Gems',
        sentAt: '2026-09-02T06:30:00.000Z',
        html: `<p>Hi {{firstName}},</p>
<p>Festival season usually means a sudden spike in gift-box demand for {{company}}.</p>
<p>We can produce branded boxes from {{moq}}, with foil stamping and quick turnaround.</p>
<p>Would a tiered quote for your peak quantities be useful?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
      },
    ],
    followUps: [
      {
        method: 'email',
        result: 'quoted',
        content: '客户回复询问 500/1000 pcs 阶梯价与烫金费用，已发送初步报价单。',
        followUpAt: '2026-09-04T03:20:00.000Z',
        nextFollowUpAt: '2026-09-09T03:00:00.000Z',
      },
    ],
    events: [
      { type: 'status_changed', at: '2026-09-04T03:25:00.000Z', fromStatus: 'interested', toStatus: 'quoting' },
    ],
  },
  {
    name: 'David Okafor',
    company: 'Lagos Luxe',
    email: 'david@lagosluxe.ng',
    title: 'Managing Director',
    industry: 'Jewellery',
    country: 'Nigeria',
    address: 'Lagos, Nigeria',
    grade: 'A',
    status: 'contacted',
    tags: ['高端线', '首次开发'],
    notes: '西非高端珠宝零售商，刚发出首封开发信，等待回复。',
    createdIso: '2026-09-03T02:00:00.000Z',
    assignOwner: true,
    followUpOffsetDays: -1,
    letters: [
      {
        subject: 'Premium packaging for Lagos Luxe',
        sentAt: '2026-09-05T09:00:00.000Z',
        html: `<p>Hi {{firstName}},</p>
<p>{{company}}'s positioning in {{country}} immediately stood out to us.</p>
<p>We craft premium rigid boxes and protective inserts from {{moq}}, built for high-value jewellery.</p>
<p>Could I send a couple of structures suited to your collections?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
      },
    ],
    events: [
      { type: 'status_changed', at: '2026-09-05T09:05:00.000Z', fromStatus: 'pending', toStatus: 'contacted' },
      { type: 'followup_scheduled', at: '2026-09-05T09:06:00.000Z', nextFollowUpAt: '2026-09-07T09:00:00.000Z' },
    ],
  },
  {
    name: 'Hana Yamamoto',
    company: 'Sakura Pearl',
    email: 'hana@sakurapearl.jp',
    title: 'Founder',
    industry: 'Jewellery',
    country: 'Japan',
    website: 'https://sakurapearl.jp',
    address: 'Tokyo, Japan',
    grade: 'B',
    status: 'pending',
    tags: ['珍珠', '极简', '待开发'],
    notes: '新导入的潜在珍珠品牌，尚未联系，等待首次开发。（createdIso 留空 → 计入「今日新增」）',
    assignOwner: false,
    followUpOffsetDays: null,
    letters: [],
  },
];

const SEED_TEMPLATES: SeedTemplate[] = [
  {
    name: '首次开发 · 小批量定制包装',
    category: 'first_contact',
    subject: 'Custom packaging for {{company}} — from {{moq}}',
    content: `<p>Hi {{firstName}},</p>
<p>I came across {{company}} and loved your work in {{industry}}.</p>
<p>We produce custom packaging from {{moq}}, so you can test new designs without a big commitment.</p>
<p>Worth a quick look at a few structures that could fit {{company}}?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
  },
  {
    name: '产品推荐 · FSC 环保珠宝盒',
    category: 'product',
    subject: 'FSC-certified boxes for {{company}}',
    content: `<p>Hi {{firstName}},</p>
<p>For {{company}}'s {{industry}} line, our FSC-certified, plastic-free boxes are a popular choice.</p>
<p>Available from {{moq}}, with foil stamping and custom inserts.</p>
<p>Happy to send samples — would that help?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
  },
  {
    name: '报价 · 阶梯价与打样',
    category: 'quote',
    subject: 'Quote for {{company}}',
    content: `<p>Hi {{firstName}},</p>
<p>Thanks for your interest. Here's a quick outline for {{company}}:</p>
<ul><li>Tiered pricing from {{moq}}</li><li>Sample lead time: 5–7 days</li><li>Bulk lead time: 20–25 days</li></ul>
<p>I can prepare a formal quote against your target quantities. Shall I?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
  },
  {
    name: '跟进 · 温和提醒',
    category: 'followup',
    subject: 'Re: following up, {{firstName}}',
    content: `<p>Hi {{firstName}},</p>
<p>Just floating this back to the top of your inbox.</p>
<p>Whenever {{company}} is ready to look at packaging, I'm happy to help — no rush.</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
  },
  {
    name: '节日 · 新年问候',
    category: 'festival',
    subject: `Season's greetings from {{companyName}}`,
    content: `<p>Hi {{firstName}},</p>
<p>Wishing you and the {{company}} team a wonderful holiday season and a prosperous new year.</p>
<p>Thank you for your trust this year — we look forward to continuing in {{industry}} together.</p>
<p>Warm regards,<br>{{senderName}}<br>{{companyName}}</p>`,
  },
  {
    name: '其他 · 展会邀请',
    category: 'other',
    subject: 'Meet {{companyName}} at the {{industry}} fair',
    content: `<p>Hi {{firstName}},</p>
<p>We'll be exhibiting at the upcoming {{industry}} trade fair.</p>
<p>If {{company}} is attending, I'd love to meet in person and show our latest packaging.</p>
<p>Let me know if you'd like to book a slot.</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`,
  },
];

function buildValues(customer: Partial<ICustomer>) {
  return {
    ...buildPlaceholderValues(customer),
    companyName: env.COMPANY_NAME,
    companyWebsite: env.COMPANY_WEBSITE,
    moq: env.COMPANY_MOQ,
    senderName: env.SENDER_NAME,
  };
}

async function reset(projectId: Types.ObjectId): Promise<void> {
  logger.warn('--reset：正在清空业务集合（customers / developmentletters / followups / customerevents / customerattachments / quotations / lettertemplates）...');
  const scope = { projectId };
  await DevelopmentLetter.deleteMany(scope);
  await FollowUp.deleteMany(scope);
  await CustomerEvent.deleteMany(scope);
  await CustomerAttachment.deleteMany(scope);
  await Quotation.deleteMany(scope);
  await LetterTemplate.deleteMany(scope);
  await Customer.deleteMany(scope);
  logger.info('已清空');
}

async function seed(projectId: Types.ObjectId): Promise<void> {
  const admin = await User.findOne({ username: env.ADMIN_USERNAME.trim().toLowerCase() });
  const adminId = admin?._id;

  let createdCustomers = 0;
  let skippedCustomers = 0;
  let createdLetters = 0;
  let createdFollowUps = 0;
  let createdEvents = 0;

  for (const item of SEED_CUSTOMERS) {
    const { letters, followUps, events, createdIso, assignOwner, followUpOffsetDays, ...fields } = item;
    const existing = await Customer.findOne({ projectId, email: fields.email });
    const isNew = !existing;

    const customerId = existing
      ? existing._id
      : (await Customer.create({
          projectId,
          ...fields,
          source: 'seed',
          letterCount: 0,
          ...(assignOwner !== false && adminId ? { ownerId: adminId } : {}),
          ...(adminId ? { createdBy: adminId } : {}),
          ...(followUpOffsetDays != null ? { nextFollowUpAt: daysFromNow(followUpOffsetDays) } : {}),
        }))._id;

    if (existing) {
      skippedCustomers += 1;
      logger.debug(`客户已存在，跳过创建: ${fields.name} <${fields.email}>`);
    } else {
      createdCustomers += 1;
      logger.info(`已创建客户: ${fields.name} (${fields.company ?? '-'})`);
    }

    // 开发信：以「主题 + 客户」判重，保证脚本可重复执行
    for (const letter of letters) {
      const exists = await DevelopmentLetter.findOne({
        projectId,
        customerId,
        subject: renderTemplate(letter.subject, buildValues(item)),
      });
      if (exists) continue;

      const values = buildValues(item);
      const subject = renderTemplate(letter.subject, values, { escape: false });
      const html = renderTemplate(letter.html, values, { escape: true });
      const text = htmlToPlainText(renderTemplate(letter.html, values, { escape: false }));

      await DevelopmentLetter.create({
        projectId,
        customerId,
        recipientName: item.name,
        recipientEmail: item.email,
        subject,
        content: html,
        contentText: text,
        template: letter.html,
        status: 'sent',
        channel: 'mock',
        sentAt: new Date(letter.sentAt),
        messageId: `<seed.${Date.now()}.${Math.random().toString(36).slice(2, 10)}@genesis.local>`,
      });
      createdLetters += 1;
    }

    // 跟进记录：以 (customerId, followUpAt) 判重
    for (const fu of followUps ?? []) {
      const followUpAt = new Date(fu.followUpAt);
      const exists = await FollowUp.findOne({ projectId, customerId, followUpAt });
      if (exists) continue;
      await FollowUp.create({
        projectId,
        customerId,
        method: fu.method,
        result: fu.result,
        content: fu.content,
        followUpAt,
        ...(fu.nextFollowUpAt ? { nextFollowUpAt: new Date(fu.nextFollowUpAt) } : {}),
        ...(adminId ? { createdBy: adminId } : {}),
      });
      createdFollowUps += 1;
    }

    // 变更事件：以 (customerId, type, at) 判重（用于 Timeline 的状态 / 跟进时间变化）
    for (const ev of events ?? []) {
      const at = new Date(ev.at);
      const exists = await CustomerEvent.findOne({ projectId, customerId, type: ev.type, at });
      if (exists) continue;
      await CustomerEvent.create({
        projectId,
        customerId,
        type: ev.type,
        at,
        ...(ev.fromStatus ? { fromStatus: ev.fromStatus } : {}),
        ...(ev.toStatus ? { toStatus: ev.toStatus } : {}),
        ...(ev.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: ev.nextFollowUpAt === null ? null : new Date(ev.nextFollowUpAt) }
          : {}),
        ...(adminId ? { createdBy: adminId } : {}),
      });
      createdEvents += 1;
    }

    // 回写计数器与最近联系时间（取「已发送开发信」与「跟进记录」的较新者）；
    // 新客户额外回填 createdAt，让 Timeline 的「客户创建」排在最早。
    const [count, lastLetter, lastFollowUp] = await Promise.all([
      DevelopmentLetter.countDocuments({ projectId, customerId, status: { $in: ['sent', 'opened'] } }),
      DevelopmentLetter.findOne({ projectId, customerId, status: { $in: ['sent', 'opened'] } }).sort({ sentAt: -1 }).select('sentAt'),
      FollowUp.findOne({ projectId, customerId }).sort({ followUpAt: -1 }).select('followUpAt'),
    ]);
    const patch: Record<string, unknown> = { letterCount: count };
    const contactTimes = [lastLetter?.sentAt, lastFollowUp?.followUpAt]
      .filter((d): d is Date => Boolean(d))
      .map((d) => new Date(d).getTime());
    if (contactTimes.length > 0) patch.lastContactAt = new Date(Math.max(...contactTimes));
    await Customer.updateOne({ _id: customerId, projectId }, { $set: patch });
    // createdAt 受 Mongoose timestamps 保护，普通 update 改不动；用底层 driver 直接回填，
    // 让 Timeline 的「客户创建」排在其开发信 / 跟进之前，也让「今日新增」只统计真正今天导入的客户。
    if (isNew && createdIso) {
      await Customer.collection.updateOne({ _id: customerId }, { $set: { createdAt: new Date(createdIso) } });
    }
  }

  // 开发信模板：以 name 判重
  let createdTemplates = 0;
  for (const tpl of SEED_TEMPLATES) {
    const exists = await LetterTemplate.findOne({ projectId, name: tpl.name });
    if (exists) continue;
    await LetterTemplate.create({ projectId, ...tpl, ...(adminId ? { createdBy: adminId } : {}) });
    createdTemplates += 1;
  }

  logger.info('----------------------------------------------');
  logger.info(
    `Seed 完成：新增客户 ${createdCustomers}（跳过 ${skippedCustomers}），开发信 ${createdLetters}，跟进记录 ${createdFollowUps}，活动事件 ${createdEvents}，模板 ${createdTemplates}`,
  );
  logger.info('登录账号使用环境变量配置（不输出凭据）');
  logger.info('----------------------------------------------');
}

async function main(): Promise<void> {
  const shouldReset = process.argv.includes('--reset');
  try {
    await connectDatabase();
    await bootstrapProjects();
    await bootstrapAdminUser();
    await bootstrapProjects();
    await migrateLegacyCustomerStatus();
    const genesis = await Project.findOne({ slug: 'genesis-bags' }).select('_id');
    if (!genesis) throw new Error('Genesis Bags 项目初始化失败');
    if (shouldReset) await reset(genesis._id);
    await seed(genesis._id);
  } catch (error) {
    logger.error('Seed 失败', error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main();
