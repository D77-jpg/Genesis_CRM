/**
 * Quotation 模型（V2 报价管理）
 * ------------------------------------------------------------------
 * 一份报价单挂在某个客户下（N:1），删除客户时级联清理其报价单。
 *
 * 金额可信性：
 *   - items[].amount 与 totalAmount 一律由后端计算，绝不信任前端传入的金额；
 *   - 计算规则集中在 computeQuotationTotals / roundMoney，模型 pre('validate') 钩子
 *     与服务层（findOneAndUpdate 路径不触发钩子）共用同一套逻辑，保证口径一致。
 *
 * 报价编号 quotationNo 唯一（不区分大小写：入库前统一 trim + 转大写），
 * 由服务层生成或校验，重复时返回 409。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import { QUOTATION_CURRENCY, QUOTATION_STATUS, type QuotationCurrency, type QuotationStatus } from '../constants';

/** 报价明细行（嵌入子文档，不含独立 _id） */
export interface IQuotationItem {
  /** 产品名称（必填） */
  productName: string;
  /** 产品型号 / 规格（可空） */
  model?: string;
  /** 数量 */
  quantity: number;
  /** 单价 */
  unitPrice: number;
  /** 行金额 = quantity × unitPrice（后端计算，前端传入值一律忽略） */
  amount: number;
}

export interface IQuotationProposalSource {
  kind: 'lead' | 'knowledge' | 'customer' | 'quotation';
  referenceId: string;
  title?: string;
}

export interface IQuotationProposalTrace {
  proposalId: string;
  generatedBy: 'autoforce_ai';
  model?: string;
  sources: IQuotationProposalSource[];
}

export interface IQuotation {
  projectId: Types.ObjectId;
  /** 报价单编号（唯一） */
  quotationNo: string;
  /** 所属客户 */
  customerId: Types.ObjectId;
  /** 报价标题 */
  title: string;
  /** 报价明细（至少一行） */
  items: IQuotationItem[];
  /** 币种 */
  currency: QuotationCurrency;
  /** 报价总金额（后端计算：各行金额之和） */
  totalAmount: number;
  /** 报价有效期（可空） */
  validityDate?: Date;
  /** 付款方式（可空，自由文本，如 "30% deposit, 70% before shipment"） */
  paymentTerms?: string;
  /** 交期（可空，自由文本，如 "20-25 days"） */
  leadTime?: string;
  /** 最低起订量（可空，自由文本，如 "100 pcs"） */
  moq?: string;
  /** 备注（可空） */
  notes?: string;
  /** 状态：draft / sent / negotiating / accepted / rejected / expired */
  status: QuotationStatus;
  /** 内容版本；每次修改递增，供稳定 PDF / ETag 使用 */
  version: number;
  /** AutoForceAI 建议来源审计（不参与金额计算） */
  proposalTrace?: IQuotationProposalTrace;
  /** 集成写入的内部幂等标识，不对外返回 */
  integrationIdempotencyKey?: string;
  /** 创建人（引用 User）；单用户环境下可留空 */
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type QuotationDocument = HydratedDocument<IQuotation>;
export type QuotationModel = Model<IQuotation>;

/** 金额四舍五入到分（两位小数），消除浮点误差累积 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 参与金额计算所需的最小明细结构（quantity / unitPrice） */
interface AmountableItem {
  quantity: number;
  unitPrice: number;
}

/**
 * 由明细行计算「每行金额 + 报价总金额」。
 * 后端权威计算入口：无论前端是否传 amount / totalAmount，都以此结果为准。
 */
export function computeQuotationTotals<T extends AmountableItem>(
  items: T[],
): { items: (T & { amount: number })[]; totalAmount: number } {
  const computed = items.map((item) => ({
    ...item,
    amount: roundMoney((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)),
  }));
  const totalAmount = roundMoney(computed.reduce((sum, it) => sum + it.amount, 0));
  return { items: computed, totalAmount };
}

const QuotationItemSchema = new Schema<IQuotationItem>(
  {
    productName: {
      type: String,
      required: [true, '产品名称为必填项'],
      trim: true,
      maxlength: [200, '产品名称不能超过 200 个字符'],
    },
    model: { type: String, trim: true, maxlength: 200 },
    quantity: {
      type: Number,
      required: [true, '数量为必填项'],
      min: [0, '数量不能为负数'],
    },
    unitPrice: {
      type: Number,
      required: [true, '单价为必填项'],
      min: [0, '单价不能为负数'],
    },
    // amount 由后端计算，这里只声明字段与默认值
    amount: { type: Number, default: 0, min: [0, '金额不能为负数'] },
  },
  { _id: false },
);

const ProposalSourceSchema = new Schema<IQuotationProposalSource>(
  {
    kind: { type: String, enum: ['lead', 'knowledge', 'customer', 'quotation'], required: true },
    referenceId: { type: String, required: true, trim: true, maxlength: 200 },
    title: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const ProposalTraceSchema = new Schema<IQuotationProposalTrace>(
  {
    proposalId: { type: String, required: true, trim: true, maxlength: 128 },
    generatedBy: { type: String, enum: ['autoforce_ai'], required: true },
    model: { type: String, trim: true, maxlength: 120 },
    sources: {
      type: [ProposalSourceSchema],
      required: true,
      validate: {
        validator: (v: IQuotationProposalSource[]) => Array.isArray(v) && v.length >= 1 && v.length <= 50,
        message: '建议来源必须为 1-50 条',
      },
    },
  },
  { _id: false },
);

const QuotationSchema = new Schema<IQuotation>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    quotationNo: {
      type: String,
      required: [true, '报价单编号为必填项'],
      trim: true,
      uppercase: true,
      maxlength: [60, '报价单编号不能超过 60 个字符'],
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, '报价单必须关联一个客户'],
      index: true,
    },
    title: {
      type: String,
      required: [true, '报价标题为必填项'],
      trim: true,
      maxlength: [200, '报价标题不能超过 200 个字符'],
    },
    items: {
      type: [QuotationItemSchema],
      required: [true, '报价明细不能为空'],
      validate: {
        validator: (v: IQuotationItem[]) => Array.isArray(v) && v.length > 0,
        message: '报价明细至少需要一行产品',
      },
    },
    currency: {
      type: String,
      enum: { values: QUOTATION_CURRENCY, message: '报价币种取值非法' },
      default: 'USD',
    },
    // totalAmount 由后端计算（pre-validate 钩子），这里只声明字段
    totalAmount: { type: Number, default: 0, min: [0, '报价总金额不能为负数'] },
    validityDate: { type: Date },
    paymentTerms: { type: String, trim: true, maxlength: 300 },
    leadTime: { type: String, trim: true, maxlength: 200 },
    moq: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: { values: QUOTATION_STATUS, message: '报价单状态取值非法' },
      default: 'draft',
      index: true,
    },
    version: { type: Number, default: 1, min: 1 },
    proposalTrace: { type: ProposalTraceSchema },
    integrationIdempotencyKey: { type: String, maxlength: 64, select: false },
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
        return ret;
      },
    },
  },
);

// 保存 / 校验前重算金额，保证任何写入路径（create / save）的 amount、totalAmount 都由后端说了算
QuotationSchema.pre('validate', function recalcAmounts(next) {
  let total = 0;
  for (const item of this.items ?? []) {
    const amount = roundMoney((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0));
    item.amount = amount;
    total += amount;
  }
  this.totalAmount = roundMoney(total);
  next();
});

// 报价编号唯一（入库前已 trim + uppercase，故普通唯一索引即可防重）
QuotationSchema.index({ projectId: 1, quotationNo: 1 }, { unique: true });
// 客户详情页按创建时间倒序拉取报价
QuotationSchema.index({ projectId: 1, customerId: 1, createdAt: -1 });
// 顶层列表按状态 + 时间筛选
QuotationSchema.index({ projectId: 1, status: 1, createdAt: -1 });
// 写请求崩溃后接管时仍可找回首次创建的报价，杜绝重复草稿。
QuotationSchema.index(
  { projectId: 1, integrationIdempotencyKey: 1 },
  { unique: true, partialFilterExpression: { integrationIdempotencyKey: { $type: 'string' } } },
);

export const Quotation = model<IQuotation, QuotationModel>('Quotation', QuotationSchema);

export default Quotation;
