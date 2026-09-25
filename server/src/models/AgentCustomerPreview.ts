import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { CUSTOMER_PRIORITY, type CustomerPriority } from '../constants';

export const AGENT_CUSTOMER_FIELDS = [
  'company', 'name', 'email', 'phone', 'country', 'industry', 'requirementNotes', 'leadSource', 'priority',
] as const;
export type AgentCustomerField = (typeof AGENT_CUSTOMER_FIELDS)[number];

export interface AgentCustomerPreviewFields {
  company: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  industry: string;
  requirementNotes: string;
  leadSource: string;
  priority: CustomerPriority;
}

export interface AgentCustomerUncertainty {
  field: AgentCustomerField;
  reason: string;
  confidence: number;
}

export interface AgentCustomerDuplicate {
  customerId: Types.ObjectId;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  reasons: string[];
}

export interface IAgentCustomerPreview {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  requestKey: string;
  sourceHash: string;
  sourceVersion: number;
  sourceKind?: 'scratchpad' | 'mail';
  sourceMailId?: Types.ObjectId;
  facts?: { field: AgentCustomerField; value: string; mailId: string }[];
  inferences?: { field: AgentCustomerField; value: string; reason: string; mailId: string }[];
  fields: AgentCustomerPreviewFields;
  uncertainties: AgentCustomerUncertainty[];
  duplicates: AgentCustomerDuplicate[];
  status: 'preview' | 'creating' | 'created' | 'cancelled' | 'failed';
  version: number;
  confirmationKey?: string;
  createdCustomerId?: Types.ObjectId;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const fieldsSchema = new Schema<AgentCustomerPreviewFields>({
  company: { type: String, default: '', trim: true, maxlength: 200 },
  name: { type: String, default: '', trim: true, maxlength: 120 },
  email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
  phone: { type: String, default: '', trim: true, maxlength: 60 },
  country: { type: String, default: '', trim: true, maxlength: 120 },
  industry: { type: String, default: '', trim: true, maxlength: 120 },
  requirementNotes: { type: String, default: '', trim: true, maxlength: 5000 },
  leadSource: { type: String, default: '', trim: true, maxlength: 120 },
  priority: { type: String, enum: CUSTOMER_PRIORITY, default: 'medium' },
}, { _id: false });

const uncertaintySchema = new Schema<AgentCustomerUncertainty>({
  field: { type: String, enum: AGENT_CUSTOMER_FIELDS, required: true },
  reason: { type: String, required: true, maxlength: 300 },
  confidence: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const duplicateSchema = new Schema<AgentCustomerDuplicate>({
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  name: { type: String, required: true, maxlength: 120 },
  company: { type: String, maxlength: 200 },
  email: { type: String, maxlength: 200 },
  phone: { type: String, maxlength: 60 },
  reasons: { type: [String], required: true, default: [] },
}, { _id: false });

const schema = new Schema<IAgentCustomerPreview>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestKey: { type: String, required: true, maxlength: 128 },
  sourceHash: { type: String, required: true, maxlength: 64 },
  sourceVersion: { type: Number, required: true, min: 0 },
  sourceKind: { type: String, enum: ['scratchpad', 'mail'], default: 'scratchpad' },
  sourceMailId: { type: Schema.Types.ObjectId, ref: 'MailMessage' },
  facts: { type: [new Schema({ field: { type: String, enum: AGENT_CUSTOMER_FIELDS, required: true }, value: { type: String, required: true, maxlength: 1200 }, mailId: { type: String, required: true, maxlength: 24 } }, { _id: false })], default: [] },
  inferences: { type: [new Schema({ field: { type: String, enum: AGENT_CUSTOMER_FIELDS, required: true }, value: { type: String, required: true, maxlength: 1200 }, reason: { type: String, required: true, maxlength: 300 }, mailId: { type: String, required: true, maxlength: 24 } }, { _id: false })], default: [] },
  fields: { type: fieldsSchema, required: true },
  uncertainties: { type: [uncertaintySchema], default: [] },
  duplicates: { type: [duplicateSchema], default: [] },
  status: { type: String, enum: ['preview', 'creating', 'created', 'cancelled', 'failed'], default: 'preview', required: true },
  version: { type: Number, default: 1, min: 1, required: true },
  confirmationKey: { type: String, maxlength: 128 },
  createdCustomerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  lastError: { type: String, maxlength: 120 },
}, { timestamps: true, versionKey: false });

schema.index({ projectId: 1, userId: 1, requestKey: 1 }, { unique: true });
schema.index({ projectId: 1, userId: 1, status: 1, updatedAt: -1 });

export type AgentCustomerPreviewDocument = HydratedDocument<IAgentCustomerPreview>;
export const AgentCustomerPreview = model<IAgentCustomerPreview>('AgentCustomerPreview', schema);
export default AgentCustomerPreview;
