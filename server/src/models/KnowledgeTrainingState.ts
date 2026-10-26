import { Schema, model, Types, type HydratedDocument } from 'mongoose';

/**
 * 项目级自动校准开关。默认关闭：新的行为必须由管理员明确启用。
 * 审核样本仍会自动沉淀，但未启用时不会影响任何检索结果。
 */
export interface IKnowledgeTrainingState {
  projectId: Types.ObjectId;
  enabled: boolean;
  updatedBy?: Types.ObjectId;
  updatedAt: Date;
  createdAt: Date;
}

const schema = new Schema<IKnowledgeTrainingState>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
  enabled: { type: Boolean, default: false },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

export type KnowledgeTrainingStateDocument = HydratedDocument<IKnowledgeTrainingState>;
export const KnowledgeTrainingState = model<IKnowledgeTrainingState>('KnowledgeTrainingState', schema);
export default KnowledgeTrainingState;
