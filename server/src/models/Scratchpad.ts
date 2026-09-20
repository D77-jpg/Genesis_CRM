/**
 * Scratchpad —— 业务员个人随手记
 * ------------------------------------------------------------------
 * 每名用户在每个项目中只有一张草稿纸。它不是客户备注或跟进记录，
 * 因而不会进入 Timeline，也不会向管理员开放他人的内容。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export const SCRATCHPAD_MAX_LENGTH = 50_000;

export interface IScratchpad {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  content: string;
  /** 客户端保存时携带旧版本，避免多设备编辑发生静默覆盖。 */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ScratchpadDocument = HydratedDocument<IScratchpad>;
export type ScratchpadModel = Model<IScratchpad>;

const ScratchpadSchema = new Schema<IScratchpad>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // 不 trim：草稿纸必须原样保留换行和用户主动输入的空格。
    content: { type: String, default: '', maxlength: SCRATCHPAD_MAX_LENGTH },
    version: { type: Number, default: 1, min: 1, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ScratchpadSchema.index({ projectId: 1, userId: 1 }, { unique: true });

export const Scratchpad = model<IScratchpad, ScratchpadModel>('Scratchpad', ScratchpadSchema);

export default Scratchpad;
