import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export type AgentAnalysisSourceKind = 'profile' | 'timeline' | 'mail' | 'followup' | 'quotation';

export interface AgentAnalysisSource {
  sourceId: string;
  kind: AgentAnalysisSourceKind;
  recordId: string;
  label: string;
  occurredAt?: Date;
}

export interface AgentAnalysisClaim {
  text: string;
  rationale?: string;
  sourceIds: string[];
}

export interface IAgentCustomerAnalysis {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  customerId: Types.ObjectId;
  requestKey: string;
  sources: AgentAnalysisSource[];
  facts: AgentAnalysisClaim[];
  gaps: AgentAnalysisClaim[];
  recommendations: AgentAnalysisClaim[];
  emailDraft: { subject: string; bodyText: string };
  followUpPlan: {
    method: 'email' | 'whatsapp' | 'phone' | 'chat' | 'other';
    content: string;
    dueAt: Date;
    /** Original verified recommendation rationale; retained when the plan is edited. */
    reason?: string;
    sourceIds: string[];
    manuallyEdited?: boolean;
  };
  emailStatus: 'editable' | 'saving' | 'saved' | 'failed';
  followUpStatus: 'editable' | 'scheduling' | 'scheduled' | 'failed';
  emailConfirmationKey?: string;
  followUpConfirmationKey?: string;
  createdLetterId?: Types.ObjectId;
  scheduledAt?: Date;
  version: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sourceSchema = new Schema<AgentAnalysisSource>({
  sourceId: { type: String, required: true, maxlength: 180 },
  kind: { type: String, enum: ['profile', 'timeline', 'mail', 'followup', 'quotation'], required: true },
  recordId: { type: String, required: true, maxlength: 128 },
  label: { type: String, required: true, maxlength: 240 },
  occurredAt: Date,
}, { _id: false });

const claimSchema = new Schema<AgentAnalysisClaim>({
  text: { type: String, required: true, trim: true, maxlength: 1200 },
  rationale: { type: String, trim: true, maxlength: 1200 },
  sourceIds: { type: [String], required: true, default: [] },
}, { _id: false });

const schema = new Schema<IAgentCustomerAnalysis>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  requestKey: { type: String, required: true, maxlength: 128 },
  sources: { type: [sourceSchema], default: [] },
  facts: { type: [claimSchema], default: [] },
  gaps: { type: [claimSchema], default: [] },
  recommendations: { type: [claimSchema], default: [] },
  emailDraft: {
    type: new Schema({
      subject: { type: String, required: true, trim: true, maxlength: 300 },
      bodyText: { type: String, required: true, maxlength: 20000 },
    }, { _id: false }),
    required: true,
  },
  followUpPlan: {
    type: new Schema({
      method: { type: String, enum: ['email', 'whatsapp', 'phone', 'chat', 'other'], required: true },
      content: { type: String, required: true, trim: true, maxlength: 5000 },
      dueAt: { type: Date, required: true },
      reason: { type: String, trim: true, maxlength: 1200 },
      sourceIds: { type: [String], required: true, default: [] },
      manuallyEdited: { type: Boolean, default: false },
    }, { _id: false }),
    required: true,
  },
  emailStatus: { type: String, enum: ['editable', 'saving', 'saved', 'failed'], default: 'editable', required: true },
  followUpStatus: { type: String, enum: ['editable', 'scheduling', 'scheduled', 'failed'], default: 'editable', required: true },
  emailConfirmationKey: { type: String, maxlength: 128 },
  followUpConfirmationKey: { type: String, maxlength: 128 },
  createdLetterId: { type: Schema.Types.ObjectId, ref: 'DevelopmentLetter' },
  scheduledAt: Date,
  version: { type: Number, default: 1, min: 1, required: true },
  lastError: { type: String, maxlength: 120 },
}, { timestamps: true, versionKey: false });

schema.index({ projectId: 1, userId: 1, requestKey: 1 }, { unique: true });
schema.index({ projectId: 1, userId: 1, customerId: 1, updatedAt: -1 });

export type AgentCustomerAnalysisDocument = HydratedDocument<IAgentCustomerAnalysis>;
export const AgentCustomerAnalysis = model<IAgentCustomerAnalysis>('AgentCustomerAnalysis', schema);
export default AgentCustomerAnalysis;
