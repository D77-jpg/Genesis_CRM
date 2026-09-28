import { Schema, model, type HydratedDocument } from 'mongoose';

export interface IAgentAiSettings {
  key: string;
  provider: 'mock' | 'openai';
  modelName: string;
  baseUrl: string;
  credentialCiphertext?: string;
  credentialIv?: string;
  credentialTag?: string;
  updatedBy: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type AgentAiSettingsDocument = HydratedDocument<IAgentAiSettings>;

const schema = new Schema<IAgentAiSettings>({
  key: { type: String, required: true, unique: true, immutable: true },
  provider: { type: String, enum: ['mock', 'openai'], required: true },
  modelName: { type: String, required: true, maxlength: 120 },
  baseUrl: { type: String, required: true, maxlength: 500 },
  credentialCiphertext: { type: String, select: false },
  credentialIv: { type: String, select: false },
  credentialTag: { type: String, select: false },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });

export const AgentAiSettings = model<IAgentAiSettings>('AgentAiSettings', schema);
