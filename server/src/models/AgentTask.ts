import { Schema, model, Types, type HydratedDocument } from 'mongoose';
export const taskStepKeys = ['locate_customer', 'analyze_customer', 'save_draft', 'verify_draft'] as const;
export type TaskStep = typeof taskStepKeys[number];
export type TaskStatus = 'queued'|'running'|'waiting_input'|'paused'|'awaiting_review'|'completed'|'failed'|'cancelled';
export interface IAgentTask {
 projectId: Types.ObjectId; userId: Types.ObjectId; sessionId: Types.ObjectId; actorRole: 'admin'|'user';
 requestKey: string; goal: string; customerId?: Types.ObjectId; query?: string;
 candidates: {id: string; name: string; company?: string}[];
 analysisId?: Types.ObjectId; draftId?: Types.ObjectId; sentLetterId?: Types.ObjectId;
 status: TaskStatus; version: number; attempts: number; completedSteps: TaskStep[]; currentStep?: TaskStep;
 events: {at: Date; message: string; step?: TaskStep}[];
 error?: {code: string; message: string; retryable: boolean};
 leaseToken?: string; leaseUntil?: Date; createdAt: Date; updatedAt: Date;
}
const schema = new Schema<IAgentTask>({
 projectId: {type: Schema.Types.ObjectId, required: true}, userId: {type: Schema.Types.ObjectId, required: true},
 sessionId: {type: Schema.Types.ObjectId, required: true}, actorRole: {type: String, enum: ['admin','user'], required: true},
 requestKey: {type: String, required: true, maxlength: 128}, goal: {type: String, required: true, maxlength: 8000},
 customerId: Schema.Types.ObjectId, query: {type: String, maxlength: 120},
 candidates: [{_id: false, id: String, name: String, company: String}],
 analysisId: Schema.Types.ObjectId, draftId: Schema.Types.ObjectId, sentLetterId: Schema.Types.ObjectId,
 status: {type: String, required: true, enum: ['queued','running','waiting_input','paused','awaiting_review','completed','failed','cancelled']},
 version: {type: Number, default: 0}, attempts: {type: Number, default: 0},
 completedSteps: [{type: String, enum: taskStepKeys}], currentStep: {type: String, enum: taskStepKeys},
 events: [{_id: false, at: Date, message: String, step: {type: String, enum: taskStepKeys}}],
 error: {_id: false, code: String, message: String, retryable: Boolean}, leaseToken: String, leaseUntil: Date,
}, {timestamps: true, versionKey: false});
schema.index({projectId: 1, userId: 1, requestKey: 1}, {unique: true});
schema.index({status: 1, leaseUntil: 1, createdAt: 1});
schema.index({projectId: 1, userId: 1, createdAt: -1});
export type AgentTaskDocument = HydratedDocument<IAgentTask>;
export const AgentTask = model<IAgentTask>('AgentTask', schema);
