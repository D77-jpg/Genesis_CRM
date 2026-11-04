import './tenant-setup';
import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/** 一个可复用的 AI 服务商连接；在组织内共享，由组织管理员维护。 */
export type AgentAiProviderKind = 'openai' | 'mock';

export interface IAgentAiProvider {
  name: string;
  kind: AgentAiProviderKind;
  modelName: string;
  baseUrl: string;
  credentialCiphertext?: string;
  credentialIv?: string;
  credentialTag?: string;
  lastTestedAt?: Date;
  lastTestStatus?: 'ok' | 'failed';
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type AgentAiProviderDocument = HydratedDocument<IAgentAiProvider>;

const schema = new Schema<IAgentAiProvider>({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  kind: { type: String, enum: ['openai', 'mock'], required: true, default: 'openai' },
  modelName: { type: String, required: true, trim: true, maxlength: 120 },
  baseUrl: { type: String, trim: true, maxlength: 500, default: '' },
  credentialCiphertext: { type: String, select: false },
  credentialIv: { type: String, select: false },
  credentialTag: { type: String, select: false },
  lastTestedAt: { type: Date },
  lastTestStatus: { type: String, enum: ['ok', 'failed'] },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });

schema.index({ organizationId: 1, name: 1 }, { unique: true });

export const AgentAiProvider = model<IAgentAiProvider>('AgentAiProvider', schema);
