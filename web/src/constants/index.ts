/**
 * 前端常量
 * ------------------------------------------------------------------
 * 枚举值与后端 server/src/constants/index.ts 保持一致。
 * 运行时优先使用 GET /api/meta 下发的定义（见 store/meta.store.ts），
 * 这里的常量作为「接口未返回前的兜底」与 UI 文案来源。
 */
import type {
  CustomerPriority,
  CustomerStatus,
  FollowUpFilter,
  FollowUpMethod,
  FollowUpResult,
  ImportField,
  LetterStatus,
  TemplateCategory,
  TimelineEventType,
  UserRole,
  UserStatus,
} from '@/types';

/* ---------------------------- 存储键 ---------------------------- */

export const STORAGE_KEYS = {
  token: 'cdlm-token',
  theme: 'cdlm-theme',
  sidebar: 'cdlm-sidebar-collapsed',
  pageSize: 'cdlm-page-size',
  /** 记住上次使用的开发信模板，提升连续发信效率 */
  lastTemplate: 'cdlm-last-letter-template',
} as const;

/* ---------------------------- 路由 ---------------------------- */

export const ROUTES = {
  login: '/login',
  dashboard: '/',
  customers: '/customers',
  customerDetail: '/customers/:id',
  letters: '/letters',
  templates: '/templates',
  users: '/users',
} as const;

/** 生成客户详情页路径 */
export const customerDetailPath = (id: string): string => `/customers/${id}`;

/* ---------------------------- 状态文案与样式 ---------------------------- */

/** 8 种销售状态的取值顺序（也用于下拉 / 漏斗的展示顺序） */
export const CUSTOMER_STATUS_VALUES = [
  'pending',
  'contacted',
  'replied',
  'interested',
  'quoting',
  'negotiating',
  'won',
  'lost',
] as const;

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

export const CUSTOMER_STATUS_OPTIONS: { value: CustomerStatus; label: string }[] =
  CUSTOMER_STATUS_VALUES.map((value) => ({ value, label: CUSTOMER_STATUS_LABEL[value] }));

/**
 * Badge 样式：8 种状态用 Tailwind 内置调色板做「明显但简洁」的区分。
 * 待开发=石板灰 / 已联系=蓝 / 已回复=青 / 有意向=琥珀 / 报价中=橙 /
 * 谈判中=紫 / 已成交=翠绿 / 已流失=玫红。
 */
export const CUSTOMER_STATUS_BADGE_CLASS: Record<CustomerStatus, string> = {
  pending: 'border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300',
  contacted: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300',
  replied: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
  interested: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  quoting: 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  negotiating: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300',
  won: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  lost: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

/**
 * 销售漏斗 / 状态分布条形的实心填充色，与上方徐章调色板一一对应。
 * 仅用于 Dashboard 漏斗的条形背景。
 */
export const CUSTOMER_STATUS_BAR_CLASS: Record<CustomerStatus, string> = {
  pending: 'bg-slate-400',
  contacted: 'bg-blue-500',
  replied: 'bg-cyan-500',
  interested: 'bg-amber-500',
  quoting: 'bg-orange-500',
  negotiating: 'bg-violet-500',
  won: 'bg-emerald-500',
  lost: 'bg-rose-500',
};

/** 跟进时间筛选项 */
export const FOLLOW_UP_FILTER_OPTIONS: { value: FollowUpFilter; label: string }[] = [
  { value: 'all', label: '全部跟进' },
  { value: 'today', label: '今天待跟进' },
  { value: 'overdue', label: '已逾期' },
  { value: 'upcoming', label: '未来' },
];

/* ---------------------------- 跟进记录（方式 / 结果） ---------------------------- */

/** 跟进方式取值顺序（与后端 FOLLOW_UP_METHOD 一致） */
export const FOLLOW_UP_METHOD_VALUES = ['email', 'whatsapp', 'phone', 'chat', 'other'] as const;

export const FOLLOW_UP_METHOD_LABEL: Record<FollowUpMethod, string> = {
  email: '邮件',
  whatsapp: 'WhatsApp',
  phone: '电话',
  chat: '在线聊天',
  other: '其他',
};

export const FOLLOW_UP_METHOD_OPTIONS: { value: FollowUpMethod; label: string }[] =
  FOLLOW_UP_METHOD_VALUES.map((value) => ({ value, label: FOLLOW_UP_METHOD_LABEL[value] }));

/** 跟进结果取值顺序（与后端 FOLLOW_UP_RESULT 一致） */
export const FOLLOW_UP_RESULT_VALUES = [
  'no_reply',
  'replied',
  'interested',
  'quoted',
  'negotiating',
  'won',
  'no_need',
  'other',
] as const;

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

export const FOLLOW_UP_RESULT_OPTIONS: { value: FollowUpResult; label: string }[] =
  FOLLOW_UP_RESULT_VALUES.map((value) => ({ value, label: FOLLOW_UP_RESULT_LABEL[value] }));

/** 客户时间线事件文案 */
export const TIMELINE_EVENT_LABEL: Record<TimelineEventType, string> = {
  created: '客户创建',
  letter: '开发信',
  followup: '跟进记录',
  status_changed: '状态变化',
  followup_scheduled: '跟进计划',
};

/* ---------------------------- 开发信模板分类 ---------------------------- */

/** 模板分类取值顺序（与后端 TEMPLATE_CATEGORY 一致） */
export const TEMPLATE_CATEGORY_VALUES = [
  'first_contact',
  'product',
  'quote',
  'followup',
  'festival',
  'other',
] as const;

export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  first_contact: '首次开发',
  product: '产品推荐',
  quote: '报价',
  followup: '跟进',
  festival: '节日',
  other: '其他',
};

export const TEMPLATE_CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] =
  TEMPLATE_CATEGORY_VALUES.map((value) => ({ value, label: TEMPLATE_CATEGORY_LABEL[value] }));

/** 模板筛选下拉：全部 + 各分类 */
export const TEMPLATE_CATEGORY_FILTER_OPTIONS: { value: TemplateCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部分类' },
  ...TEMPLATE_CATEGORY_OPTIONS,
];

export const LETTER_STATUS_LABEL: Record<LetterStatus, string> = {
  draft: '草稿',
  sent: '已发送',
  failed: '发送失败',
};

export const LETTER_STATUS_BADGE_CLASS: Record<LetterStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  sent: 'border-status-developed/30 bg-status-developed/10 text-status-developed',
  failed: 'border-status-failed/30 bg-status-failed/10 text-status-failed',
};

export const LETTER_STATUS_OPTIONS: { value: LetterStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'sent', label: '已发送' },
  { value: 'draft', label: '草稿' },
  { value: 'failed', label: '发送失败' },
];

export const MAIL_CHANNEL_LABEL: Record<string, string> = {
  mock: '模拟发送',
  smtp: 'SMTP 真实发送',
};

export const CUSTOMER_SOURCE_LABEL: Record<string, string> = {
  manual: '手工录入',
  excel: 'Excel 导入',
  seed: '初始化数据',
};

/* ---------------------------- 业务来源（leadSource） ---------------------------- */

/**
 * 规范化业务来源默认清单（与后端 CUSTOMER_LEAD_SOURCE 一致）。
 * 表单里作为 Select 选项；但导入 / 编辑允许保留任意自定义值（如「Dubai Exhibition」）。
 */
export const CUSTOMER_LEAD_SOURCE_VALUES = [
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

export const CUSTOMER_LEAD_SOURCE_OPTIONS: { value: string; label: string }[] =
  CUSTOMER_LEAD_SOURCE_VALUES.map((value) => ({ value, label: value }));

/** 列表「来源」筛选下拉：不限 + 各规范来源 */
export const CUSTOMER_LEAD_SOURCE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部来源' },
  ...CUSTOMER_LEAD_SOURCE_OPTIONS,
];

/* ---------------------------- 跟进优先级（priority） ---------------------------- */

/** 优先级取值顺序（与后端 CUSTOMER_PRIORITY 一致） */
export const CUSTOMER_PRIORITY_VALUES = ['high', 'medium', 'low'] as const;

export const CUSTOMER_PRIORITY_LABEL: Record<CustomerPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const CUSTOMER_PRIORITY_OPTIONS: { value: CustomerPriority; label: string }[] =
  CUSTOMER_PRIORITY_VALUES.map((value) => ({ value, label: CUSTOMER_PRIORITY_LABEL[value] }));

/** 列表筛选下拉：不限 + 各优先级 */
export const CUSTOMER_PRIORITY_FILTER_OPTIONS: { value: CustomerPriority | 'all'; label: string }[] = [
  { value: 'all', label: '全部优先级' },
  ...CUSTOMER_PRIORITY_OPTIONS,
];

/** 优先级徽章配色：高=玫红 / 中=琥珀 / 低=石板灰 */
export const CUSTOMER_PRIORITY_BADGE_CLASS: Record<CustomerPriority, string> = {
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300',
};

/** Excel 中「优先级」列的取值 → 系统枚举（与后端 priorityImportSchema 容错映射一致） */
export const PRIORITY_TEXT_MAP: Record<string, CustomerPriority> = {
  high: 'high',
  h: 'high',
  urgent: 'high',
  高: 'high',
  紧急: 'high',
  medium: 'medium',
  mid: 'medium',
  m: 'medium',
  normal: 'medium',
  中: 'medium',
  普通: 'medium',
  low: 'low',
  l: 'low',
  低: 'low',
};

/* ---------------------------- 用户角色 ---------------------------- */

/** 角色取值顺序（与后端 UserRole 一致） */
export const USER_ROLE_VALUES = ['admin', 'user'] as const;

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  admin: '管理员',
  user: '业务员',
};

export const USER_ROLE_OPTIONS: { value: UserRole; label: string }[] =
  USER_ROLE_VALUES.map((value) => ({ value, label: USER_ROLE_LABEL[value] }));

/** 角色徽章配色：管理员=紫 / 业务员=蓝 */
export const USER_ROLE_BADGE_CLASS: Record<UserRole, string> = {
  admin: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300',
  user: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300',
};

/* ---------------------------- 用户账号状态 ---------------------------- */

/** 账号状态取值顺序（与后端 UserStatus 一致） */
export const USER_STATUS_VALUES = ['active', 'disabled'] as const;

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: '启用',
  disabled: '已停用',
};

/** 账号状态徽章配色：启用=翠绿 / 停用=石板灰 */
export const USER_STATUS_BADGE_CLASS: Record<UserStatus, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  disabled: 'border-slate-500/30 bg-slate-500/10 text-slate-500 dark:text-slate-300',
};

/* ---------------------------- 开发信占位符 ---------------------------- */

export interface PlaceholderDef {
  key: string;
  label: string;
  token: string;
  /** 编辑器上方按钮的分组 */
  group: '客户信息' | '我方信息';
}

/**
 * 占位符兜底定义（/api/meta 加载完成后会被后端下发的清单覆盖）。
 * 新增或改名时必须同步修改后端 constants/index.ts 的 LETTER_PLACEHOLDERS，
 * 否则离线兜底与真实可用的占位符会对不上。
 */
export const PLACEHOLDER_DEFS: PlaceholderDef[] = [
  { key: 'name', label: '客户姓名', token: '{{name}}', group: '客户信息' },
  { key: 'firstName', label: '名字', token: '{{firstName}}', group: '客户信息' },
  { key: 'company', label: '公司名称', token: '{{company}}', group: '客户信息' },
  { key: 'email', label: '邮箱', token: '{{email}}', group: '客户信息' },
  { key: 'phone', label: '手机号', token: '{{phone}}', group: '客户信息' },
  { key: 'title', label: '职位', token: '{{title}}', group: '客户信息' },
  { key: 'industry', label: '行业', token: '{{industry}}', group: '客户信息' },
  { key: 'country', label: '国家 / 地区', token: '{{country}}', group: '客户信息' },
  { key: 'address', label: '地址', token: '{{address}}', group: '客户信息' },
  { key: 'customerWebsite', label: '客户官网', token: '{{customerWebsite}}', group: '客户信息' },
  { key: 'grade', label: '客户等级', token: '{{grade}}', group: '客户信息' },
  { key: 'notes', label: '备注', token: '{{notes}}', group: '客户信息' },
  { key: 'companyName', label: '我方公司名', token: '{{companyName}}', group: '我方信息' },
  { key: 'companyWebsite', label: '我方官网', token: '{{companyWebsite}}', group: '我方信息' },
  { key: 'moq', label: '最低起订量', token: '{{moq}}', group: '我方信息' },
  { key: 'senderName', label: '发件人署名', token: '{{senderName}}', group: '我方信息' },
];

/* ---------------------------- Excel 导入字段定义 ---------------------------- */

export interface ImportFieldDef {
  /** 目标字段名（提交给后端） */
  field: ImportField;
  /** 中文列名 */
  label: string;
  /** 英文列名（模板双语表头） */
  labelEn: string;
  required: boolean;
  /**
   * 自动识别用的表头别名。
   * 匹配前会做：去空格、转小写、去掉括号内容与常见标点。
   */
  aliases: string[];
  hint?: string;
}

export const IMPORT_FIELDS: ImportFieldDef[] = [
  {
    field: 'name',
    label: '姓名',
    labelEn: 'Name',
    required: true,
    aliases: ['name', 'fullname', 'contact', 'contactname', 'contactperson', '姓名', '客户姓名', '联系人', '名字'],
  },
  {
    field: 'company',
    label: '公司',
    labelEn: 'Company',
    required: false,
    aliases: ['company', 'companyname', 'organization', 'org', 'business', '公司', '公司名称', '企业', '企业名称'],
  },
  {
    field: 'email',
    label: '邮箱',
    labelEn: 'Email',
    required: false,
    aliases: ['email', 'emailaddress', 'mail', 'e-mail', '邮箱', '电子邮件', '电邮', '邮件地址', 'email地址'],
    hint: '发送开发信的必要条件；为空时需要手动指定收件人',
  },
  {
    field: 'phone',
    label: '手机号',
    labelEn: 'Phone',
    required: false,
    aliases: ['phone', 'phonenumber', 'mobile', 'tel', 'telephone', 'cell', '手机', '手机号', '电话', '联系电话'],
  },
  {
    field: 'title',
    label: '职位',
    labelEn: 'Title',
    required: false,
    aliases: ['title', 'position', 'jobtitle', 'role', '职位', '职务', '头衔'],
  },
  {
    field: 'industry',
    label: '行业',
    labelEn: 'Industry',
    required: false,
    aliases: ['industry', 'sector', 'category', '行业', '所属行业', '品类'],
  },
  {
    field: 'address',
    label: '地址',
    labelEn: 'Address',
    required: false,
    aliases: ['address', 'location', 'street', '地址', '联系地址', '通讯地址'],
  },
  {
    field: 'country',
    label: '国家',
    labelEn: 'Country',
    required: false,
    aliases: ['country', 'region', 'nation', 'market', '国家', '地区', '国家地区', '市场'],
  },
  {
    field: 'website',
    label: '官网',
    labelEn: 'Website',
    required: false,
    aliases: ['website', 'site', 'url', 'web', 'domain', 'homepage', '官网', '网站', '网址'],
  },
  {
    field: 'grade',
    label: '等级',
    labelEn: 'Grade',
    required: false,
    aliases: ['grade', 'level', 'tier', 'class', '等级', '客户等级', '级别'],
  },
  {
    field: 'notes',
    label: '备注',
    labelEn: 'Notes',
    required: false,
    aliases: ['notes', 'note', 'remark', 'remarks', 'comment', 'comments', 'description', '备注', '说明', '描述'],
  },
  {
    field: 'status',
    label: '状态',
    labelEn: 'Status',
    required: false,
    aliases: ['status', 'state', 'stage', 'devstatus', '状态', '开发状态', '客户状态', '阶段'],
    hint: '接受 8 种状态（待开发 / 已联系 / 已回复 / 有意向 / 报价中 / 谈判中 / 已成交 / 已流失）及对应英文；旧值「已开发 / developed」自动归为「已联系」；留空按导入设置中的默认状态处理',
  },
  {
    field: 'tags',
    label: '标签',
    labelEn: 'Tags',
    required: false,
    aliases: ['tags', 'tag', 'labels', '标签', '标记'],
    hint: '多个标签用英文逗号或中文顿号分隔',
  },
  {
    field: 'leadSource',
    label: '来源',
    labelEn: 'Source',
    required: false,
    aliases: ['leadsource', 'source', 'originsource', 'customersource', 'from', 'channel', '来源', '客户来源', '渠道', '获客渠道'],
    hint: '可选择规范来源（Website / Alibaba / Exhibition 等），也可保留自定义值（如 Dubai Exhibition）',
  },
  {
    field: 'priority',
    label: '优先级',
    labelEn: 'Priority',
    required: false,
    aliases: ['priority', 'followuppriority', 'urgency', '优先级', '跟进优先级', '紧急程度'],
    hint: '接受 高 / 中 / 低 及 High / Medium / Low；留空默认「中」',
  },
  {
    field: 'whatsapp',
    label: 'WhatsApp',
    labelEn: 'WhatsApp',
    required: false,
    aliases: ['whatsapp', 'whatsap', 'wa', 'whatsappnumber', 'whatsapp号码'],
  },
  {
    field: 'skype',
    label: 'Skype',
    labelEn: 'Skype',
    required: false,
    aliases: ['skype', 'skypeid', 'skypename', 'skype账号'],
  },
  {
    field: 'linkedin',
    label: 'LinkedIn',
    labelEn: 'LinkedIn',
    required: false,
    aliases: ['linkedin', 'linkedinurl', 'linkedinprofile', 'linkin', '领英'],
  },
  {
    field: 'facebook',
    label: 'Facebook',
    labelEn: 'Facebook',
    required: false,
    aliases: ['facebook', 'fb', 'facebookurl', 'facebookpage', '脸书'],
  },
  {
    field: 'instagram',
    label: 'Instagram',
    labelEn: 'Instagram',
    required: false,
    aliases: ['instagram', 'insta', 'ig', 'instagramurl', '照片墙'],
  },
  {
    field: 'interestedProducts',
    label: '感兴趣产品',
    labelEn: 'Interested Products',
    required: false,
    aliases: ['interestedproducts', 'products', 'product', 'productofinterest', 'interest', '感兴趣产品', '意向产品', '产品'],
    hint: '客户感兴趣的产品，多个可用逗号分隔',
  },
  {
    field: 'productModel',
    label: '产品型号',
    labelEn: 'Product Model',
    required: false,
    aliases: ['productmodel', 'model', 'modelno', 'itemno', '产品型号', '型号'],
  },
  {
    field: 'productCategory',
    label: '产品分类',
    labelEn: 'Product Category',
    required: false,
    aliases: ['productcategory', 'producttype', 'productclass', '产品分类', '产品类别'],
  },
  {
    field: 'expectedQuantity',
    label: '预计采购数量',
    labelEn: 'Expected Quantity',
    required: false,
    aliases: ['expectedquantity', 'quantity', 'qty', 'expectedqty', 'volume', '预计采购数量', '采购数量', '数量'],
  },
  {
    field: 'targetPrice',
    label: '目标价格',
    labelEn: 'Target Price',
    required: false,
    aliases: ['targetprice', 'price', 'target', 'expectedprice', '目标价格', '目标价', '价格'],
  },
  {
    field: 'moq',
    label: 'MOQ',
    labelEn: 'MOQ',
    required: false,
    aliases: ['moq', 'minorder', 'minimumorder', 'minorderquantity', '最小起订量', '起订量'],
    hint: '客户可接受 / 关注的最低起订量',
  },
  {
    field: 'requirementNotes',
    label: '需求备注',
    labelEn: 'Requirement Notes',
    required: false,
    aliases: ['requirementnotes', 'requirements', 'requirement', 'demand', '需求备注', '需求说明', '需求'],
  },
];

/** Excel 中「状态」列的取值 → 系统枚举（与后端 STATUS_ALIASES 保持一致） */
export const STATUS_TEXT_MAP: Record<string, CustomerStatus> = {
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
  contacted: 'contacted',
  developed: 'contacted',
  done: 'contacted',
  sent: 'contacted',
  '1': 'contacted',
  已联系: 'contacted',
  已开发: 'contacted',
  已发送: 'contacted',
  已跟进: 'contacted',
  replied: 'replied',
  reply: 'replied',
  response: 'replied',
  已回复: 'replied',
  回复: 'replied',
  interested: 'interested',
  intent: 'interested',
  有意向: 'interested',
  意向: 'interested',
  quoting: 'quoting',
  quote: 'quoting',
  quoted: 'quoting',
  报价中: 'quoting',
  报价: 'quoting',
  negotiating: 'negotiating',
  negotiation: 'negotiating',
  谈判中: 'negotiating',
  谈判: 'negotiating',
  won: 'won',
  closed: 'won',
  deal: 'won',
  已成交: 'won',
  成交: 'won',
  赢单: 'won',
  lost: 'lost',
  churned: 'lost',
  已流失: 'lost',
  流失: 'lost',
  输单: 'lost',
};

/** 默认开发信模板（首次打开编辑器时填充，可被「上次使用的模板」覆盖） */
export const DEFAULT_LETTER_TEMPLATE = `<p>Hi {{firstName}},</p>
<p>I came across {{company}} and noticed your focus on {{industry}}.</p>
<p>At {{companyName}}, we produce FSC-certified custom packaging from {{moq}} — most factories start at 500 to 1,000.</p>
<p>Would it be useful if I sent over a few structures that could fit your current range?</p>
<p>Best,<br>{{senderName}}<br>{{companyName}}</p>`;

export const DEFAULT_LETTER_SUBJECT = '{{company}} packaging — samples from {{moq}}';

/* ---------------------------- 其它 ---------------------------- */

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** 邮箱格式（与后端校验一致，宽松以兼容各类企业邮箱） */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------------------------- 客户附件 ---------------------------- */

/** 附件大小上限（与后端 env.MAX_ATTACHMENT_SIZE 一致，前端提前拦截给出友好提示） */
export const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024;
