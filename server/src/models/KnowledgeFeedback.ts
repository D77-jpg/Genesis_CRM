import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

/**
 * 人工审核留下的可训练样本。
 *
 * 只记录本项目内生成的草稿与人工最终稿，不接入客户私信、个人邮箱或原始
 * 附件。样本用于两件事：
 *  1. 管理员查看真实修改率、拒稿率和问题分布；
 *  2. 自动生成“相似问题优先使用哪些已发布来源”的排序先验。
 *
 * 先验只改候选来源的先后顺序，不新增来源、不放宽授权、不替代人工审核。
 */
export const FEEDBACK_ISSUES = ['missing_source', 'wrong_fact', 'outdated', 'wrong_product', 'unsafe_claim', 'tone', 'other'] as const;
export type FeedbackIssue = typeof FEEDBACK_ISSUES[number];

export interface IKnowledgeFeedback {
  projectId: Types.ObjectId;
  letterId: Types.ObjectId;
  customerId?: Types.ObjectId;
  taskId?: Types.ObjectId;
  taskType: string;
  reviewerId: Types.ObjectId;
  decision: 'approved' | 'rejected';
  /** 业务员当时的请求；没有请求时用草稿主题，空样本不会进入校准。 */
  query: string;
  queryTerms: string[];
  /** 被人工最终稿采用/认可的项目知识 ID；不包含客户约定和报价。 */
  sourceIds: string[];
  aiSubject: string;
  aiBody: string;
  finalSubject: string;
  finalBody: string;
  aiHash: string;
  finalHash: string;
  edited: boolean;
  /** 0 表示未改，1 表示完全不同；用于展示修改幅度，不是模型置信度。 */
  editRatio: number;
  issues: FeedbackIssue[];
  note?: string;
  status: 'included' | 'retracted' | 'excluded';
  split: 'train' | 'validation';
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IKnowledgeFeedback>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  letterId: { type: Schema.Types.ObjectId, ref: 'DevelopmentLetter', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  taskId: { type: Schema.Types.ObjectId, ref: 'AgentTask' },
  taskType: { type: String, required: true, maxlength: 80 },
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  decision: { type: String, enum: ['approved', 'rejected'], required: true },
  query: { type: String, default: '', maxlength: 4000 },
  queryTerms: { type: [String], default: [] },
  sourceIds: { type: [String], default: [] },
  aiSubject: { type: String, default: '', maxlength: 300 },
  aiBody: { type: String, default: '', maxlength: 12000 },
  finalSubject: { type: String, default: '', maxlength: 300 },
  finalBody: { type: String, default: '', maxlength: 12000 },
  aiHash: { type: String, match: /^[a-f0-9]{64}$/ },
  finalHash: { type: String, match: /^[a-f0-9]{64}$/ },
  edited: { type: Boolean, default: false },
  editRatio: { type: Number, default: 0, min: 0, max: 1 },
  issues: { type: [String], enum: FEEDBACK_ISSUES, default: [] },
  note: { type: String, maxlength: 500 },
  status: { type: String, enum: ['included', 'retracted', 'excluded'], default: 'included', index: true },
  split: { type: String, enum: ['train', 'validation'], default: 'train' },
}, { timestamps: true, versionKey: false });
schema.index({ projectId: 1, letterId: 1 }, { unique: true });
schema.index({ projectId: 1, status: 1, decision: 1, createdAt: -1 });

export type KnowledgeFeedbackDocument = HydratedDocument<IKnowledgeFeedback>;
export type KnowledgeFeedbackModel = Model<IKnowledgeFeedback>;
export const KnowledgeFeedback = model<IKnowledgeFeedback>('KnowledgeFeedback', schema);
export default KnowledgeFeedback;
