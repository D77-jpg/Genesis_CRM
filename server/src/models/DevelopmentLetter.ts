/**
 * DevelopmentLetter 模型
 * ------------------------------------------------------------------
 * 每一封发送给客户的开发信都会落一条记录，
 * 与 Customer 是 N:1 关系；删除客户时级联清理其开发信。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import { LETTER_STATUS, MAIL_CHANNEL, type LetterStatus, type MailChannel } from '../constants';

export interface IDevelopmentLetter {
  projectId: Types.ObjectId;
  /** 所属客户 */
  customerId: Types.ObjectId;
  /** 收件人姓名（发送时的快照，避免客户改名后历史失真） */
  recipientName: string;
  /** 收件人邮箱（快照） */
  recipientEmail: string;
  /** 邮件主题 */
  subject: string;
  /** 发送时使用的项目发件身份快照 */
  senderAddress?: string;
  /** 真实发送时锁定的业务员邮箱账户；草稿或 Mock 任务可为空。 */
  mailAccountId?: Types.ObjectId;
  /** 富文本正文（HTML），占位符已在发送时替换完成 */
  content: string;
  /** 实际交给 SMTP 的追踪版 HTML；敏感字段，不对 API 输出 */
  deliveryContent?: string;
  /** 纯文本正文，用于文本邮件客户端 / 预览 */
  contentText: string;
  /** 发送前的原始正文（保留 {{placeholder}}），便于「重新发送」时回填编辑器 */
  template: string;
  /** 仅在首次创建时确认与同项目 LetterTemplate 原文一致的归因快照；重发不继承。 */
  templateId?: Types.ObjectId;
  templateNameSnapshot?: string;
  /** 原始模板 [subject, content] 的 JSON 编码的 SHA-256，不随模板修改而变化。 */
  templateContentHash?: string;
  /** 状态：draft / sent / opened / failed 及 V2.1 队列状态 */
  status: LetterStatus;
  /** 发送通道：mock 模拟 / smtp 真实 */
  channel: MailChannel;
  /** 实际发送时间 */
  sentAt?: Date;
  /** 邮件服务器返回的 messageId */
  messageId?: string;
  requestKey?: string;
  threadId?: string;
  inReplyTo?: string;
  references: string[];
  scheduledAt?: Date;
  nextAttemptAt?: Date;
  claimedAt?: Date;
  attempts: number;
  needsReview: boolean;
  markAsDeveloped: boolean;
  effectsPending: boolean;
  tracking?: {
    prepared: boolean;
    enabled: boolean;
    openTokenHash?: string;
    openedAt?: Date;
    openCount: number;
    lastOpenedAt?: Date;
    clickedAt?: Date;
    clickCount: number;
    lastClickedAt?: Date;
    links: {
      tokenHash: string;
      originalUrl: string;
      clickedAt?: Date;
      clickCount: number;
      lastClickedAt?: Date;
    }[];
  };
  history: { at: Date; status: string; error?: string }[];
  /** 发送失败原因 */
  error?: string;
  /** 发送人 */
  sentBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type DevelopmentLetterDocument = HydratedDocument<IDevelopmentLetter>;
export type DevelopmentLetterModel = Model<IDevelopmentLetter>;

const DevelopmentLetterSchema = new Schema<IDevelopmentLetter>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, '开发信必须关联一个客户'],
      index: true,
    },
    recipientName: { type: String, trim: true, default: '', maxlength: 120 },
    recipientEmail: {
      type: String,
      trim: true,
      lowercase: true,
      required: [true, '收件人邮箱为必填项'],
      maxlength: 200,
      validate: {
        validator: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
        message: '收件人邮箱格式不正确',
      },
      index: true,
    },
    subject: {
      type: String,
      trim: true,
      required: [true, '邮件主题为必填项'],
      maxlength: [300, '邮件主题不能超过 300 个字符'],
    },
    content: {
      type: String,
      required: [true, '开发信正文不能为空'],
      maxlength: [100000, '开发信正文过长'],
    },
    senderAddress: { type: String, trim: true, maxlength: 300 },
    mailAccountId: { type: Schema.Types.ObjectId, ref: 'UserMailAccount', index: true },
    deliveryContent: { type: String, select: false, maxlength: 120000 },
    contentText: { type: String, default: '' },
    template: { type: String, default: '' },
    templateId: { type: Schema.Types.ObjectId, ref: 'LetterTemplate', immutable: true },
    templateNameSnapshot: { type: String, maxlength: 120, immutable: true },
    templateContentHash: { type: String, match: /^[a-f0-9]{64}$/, immutable: true },
    status: {
      type: String,
      enum: { values: LETTER_STATUS, message: '开发信状态取值非法' },
      default: 'sent',
      index: true,
    },
    channel: {
      type: String,
      enum: { values: MAIL_CHANNEL, message: '发送通道取值非法' },
      default: 'mock',
    },
    sentAt: { type: Date },
    messageId: { type: String, trim: true },
    requestKey: { type: String },
    threadId: { type: String, index: true },
    inReplyTo: String,
    references: { type: [String], default: [] },
    scheduledAt: Date,
    nextAttemptAt: Date,
    claimedAt: Date,
    attempts: { type: Number, default: 0 },
    needsReview: { type: Boolean, default: false },
    markAsDeveloped: { type: Boolean, default: true },
    effectsPending: { type: Boolean, default: false },
    tracking: {
      prepared: { type: Boolean, default: false },
      enabled: { type: Boolean, default: false },
      openTokenHash: { type: String, select: false },
      openedAt: Date,
      openCount: { type: Number, default: 0, min: 0 },
      lastOpenedAt: Date,
      clickedAt: Date,
      clickCount: { type: Number, default: 0, min: 0 },
      lastClickedAt: Date,
      links: {
        type: [{
          tokenHash: { type: String, required: true, select: false },
          originalUrl: { type: String, required: true, maxlength: 4000 },
          clickedAt: Date,
          clickCount: { type: Number, default: 0, min: 0 },
          lastClickedAt: Date,
        }],
        default: [],
      },
    },
    history: { type: [{ at: Date, status: String, error: String }], default: [] },
    error: { type: String, trim: true, maxlength: 2000 },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

// 客户详情页按时间倒序拉取历史
DevelopmentLetterSchema.index({ projectId: 1, customerId: 1, sentAt: -1 });
DevelopmentLetterSchema.index({ projectId: 1, status: 1, createdAt: -1 });
DevelopmentLetterSchema.index(
  { projectId: 1, requestKey: 1 },
  { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } },
);
DevelopmentLetterSchema.index({ projectId: 1, status: 1, nextAttemptAt: 1 });
// Tracking endpoint 只做 token hash 单列索引查找，不扫描邮件内容。
DevelopmentLetterSchema.index({ 'tracking.openTokenHash': 1 }, { unique: true, sparse: true });
DevelopmentLetterSchema.index({ 'tracking.links.tokenHash': 1 }, { unique: true, sparse: true });

export const DevelopmentLetter = model<IDevelopmentLetter, DevelopmentLetterModel>(
  'DevelopmentLetter',
  DevelopmentLetterSchema,
);

export default DevelopmentLetter;
