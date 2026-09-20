/**
 * Customer 模型
 * ------------------------------------------------------------------
 * 客户主档。字段覆盖 Excel 导入模板：
 * 姓名 / 公司 / 邮箱 / 手机号 / 职位 / 行业 / 地址 / 备注 / 状态
 * 另外扩展了官网、国家、客户等级、标签等外贸场景常用字段。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import {
  CUSTOMER_PRIORITY,
  CUSTOMER_SOURCE,
  CUSTOMER_STATUS,
  type CustomerPriority,
  type CustomerSource,
  type CustomerStatus,
} from '../constants';

export interface ICustomer {
  /** 所属项目空间 */
  projectId: Types.ObjectId;
  /** 姓名 / 联系人（必填） */
  name: string;
  /** 公司名称 */
  company?: string;
  /** 邮箱 */
  email?: string;
  /** 手机号 / 电话 */
  phone?: string;
  /** 职位 */
  title?: string;
  /** 行业 */
  industry?: string;
  /** 地址 */
  address?: string;
  /** 国家 / 地区 */
  country?: string;
  /** 官网 */
  website?: string;
  /** 客户等级，例如 A / B / C */
  grade?: string;
  /** 备注 */
  notes?: string;
  /* ---------- 联系渠道（Email / Phone 之外） ---------- */
  /** WhatsApp（可存手机号或完整链接） */
  whatsapp?: string;
  /** Skype 账号 */
  skype?: string;
  /** LinkedIn（完整 URL 或用户名） */
  linkedin?: string;
  /** Facebook（完整 URL 或用户名） */
  facebook?: string;
  /** Instagram（完整 URL 或用户名） */
  instagram?: string;
  /* ---------- 客户产品 / 需求信息 ---------- */
  /** 感兴趣产品 */
  interestedProducts?: string;
  /** 产品型号 */
  productModel?: string;
  /** 产品分类 */
  productCategory?: string;
  /** 预计采购数量 */
  expectedQuantity?: string;
  /** 目标价格 */
  targetPrice?: string;
  /** 客户可接受 / 关注的 MOQ */
  moq?: string;
  /** 客户需求备注 */
  requirementNotes?: string;
  /** 销售流程状态（8 段，见 constants.CUSTOMER_STATUS） */
  status: CustomerStatus;
  /** 数据来源：manual 手工录入 / excel 导入 / seed 初始化 */
  source: CustomerSource;
  /** 业务来源（客户从哪个渠道来），自由字符串，与 source 溯源字段区分 */
  leadSource?: string;
  /** 跟进优先级：high / medium / low（与 grade 客户等级是不同维度，新客户默认 medium） */
  priority?: CustomerPriority;
  /** 自定义标签 */
  tags: string[];
  /** 已发送开发信数量（反范式计数，随开发信增删同步维护） */
  letterCount: number;
  /** Idempotent queue side effects; internal, excluded from customer DTOs. */
  mailEffectIds?: Types.ObjectId[];
  /** 最近一次发送开发信的时间 */
  lastContactAt?: Date;
  /** 负责人（引用 User）；单用户环境下可留空 */
  ownerId?: Types.ObjectId;
  /** 下一次跟进时间 */
  nextFollowUpAt?: Date;
  /** 创建人 */
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICustomerMethods {
  /** 是否已离开「待开发」状态（即已进入销售流程） */
  isDeveloped(): boolean;
}

export type CustomerDocument = HydratedDocument<ICustomer, ICustomerMethods>;
export type CustomerModel = Model<ICustomer, {}, ICustomerMethods>;

const CustomerSchema = new Schema<ICustomer, CustomerModel, ICustomerMethods>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: {
      type: String,
      required: [true, '客户姓名为必填项'],
      trim: true,
      maxlength: [120, '客户姓名不能超过 120 个字符'],
      index: true,
    },
    company: { type: String, trim: true, maxlength: 200, index: true },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
      // 允许为空（有些客户只有电话），非空时做格式校验
      // 索引在文件末尾用 partial + unique 显式声明，这里不能再写 index: true（会重复）
      validate: {
        validator: (v?: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
        message: '邮箱格式不正确',
      },
    },
    phone: { type: String, trim: true, maxlength: 60 },
    title: { type: String, trim: true, maxlength: 120 },
    industry: { type: String, trim: true, maxlength: 120, index: true },
    address: { type: String, trim: true, maxlength: 500 },
    country: { type: String, trim: true, maxlength: 120 },
    website: { type: String, trim: true, maxlength: 300 },
    grade: { type: String, trim: true, maxlength: 20 },
    notes: { type: String, trim: true, maxlength: 5000 },
    // 联系渠道（Email / Phone 之外）
    whatsapp: { type: String, trim: true, maxlength: 200 },
    skype: { type: String, trim: true, maxlength: 200 },
    linkedin: { type: String, trim: true, maxlength: 300 },
    facebook: { type: String, trim: true, maxlength: 300 },
    instagram: { type: String, trim: true, maxlength: 300 },
    // 客户产品 / 需求信息
    interestedProducts: { type: String, trim: true, maxlength: 500 },
    productModel: { type: String, trim: true, maxlength: 200 },
    productCategory: { type: String, trim: true, maxlength: 200 },
    expectedQuantity: { type: String, trim: true, maxlength: 120 },
    targetPrice: { type: String, trim: true, maxlength: 120 },
    moq: { type: String, trim: true, maxlength: 120 },
    requirementNotes: { type: String, trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: { values: CUSTOMER_STATUS, message: '客户状态取值非法' },
      default: 'pending',
      index: true,
    },
    source: {
      type: String,
      enum: { values: CUSTOMER_SOURCE, message: '客户来源取值非法' },
      default: 'manual',
    },
    // 业务来源：自由字符串（兼容历史自定义值），不设 enum
    leadSource: { type: String, trim: true, maxlength: 120 },
    priority: {
      type: String,
      enum: { values: CUSTOMER_PRIORITY, message: '客户优先级取值非法' },
      default: 'medium',
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 30,
        message: '标签数量不能超过 30 个',
      },
    },
    letterCount: { type: Number, default: 0, min: 0 },
    mailEffectIds: { type: [Schema.Types.ObjectId], select: false, default: undefined },
    lastContactAt: { type: Date },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    nextFollowUpAt: { type: Date, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.mailEffectIds;
        return ret;
      },
    },
  },
);

// 组合索引：状态 + 更新时间倒序（列表页最常见的查询）
CustomerSchema.index({ projectId: 1, status: 1, updatedAt: -1 });
// 全文索引：姓名 / 公司 / 邮箱 / 行业，供后端 $text 搜索兜底
CustomerSchema.index({ name: 'text', company: 'text', email: 'text', industry: 'text' });
// 邮箱唯一性：仅在填写了邮箱时生效（sparse + partial），
// 同时承担 email 字段的单列索引职责
CustomerSchema.index(
  { projectId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } },
);

CustomerSchema.methods.isDeveloped = function isDeveloped(this: CustomerDocument): boolean {
  // 语义升级：只要离开「待开发」即视为已开发（兼容旧的 developed 判定）
  return this.status !== 'pending';
};

export const Customer = model<ICustomer, CustomerModel>('Customer', CustomerSchema);
export default Customer;
