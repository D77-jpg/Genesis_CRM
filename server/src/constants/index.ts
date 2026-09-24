/**
 * 全局业务常量与枚举
 * ------------------------------------------------------------------
 * 前端有一份对应的镜像定义（web/src/constants/index.ts），
 * 两边必须保持一致；改动时请同步修改。
 */

/**
 * 客户销售流程状态（8 段）
 * 待开发 → 已联系 → 已回复 → 有意向 → 报价中 → 谈判中 → 已成交 / 已流失
 * 注：历史数据的 'developed' 会在服务启动时迁移为 'contacted'
 *     （见 customer.service.migrateLegacyCustomerStatus）
 */
export const CUSTOMER_STATUS = [
  'pending',
  'contacted',
  'replied',
  'interested',
  'quoting',
  'negotiating',
  'won',
  'lost',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUS)[number];

/** 开发信状态 */
export const LETTER_STATUS = ['draft', 'sent', 'opened', 'failed', 'queued', 'scheduled', 'sending', 'retrying', 'cancelled'] as const;
export type LetterStatus = (typeof LETTER_STATUS)[number];

/** 发送通道 */
export const MAIL_CHANNEL = ['mock', 'smtp'] as const;
export type MailChannel = (typeof MAIL_CHANNEL)[number];

/** 客户来源（数据溯源：手工 / Excel / 初始化 / 集成 API 同步） */
export const CUSTOMER_SOURCE = ['manual', 'excel', 'seed', 'integration'] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCE)[number];

/* ---------------------------- Integration API v1 ---------------------------- */

/** Integration API 契约版本（与 docs/integration/integration-v1.openapi.yaml 一致） */
export const INTEGRATION_CONTRACT_VERSION = '1.0';

/**
 * 集成凭证 scope 全集。签发凭证时只能从此集合中选取（最小权限）。
 * customers:upsert 同时授权客户状态只读查询（5.2 预留端点复用）。
 */
export const INTEGRATION_SCOPES = [
  'customers:upsert',
  'outcomes:read',
  'stats:read',
  'quotations:draft',
  'quotations:read',
] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

/** 集成凭证状态 */
export const INTEGRATION_CREDENTIAL_STATUS = ['active', 'revoked'] as const;
export type IntegrationCredentialStatus = (typeof INTEGRATION_CREDENTIAL_STATUS)[number];

/** 成交/流失回流的终止状态集合（outcome feed 只输出这两类） */
export const OUTCOME_STATUSES = ['won', 'lost'] as const;

/**
 * 客户业务来源（客户从哪个渠道来的），与上面的 CUSTOMER_SOURCE 是不同维度。
 * 这里给出建议的默认选项，但字段本身是自由字符串，兼容 Excel 导入的历史自定义值
 * （如 "Dubai Exhibition"），因此不做 enum 强约束。
 */
export const CUSTOMER_LEAD_SOURCE = [
  'Excel Import',
  'Website',
  'Alibaba',
  'Made-in-China',
  'Google',
  'Facebook',
  'LinkedIn',
  'WhatsApp',
  'Exhibition',
  'Referral',
  'Existing Customer',
  'Other',
] as const;
export type CustomerLeadSource = (typeof CUSTOMER_LEAD_SOURCE)[number];

/**
 * 客户跟进优先级：high / medium / low。
 * 与「客户等级 grade（A/B/C）」是两个独立维度，可任意组合（如 A 级 + Low Priority）。
 */
export const CUSTOMER_PRIORITY = ['high', 'medium', 'low'] as const;
export type CustomerPriority = (typeof CUSTOMER_PRIORITY)[number];

/**
 * 跟进方式（客户跟进记录）
 * 邮件 / WhatsApp / 电话 / 在线聊天 / 其他
 */
export const FOLLOW_UP_METHOD = ['email', 'whatsapp', 'phone', 'chat', 'other'] as const;
export type FollowUpMethod = (typeof FOLLOW_UP_METHOD)[number];

/**
 * 跟进结果（客户跟进记录）
 * 无回复 / 已回复 / 有兴趣 / 报价 / 谈判 / 成交 / 暂无需求 / 其他
 */
export const FOLLOW_UP_RESULT = [
  'no_reply',
  'replied',
  'interested',
  'quoted',
  'negotiating',
  'won',
  'no_need',
  'other',
] as const;
export type FollowUpResult = (typeof FOLLOW_UP_RESULT)[number];

/**
 * 客户活动时间线中「无法从其它集合还原」的事件类型。
 * 客户创建 / 开发信 / 跟进记录都能从各自的集合派生，无需在此登记；
 * 只有「状态变化」「下一次跟进时间变化」这类字段改动需要单独记一条事件。
 */
export const CUSTOMER_EVENT_TYPE = ['status_changed', 'followup_scheduled'] as const;
export type CustomerEventType = (typeof CUSTOMER_EVENT_TYPE)[number];

/**
 * 报价单状态（V2 报价管理）
 * 草稿 → 已发送 → 谈判中 → 已接受 / 已拒绝 / 已过期
 */
export const QUOTATION_STATUS = [
  'draft',
  'sent',
  'negotiating',
  'accepted',
  'rejected',
  'expired',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUS)[number];

/**
 * 报价币种（外贸常见结算币种）。
 * 采用固定枚举以便前端下拉与展示统一；默认 USD。
 * 金额始终以「币种最小主单位（元）」存储，保留两位小数。
 */
export const QUOTATION_CURRENCY = [
  'USD',
  'EUR',
  'GBP',
  'CNY',
  'JPY',
  'HKD',
  'AUD',
  'CAD',
  'CHF',
  'SGD',
  'AED',
  'NZD',
] as const;
export type QuotationCurrency = (typeof QUOTATION_CURRENCY)[number];

/**
 * 开发信模板分类
 * 首次开发 / 产品推荐 / 报价 / 跟进 / 节日 / 其他
 */
export const TEMPLATE_CATEGORY = [
  'first_contact',
  'product',
  'quote',
  'followup',
  'festival',
  'other',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORY)[number];

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  pending: '待开发',
  contacted: '已联系',
  replied: '已回复',
  interested: '有意向',
  quoting: '报价中',
  negotiating: '谈判中',
  won: '已成交',
  lost: '已流失',
};

export const CUSTOMER_PRIORITY_LABEL: Record<CustomerPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const LETTER_STATUS_LABEL: Record<LetterStatus, string> = {
  queued: '等待发送', scheduled: '定时发送', sending: '发送中', retrying: '等待重试', cancelled: '已取消',
  draft: '草稿',
  sent: '已发送',
  opened: '已打开',
  failed: '发送失败',
};

export const FOLLOW_UP_METHOD_LABEL: Record<FollowUpMethod, string> = {
  email: '邮件',
  whatsapp: 'WhatsApp',
  phone: '电话',
  chat: '在线聊天',
  other: '其他',
};

export const FOLLOW_UP_RESULT_LABEL: Record<FollowUpResult, string> = {
  no_reply: '无回复',
  replied: '已回复',
  interested: '有兴趣',
  quoted: '报价',
  negotiating: '谈判',
  won: '成交',
  no_need: '暂无需求',
  other: '其他',
};

export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  first_contact: '首次开发',
  product: '产品推荐',
  quote: '报价',
  followup: '跟进',
  festival: '节日',
  other: '其他',
};

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: '草稿',
  sent: '已发送',
  negotiating: '谈判中',
  accepted: '已接受',
  rejected: '已拒绝',
  expired: '已过期',
};

/** Excel 导入时可用于识别「状态」列的取值（统一小写比较） */
export const STATUS_ALIASES: Record<string, CustomerStatus> = {
  // 待开发
  pending: 'pending',
  undeveloped: 'pending',
  todo: 'pending',
  new: 'pending',
  lead: 'pending',
  '0': 'pending',
  待开发: 'pending',
  未开发: 'pending',
  新客户: 'pending',
  潜在: 'pending',
  潜在客户: 'pending',
  // 已联系（兼容旧的 developed / 已开发）
  contacted: 'contacted',
  developed: 'contacted',
  done: 'contacted',
  sent: 'contacted',
  '1': 'contacted',
  已联系: 'contacted',
  已开发: 'contacted',
  已发送: 'contacted',
  已跟进: 'contacted',
  // 已回复
  replied: 'replied',
  reply: 'replied',
  response: 'replied',
  已回复: 'replied',
  回复: 'replied',
  // 有意向
  interested: 'interested',
  intent: 'interested',
  有意向: 'interested',
  意向: 'interested',
  // 报价中
  quoting: 'quoting',
  quote: 'quoting',
  quoted: 'quoting',
  报价中: 'quoting',
  报价: 'quoting',
  // 谈判中
  negotiating: 'negotiating',
  negotiation: 'negotiating',
  谈判中: 'negotiating',
  谈判: 'negotiating',
  // 已成交
  won: 'won',
  closed: 'won',
  deal: 'won',
  已成交: 'won',
  成交: 'won',
  赢单: 'won',
  // 已流失
  lost: 'lost',
  churned: 'lost',
  已流失: 'lost',
  流失: 'lost',
  输单: 'lost',
};

/**
 * 开发信富文本中可插入的占位符
 * key 会渲染为 {{key}}，后端在发送前用客户信息替换
 */
export const LETTER_PLACEHOLDERS = [
  { key: 'name', label: '客户姓名', fallback: 'there' },
  { key: 'firstName', label: '名字（First Name）', fallback: 'there' },
  { key: 'company', label: '公司名称', fallback: 'your company' },
  { key: 'email', label: '邮箱', fallback: '' },
  { key: 'phone', label: '手机号', fallback: '' },
  { key: 'title', label: '职位', fallback: '' },
  { key: 'industry', label: '行业', fallback: '' },
  { key: 'country', label: '国家 / 地区', fallback: '' },
  { key: 'address', label: '地址', fallback: '' },
  // 命名为 customerWebsite，与「我方官网 companyWebsite」区分开，避免写信时插错
  { key: 'customerWebsite', label: '客户官网', fallback: '' },
  { key: 'grade', label: '客户等级', fallback: '' },
  { key: 'notes', label: '备注', fallback: '' },
  { key: 'companyName', label: '我方公司名', fallback: '' },
  { key: 'companyWebsite', label: '我方官网', fallback: '' },
  { key: 'moq', label: '最低起订量', fallback: '' },
  { key: 'senderName', label: '发件人署名', fallback: '' },
] as const;

export type PlaceholderKey = (typeof LETTER_PLACEHOLDERS)[number]['key'];

/** 列表接口允许的分页上限，防止一次拉爆数据库 */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 20;

/** 单次批量操作的最大条数 */
export const MAX_BULK_SIZE = 1000;
