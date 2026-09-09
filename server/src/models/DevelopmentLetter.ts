/**
 * DevelopmentLetter 模型
 * ------------------------------------------------------------------
 * 每一封发送给客户的开发信都会落一条记录，
 * 与 Customer 是 N:1 关系；删除客户时级联清理其开发信。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import { LETTER_STATUS, MAIL_CHANNEL, type LetterStatus, type MailChannel } from '../constants';

export interface IDevelopmentLetter {
  /** 所属客户 */
  customerId: Types.ObjectId;
  /** 收件人姓名（发送时的快照，避免客户改名后历史失真） */
  recipientName: string;
  /** 收件人邮箱（快照） */
  recipientEmail: string;
  /** 邮件主题 */
  subject: string;
  /** 富文本正文（HTML），占位符已在发送时替换完成 */
  content: string;
  /** 纯文本正文，用于文本邮件客户端 / 预览 */
  contentText: string;
  /** 发送前的原始模板（保留 {{placeholder}}），便于「重新发送」时回填编辑器 */
  template: string;
  /** 状态：draft 草稿 / sent 已发送 / failed 发送失败 */
  status: LetterStatus;
  /** 发送通道：mock 模拟 / smtp 真实 */
  channel: MailChannel;
  /** 实际发送时间 */
  sentAt?: Date;
  /** 邮件服务器返回的 messageId */
  messageId?: string;
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
    contentText: { type: String, default: '' },
    template: { type: String, default: '' },
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
DevelopmentLetterSchema.index({ customerId: 1, sentAt: -1 });
DevelopmentLetterSchema.index({ status: 1, createdAt: -1 });

export const DevelopmentLetter = model<IDevelopmentLetter, DevelopmentLetterModel>(
  'DevelopmentLetter',
  DevelopmentLetterSchema,
);

export default DevelopmentLetter;
