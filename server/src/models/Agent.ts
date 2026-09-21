import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export type AgentContextType = 'global' | 'customer' | 'mail';
export type AgentProviderName = 'mock' | 'openai';

export interface IAgentSession {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  context: { type: AgentContextType; resourceId?: string; direction?: 'inbound' | 'outbound' };
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentMessage {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  status: 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentRun {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  sessionId?: Types.ObjectId;
  workflowId?: Types.ObjectId;
  provider: AgentProviderName;
  model: string;
  status: 'running' | 'completed' | 'failed';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCallCount: number;
  durationMs: number;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentAction {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  sessionId?: Types.ObjectId;
  runId?: Types.ObjectId;
  workflowId?: Types.ObjectId;
  toolName: string;
  riskLevel: 'read' | 'write' | 'high';
  arguments: Record<string, unknown>;
  requiresApproval: boolean;
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  executionStatus: 'pending' | 'succeeded' | 'failed' | 'rejected';
  resultSummary?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  executedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const contextSchema = new Schema(
  {
    type: { type: String, enum: ['global', 'customer', 'mail'], required: true, default: 'global' },
    resourceId: { type: String, maxlength: 128 },
    direction: { type: String, enum: ['inbound', 'outbound'] },
  },
  { _id: false },
);

const agentSessionSchema = new Schema<IAgentSession>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    context: { type: contextSchema, required: true, default: () => ({ type: 'global' }) },
    status: { type: String, enum: ['active', 'archived'], default: 'active', required: true },
  },
  { timestamps: true, versionKey: false },
);
agentSessionSchema.index({ projectId: 1, userId: 1, status: 1, updatedAt: -1 });

const agentMessageSchema = new Schema<IAgentMessage>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AgentSession', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 20000 },
    status: { type: String, enum: ['completed', 'failed'], default: 'completed', required: true },
  },
  { timestamps: true, versionKey: false },
);
agentMessageSchema.index({ projectId: 1, userId: 1, sessionId: 1, createdAt: 1 });

const agentRunSchema = new Schema<IAgentRun>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AgentSession' },
    workflowId: { type: Schema.Types.ObjectId, ref: 'AgentCustomerPreview' },
    provider: { type: String, enum: ['mock', 'openai'], required: true },
    model: { type: String, required: true, maxlength: 100 },
    status: { type: String, enum: ['running', 'completed', 'failed'], required: true },
    inputTokens: { type: Number, default: 0, min: 0 },
    outputTokens: { type: Number, default: 0, min: 0 },
    totalTokens: { type: Number, default: 0, min: 0 },
    toolCallCount: { type: Number, default: 0, min: 0 },
    durationMs: { type: Number, default: 0, min: 0 },
    errorCode: { type: String, maxlength: 80 },
  },
  { timestamps: true, versionKey: false },
);
agentRunSchema.index({ projectId: 1, userId: 1, createdAt: -1 });

const agentActionSchema = new Schema<IAgentAction>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AgentSession' },
    runId: { type: Schema.Types.ObjectId, ref: 'AgentRun' },
    workflowId: { type: Schema.Types.ObjectId, ref: 'AgentCustomerPreview' },
    toolName: { type: String, required: true, maxlength: 100 },
    riskLevel: { type: String, enum: ['read', 'write', 'high'], required: true },
    arguments: { type: Schema.Types.Mixed, required: true, default: {} },
    requiresApproval: { type: Boolean, required: true, default: false },
    approvalStatus: { type: String, enum: ['not_required', 'pending', 'approved', 'rejected'], required: true },
    executionStatus: { type: String, enum: ['pending', 'succeeded', 'failed', 'rejected'], required: true },
    resultSummary: { type: String, maxlength: 300 },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    executedAt: Date,
  },
  { timestamps: true, versionKey: false },
);
agentActionSchema.index({ projectId: 1, userId: 1, createdAt: -1 });
agentActionSchema.index({ projectId: 1, userId: 1, approvalStatus: 1, createdAt: -1 });

export type AgentSessionDocument = HydratedDocument<IAgentSession>;
export type AgentMessageDocument = HydratedDocument<IAgentMessage>;
export type AgentRunDocument = HydratedDocument<IAgentRun>;
export type AgentActionDocument = HydratedDocument<IAgentAction>;

export const AgentSession = model<IAgentSession>('AgentSession', agentSessionSchema);
export const AgentMessage = model<IAgentMessage>('AgentMessage', agentMessageSchema);
export const AgentRun = model<IAgentRun>('AgentRun', agentRunSchema);
export const AgentAction = model<IAgentAction>('AgentAction', agentActionSchema);
