import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import type { AgentProviderName } from './Agent';

export interface AgentEvalCaseResult {
  caseId: string;
  name: string;
  category: 'extraction' | 'safety' | 'injection';
  passed: boolean;
  score: number;
  details: string;
  durationMs: number;
}

export interface IAgentEvalRun {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  provider: AgentProviderName;
  model: string;
  datasetVersion: string;
  status: 'running' | 'completed' | 'failed';
  totalCases: number;
  passedCases: number;
  score: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  cases: AgentEvalCaseResult[];
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const caseSchema = new Schema<AgentEvalCaseResult>(
  {
    caseId: { type: String, required: true, maxlength: 80 },
    name: { type: String, required: true, maxlength: 160 },
    category: { type: String, enum: ['extraction', 'safety', 'injection'], required: true },
    passed: { type: Boolean, required: true },
    score: { type: Number, required: true, min: 0, max: 1 },
    details: { type: String, required: true, maxlength: 500 },
    durationMs: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const agentEvalRunSchema = new Schema<IAgentEvalRun>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['mock', 'openai'], required: true },
    model: { type: String, required: true, maxlength: 100 },
    datasetVersion: { type: String, required: true, maxlength: 40 },
    status: { type: String, enum: ['running', 'completed', 'failed'], required: true },
    totalCases: { type: Number, default: 0, min: 0 },
    passedCases: { type: Number, default: 0, min: 0 },
    score: { type: Number, default: 0, min: 0, max: 1 },
    inputTokens: { type: Number, default: 0, min: 0 },
    outputTokens: { type: Number, default: 0, min: 0 },
    totalTokens: { type: Number, default: 0, min: 0 },
    estimatedCostUsd: { type: Number, default: 0, min: 0 },
    durationMs: { type: Number, default: 0, min: 0 },
    cases: { type: [caseSchema], default: [] },
    errorCode: { type: String, maxlength: 80 },
  },
  { timestamps: true, versionKey: false },
);
agentEvalRunSchema.index({ projectId: 1, createdAt: -1 });

export type AgentEvalRunDocument = HydratedDocument<IAgentEvalRun>;
export const AgentEvalRun = model<IAgentEvalRun>('AgentEvalRun', agentEvalRunSchema);
