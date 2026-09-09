/**
 * 领域模型类型（与后端 Mongoose 模型的 toJSON 输出一一对应）
 */
import type { PaginationParams } from './api';

/* ---------------------------- 枚举 ---------------------------- */

/**
 * 客户销售流程状态（8 段）
 * 待开发 → 已联系 → 已回复 → 有意向 → 报价中 → 谈判中 → 已成交 / 已流失
 */
export type CustomerStatus =
  | 'pending'
  | 'contacted'
  | 'replied'
  | 'interested'
  | 'quoting'
  | 'negotiating'
  | 'won'
  | 'lost';
/** 跟进时间筛选：全部 / 今天 / 已逾期 / 未来 */
export type FollowUpFilter = 'all' | 'today' | 'overdue' | 'upcoming';
/** 客户数据来源 */
export type CustomerSource = 'manual' | 'excel' | 'seed';
/**
 * 客户跟进优先级：high 高 / medium 中 / low 低。
 * 与 Grade（客户价值等级 A/B/C）是不同概念，可任意组合（如 A 级 + Low）。
 */
export type CustomerPriority = 'high' | 'medium' | 'low';
/** 开发信状态 */
export type LetterStatus = 'draft' | 'sent' | 'failed';
/** 发送通道 */
export type MailChannel = 'mock' | 'smtp';
/** 用户角色 */
export type UserRole = 'admin' | 'user';
/** 用户账号启用状态：active 启用 / disabled 停用 */
export type UserStatus = 'active' | 'disabled';

/* ---------------------------- 客户 ---------------------------- */

/** 负责人 / 用户摘要 */
export interface OwnerSummary {
  id: string;
  name: string;
}

/** 负责人下拉选项（GET /api/customers/owners） */
export interface OwnerOption {
  id: string;
  name: string;
  username: string;
}

export interface Customer {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  title?: string;
  industry?: string;
  address?: string;
  country?: string;
  website?: string;
  grade?: string;
  notes?: string;
  /* ---- 联系渠道 ---- */
  whatsapp?: string;
  skype?: string;
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  /* ---- 产品 / 需求信息 ---- */
  interestedProducts?: string;
  productModel?: string;
  productCategory?: string;
  expectedQuantity?: string;
  targetPrice?: string;
  moq?: string;
  requirementNotes?: string;
  status: CustomerStatus;
  source: CustomerSource;
  /** 业务来源（自由文本，兼容自定义值如「Dubai Exhibition」） */
  leadSource?: string;
  /** 跟进优先级（可选，默认 medium；与 grade 等级不同概念） */
  priority?: CustomerPriority;
  tags: string[];
  letterCount: number;
  lastContactAt?: string | Date;
  /** 负责人用户 id（可空） */
  ownerId?: string | null;
  /** 负责人摘要（后端 populate 后附带，只读） */
  owner?: OwnerSummary | null;
  /** 下一次跟进时间（可空） */
  nextFollowUpAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 新建 / 编辑客户的表单载荷 */
export type CustomerInput = Omit<
  Partial<Customer>,
  'id' | 'letterCount' | 'lastContactAt' | 'createdAt' | 'updatedAt' | 'source' | 'owner'
> & {
  name: string;
};

export interface CustomerListQuery extends PaginationParams {
  search?: string;
  status?: CustomerStatus | 'all';
  industry?: string;
  grade?: string;
  source?: CustomerSource;
  /** 业务来源筛选（自由文本 / 'all' 表示不限） */
  leadSource?: string;
  /** 跟进优先级筛选（'all' 表示不限） */
  priority?: CustomerPriority | 'all';
  hasEmail?: boolean;
  createdFrom?: string;
  createdTo?: string;
  /** 标签精确筛选 */
  tag?: string;
  /** 负责人筛选：具体用户 id / 'unassigned'（未分配）/ 'all' */
  ownerId?: string;
  /** 跟进时间筛选 */
  followUp?: FollowUpFilter;
}

/* ---------------------------- 开发信 ---------------------------- */

export interface LetterCustomerSummary {
  id: string;
  name: string;
  company?: string;
  email?: string;
  status: CustomerStatus;
}

export interface DevelopmentLetter {
  id: string;
  customerId: string;
  customer?: LetterCustomerSummary;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  /** 占位符已替换的 HTML 正文 */
  content: string;
  /** 纯文本正文 */
  contentText: string;
  /** 含 {{placeholder}} 的原始模板 */
  template: string;
  status: LetterStatus;
  channel: MailChannel;
  sentAt?: string | Date;
  messageId?: string;
  error?: string;
  sentBy?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface SendLetterPayload {
  customerId?: string;
  subject: string;
  /** 富文本 HTML，可含 {{placeholder}} */
  content: string;
  recipientEmail?: string;
  /** 发送成功后是否把「待开发」客户推进为「已联系」 */
  markAsDeveloped: boolean;
  /** 仅保存草稿 */
  saveAsDraft?: boolean;
}

export interface ResendLetterPayload {
  subject?: string;
  content?: string;
  recipientEmail?: string;
  markAsDeveloped?: boolean;
}

export interface SendLetterResult {
  letter: DevelopmentLetter;
  customer: Customer;
  channel: MailChannel;
  delivered: boolean;
  message: string;
}

export interface LetterListQuery extends PaginationParams {
  customerId?: string;
  search?: string;
  status?: LetterStatus | 'all';
  channel?: MailChannel | 'all';
  sentFrom?: string;
  sentTo?: string;
}

/** POST /api/letters/preview 的返回：占位符已替换，但未落库 */
export interface RenderedLetter {
  subject: string;
  html: string;
  text: string;
  recipientEmail: string;
  recipientName: string;
}

export interface PreviewLetterPayload {
  customerId: string;
  subject: string;
  content: string;
  recipientEmail?: string;
}

/* ---------------------------- 跟进记录 ---------------------------- */

/** 跟进方式：邮件 / WhatsApp / 电话 / 在线聊天 / 其他 */
export type FollowUpMethod = 'email' | 'whatsapp' | 'phone' | 'chat' | 'other';

/** 跟进结果：无回复 / 已回复 / 有兴趣 / 报价 / 谈判 / 成交 / 暂无需求 / 其他 */
export type FollowUpResult =
  | 'no_reply'
  | 'replied'
  | 'interested'
  | 'quoted'
  | 'negotiating'
  | 'won'
  | 'no_need'
  | 'other';

export interface FollowUp {
  id: string;
  customerId: string;
  method: FollowUpMethod;
  content: string;
  result: FollowUpResult;
  /** 本次跟进发生的时间 */
  followUpAt: string | Date;
  /** 计划的下一次跟进时间（可空） */
  nextFollowUpAt?: string | Date | null;
  createdBy?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 新增跟进记录的表单载荷 */
export interface FollowUpInput {
  method: FollowUpMethod;
  content: string;
  result: FollowUpResult;
  /** 本次跟进时间（ISO / yyyy-MM-dd），不传默认当前时间 */
  followUpAt?: string;
  /** 下一次跟进时间，'' / null 表示未设置 */
  nextFollowUpAt?: string | null;
}

export interface DeleteFollowUpResult {
  id: string;
  deleted: number;
}

/* ---------------------------- 客户附件 ---------------------------- */

/** 客户附件（GET /api/customers/:id/attachments 返回项，不含内部磁盘 path/filename） */
export interface CustomerAttachment {
  id: string;
  customerId: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy?: string;
  createdAt: string | Date;
}

/** 上传附件载荷（前端 FileReader 读为 base64 后随 JSON 提交） */
export interface UploadAttachmentInput {
  originalName: string;
  mimeType?: string;
  dataBase64: string;
}

export interface DeleteAttachmentResult {
  id: string;
  deleted: number;
}

/* ---------------------------- 客户时间线 ---------------------------- */

/** 时间线事件类型：客户创建 / 开发信 / 跟进 / 状态变化 / 下一次跟进时间变化 */
export type TimelineEventType = 'created' | 'letter' | 'followup' | 'status_changed' | 'followup_scheduled';

export interface TimelineEvent {
  /** 渲染用的稳定 key */
  id: string;
  type: TimelineEventType;
  at: string | Date;
  /** type=letter */
  letter?: { id: string; subject: string; status: LetterStatus; channel: MailChannel };
  /** type=followup */
  followUp?: {
    id: string;
    method: FollowUpMethod;
    result: FollowUpResult;
    content: string;
    nextFollowUpAt?: string | Date | null;
  };
  /** type=status_changed */
  statusChange?: { from?: CustomerStatus; to?: CustomerStatus };
  /** type=followup_scheduled：变更后的下一次跟进时间（null 表示被清除） */
  nextFollowUpAt?: string | Date | null;
}

export interface CustomerTimeline {
  items: TimelineEvent[];
  /** 最近一次联系（已发送开发信 或 跟进记录 的最新时间） */
  lastContactAt: string | Date | null;
}

/* ---------------------------- 开发信模板 ---------------------------- */

/** 模板分类：首次开发 / 产品推荐 / 报价 / 跟进 / 节日 / 其他 */
export type TemplateCategory = 'first_contact' | 'product' | 'quote' | 'followup' | 'festival' | 'other';

export interface LetterTemplate {
  id: string;
  name: string;
  /** 模板主题（支持 {{占位符}}） */
  subject: string;
  /** 模板正文（富文本 HTML，支持 {{占位符}}） */
  content: string;
  category: TemplateCategory;
  createdBy?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 新建 / 编辑模板的载荷 */
export interface TemplateInput {
  name: string;
  subject: string;
  content: string;
  category: TemplateCategory;
}

export interface DeleteTemplateResult {
  id: string;
  deleted: number;
}

/** 模板列表查询参数 */
export interface TemplateListQuery {
  category?: TemplateCategory;
  keyword?: string;
}

/* ---------------------------- 批量操作结果 ---------------------------- */

export interface BulkStatusResult {
  matched: number;
  modified: number;
  requested: number;
  notFound: number;
}

/** 批量字段更新结果（标签 / 负责人 / 下一次跟进时间共用） */
export interface BulkUpdateResult {
  matched: number;
  modified: number;
  requested: number;
  notFound: number;
}

export interface BulkDeleteResult {
  deleted: number;
  deletedLetters: number;
  requested: number;
}

export interface BulkDeleteLettersResult {
  deleted: number;
  requested: number;
}

export interface DeleteCustomerResult {
  id: string;
  deletedLetters: number;
}

/* ---------------------------- Excel 导入 ---------------------------- */

/** 可映射的 Excel 目标字段 */
export type ImportField =
  | 'name'
  | 'company'
  | 'email'
  | 'phone'
  | 'title'
  | 'industry'
  | 'address'
  | 'country'
  | 'website'
  | 'grade'
  | 'notes'
  | 'status'
  | 'tags'
  | 'leadSource'
  | 'priority'
  | 'whatsapp'
  | 'skype'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'interestedProducts'
  | 'productModel'
  | 'productCategory'
  | 'expectedQuantity'
  | 'targetPrice'
  | 'moq'
  | 'requirementNotes';

/** Excel 中的一行原始数据（key 为表头文本） */
export type RawExcelRow = Record<string, string | number | boolean | null | undefined>;

export interface ImportFailure {
  row?: number;
  name?: string;
  email?: string;
  reason: string;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failures: ImportFailure[];
  dryRun: boolean;
}

/** 单行导入数据：字段与 CustomerInput 一致，__row 用于把后端错误定位回 Excel 行号 */
export interface ImportCustomerRow extends Partial<CustomerInput> {
  __row?: number;
  name: string;
  status?: CustomerStatus;
}

export interface ImportPayload {
  customers: ImportCustomerRow[];
  onDuplicate: 'skip' | 'update';
  defaultStatus: CustomerStatus;
  dryRun?: boolean;
}

/* ---------------------------- 鉴权 ---------------------------- */

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

/* ---------------------------- 用户管理 ---------------------------- */

/**
 * 用户档案（GET / POST /api/users 的返回体）。
 * 后端已剔除 passwordHash，这里与之一致，前端永远拿不到密码。
 */
export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** 账号启用状态：active 启用 / disabled 停用 */
  status: UserStatus;
  /** 最近一次登录时间，从未登录过为 null */
  lastLoginAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 新建用户的载荷（POST /api/users，仅管理员可用） */
export interface CreateUserInput {
  username: string;
  password: string;
  /** 显示名，留空时后端回退为用户名 */
  displayName?: string;
  role: UserRole;
}

/** 编辑用户资料（PUT /api/users/:id）：显示名 / 角色，至少一项 */
export interface UpdateUserInput {
  displayName?: string;
  role?: UserRole;
}

/** 重置密码（PUT /api/users/:id/password） */
export interface ResetPasswordInput {
  password: string;
}

/** 停用 / 启用（PUT /api/users/:id/status） */
export interface SetUserStatusInput {
  status: UserStatus;
}

/* ---------------------------- 元数据 / 统计 ---------------------------- */

export interface PlaceholderMeta {
  key: string;
  label: string;
  token: string;
}

export interface MetaResponse {
  customerStatus: { value: CustomerStatus; label: string }[];
  customerSource: CustomerSource[];
  letterStatus: { value: LetterStatus; label: string }[];
  placeholders: PlaceholderMeta[];
  mailChannel: MailChannel;
  maxPageSize: number;
  company: {
    name: string;
    website: string;
    moq: string;
    senderName: string;
    mailFrom: string;
  };
}

export interface CustomerStats {
  total: number;
  pending: number;
  developed: number;
  withEmail: number;
  withoutEmail: number;
  contacted7d: number;
  byIndustry: { _id: string; count: number }[];
  byGrade: { _id: string; count: number }[];
  /** 8 种销售状态各自的数量 */
  byStatus: Record<CustomerStatus, number>;
}

export interface LetterStats {
  total: number;
  sent: number;
  draft: number;
  failed: number;
  sent7d: number;
  sent30d: number;
  channel: MailChannel;
  byDay: { _id: string; count: number }[];
}

/** 销售工作区里可点击跳转的客户摘要 */
export interface CustomerBrief {
  id: string;
  name: string;
  company?: string;
  status: CustomerStatus;
  grade?: string;
  nextFollowUpAt?: string | Date | null;
  createdAt: string | Date;
}

/** Dashboard「最近跟进」条目（已带客户名） */
export interface RecentFollowUpItem {
  id: string;
  customerId: string;
  customerName: string;
  customerCompany?: string;
  method: FollowUpMethod;
  result: FollowUpResult;
  content: string;
  followUpAt: string | Date;
}

/** 仪表盘销售工作区：今日任务 / 逾期提醒 / 最近跟进与开发 */
export interface SalesWorkspace {
  followUpToday: number;
  followUpOverdue: number;
  followUpUpcoming: number;
  newCustomersToday: number;
  lettersSentToday: number;
  overdueCustomers: CustomerBrief[];
  todayFollowUpCustomers: CustomerBrief[];
  recentFollowUps: RecentFollowUpItem[];
  recentCustomers: CustomerBrief[];
}

export interface OverviewStats {
  customer: CustomerStats;
  letter: LetterStats;
  developmentRate: number;
  recentLetters: DevelopmentLetter[];
  /** 销售工作区（今日待跟进 / 逾期 / 最近跟进等） */
  workspace: SalesWorkspace;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  timestamp: string;
  env: string;
  database: string;
  mailChannel: MailChannel;
  version: string;
}
