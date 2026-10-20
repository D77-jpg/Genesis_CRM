import { Schema, model, Types, type HydratedDocument } from 'mongoose';
export const taskStepKeys = ['locate_customer', 'research_customer', 'analyze_customer', 'save_draft', 'verify_draft'] as const;
export type TaskStep = typeof taskStepKeys[number];
export type TaskStatus = 'queued'|'running'|'waiting_input'|'paused'|'awaiting_review'|'completed'|'failed'|'cancelled';
export interface WorkflowRecord {key:string;epoch:number;inputHash:string;state:'running'|'completed'|'failed';startedAt:string;durationMs?:number;completedAt?:string;attempts:number;reused:number;payload?:unknown;tool?:string;error?:string}
export interface IAgentTask {
 projectId: Types.ObjectId; userId: Types.ObjectId; sessionId: Types.ObjectId; actorRole: 'admin'|'user';
 kind:'first_outreach'|'inquiry_reply'|'followup_review'|'quotation_explanation'|'sample_reply';sourceMailId?:Types.ObjectId;sourceDueAt?:Date;automationRuleId?:Types.ObjectId;ruleVersion?:number;mailAnalysisId?:Types.ObjectId;
 workflowEpoch:number; workflowCalls:number; workflowActiveMs:number; workflowStamp?:string; workflowRecords:WorkflowRecord[]; previousArtifacts:{analysisId?:string;mailAnalysisId?:string;draftId?:string;at:string}[];
 parentBatchId?:Types.ObjectId; skillVersion?:number; knowledgeIds:Types.ObjectId[]; tokenBudget:number; budgetCharged:number; contextSummary?:string;
 requestSignature?:string; requestKey: string; goal: string; customerId?: Types.ObjectId; query?: string;
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
 kind:{type:String,enum:['first_outreach','inquiry_reply','followup_review','quotation_explanation','sample_reply'],default:'first_outreach'},sourceMailId:Schema.Types.ObjectId,sourceDueAt:Date,automationRuleId:Schema.Types.ObjectId,ruleVersion:Number,mailAnalysisId:Schema.Types.ObjectId,
 workflowEpoch:{type:Number,default:0},workflowCalls:{type:Number,default:0},workflowActiveMs:{type:Number,default:0},workflowStamp:String,workflowRecords:[Schema.Types.Mixed],previousArtifacts:[Schema.Types.Mixed],
 parentBatchId:Schema.Types.ObjectId,skillVersion:{type:Number,default:2},knowledgeIds:[Schema.Types.ObjectId],tokenBudget:{type:Number,default:60000},budgetCharged:{type:Number,default:0},contextSummary:{type:String,maxlength:2000},
 requestSignature:String, requestKey: {type: String, required: true, maxlength: 128}, goal: {type: String, required: true, maxlength: 8000},
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
