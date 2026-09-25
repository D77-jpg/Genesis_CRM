import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import type { CustomerStatus, FollowUpMethod, FollowUpResult } from '../constants';

export const AGENT_MAIL_INTENTS = [
  'inquiry', 'quotation_request', 'negotiation', 'sample_request', 'order', 'support',
  'positive', 'neutral', 'unsubscribe', 'bounce', 'rejection', 'spam', 'other',
] as const;
export type AgentMailIntent = (typeof AGENT_MAIL_INTENTS)[number];
export const AGENT_MAIL_SAFETY = ['normal', 'unsubscribe', 'bounce', 'rejection', 'spam'] as const;
export type AgentMailSafety = (typeof AGENT_MAIL_SAFETY)[number];

export interface AgentMailEvidenceValue { value: string; evidenceMessageIds: string[] }
export interface AgentMailQuestion { text: string; evidenceMessageIds: string[] }

export interface IAgentMailThreadAnalysis {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  rootMailId: string;
  rootDirection: 'inbound' | 'outbound';
  threadId: string;
  customerId?: Types.ObjectId;
  replyToMailId?: Types.ObjectId;
  requestKey: string;
  sources: { messageId: string; direction: 'inbound' | 'outbound'; subject: string; sentAt: Date; label: string }[];
  summary: string;
  intent: { category: AgentMailIntent; label: string; confidence: number; evidenceMessageIds: string[] };
  extracted: {
    products: AgentMailEvidenceValue[];
    quantity: AgentMailEvidenceValue;
    price: AgentMailEvidenceValue;
    delivery: AgentMailEvidenceValue;
    questions: AgentMailQuestion[];
  };
  safety: { classification: AgentMailSafety; marketingBlocked: boolean; reason: string; evidenceMessageIds: string[] };
  replyDraft: { subject: string; bodyText: string };
  statusSuggestion: { status: CustomerStatus; reason: string };
  followUpSuggestion: { method: FollowUpMethod; content: string; result: FollowUpResult; reason: string; evidenceMessageIds: string[]; nextFollowUpAt?: Date };
  replyStatus: 'editable' | 'saving' | 'saved' | 'blocked' | 'failed';
  customerStatusUpdate: 'editable' | 'updating' | 'updated' | 'failed';
  followUpStatus: 'editable' | 'saving' | 'saved' | 'failed';
  replyConfirmationKey?: string;
  statusConfirmationKey?: string;
  followUpConfirmationKey?: string;
  createdLetterId?: Types.ObjectId;
  createdFollowUpId?: Types.ObjectId;
  version: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceValueSchema = new Schema<AgentMailEvidenceValue>({
  value: { type: String, default: '', maxlength: 1200 },
  evidenceMessageIds: { type: [String], default: [] },
}, { _id: false });
const questionSchema = new Schema<AgentMailQuestion>({
  text: { type: String, required: true, maxlength: 1200 },
  evidenceMessageIds: { type: [String], default: [] },
}, { _id: false });

const schema = new Schema<IAgentMailThreadAnalysis>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rootMailId: { type: String, required: true, maxlength: 128 },
  rootDirection: { type: String, enum: ['inbound', 'outbound'], required: true },
  threadId: { type: String, required: true, maxlength: 256 },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  replyToMailId: { type: Schema.Types.ObjectId, ref: 'MailMessage' },
  requestKey: { type: String, required: true, maxlength: 128 },
  sources: { type: [new Schema({
    messageId: { type: String, required: true, maxlength: 128 },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    subject: { type: String, default: '', maxlength: 300 },
    sentAt: { type: Date, required: true },
    label: { type: String, required: true, maxlength: 360 },
  }, { _id: false })], default: [] },
  summary: { type: String, required: true, maxlength: 5000 },
  intent: { type: new Schema({
    category: { type: String, enum: AGENT_MAIL_INTENTS, required: true },
    label: { type: String, required: true, maxlength: 120 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    evidenceMessageIds: { type: [String], default: [] },
  }, { _id: false }), required: true },
  extracted: { type: new Schema({
    products: { type: [evidenceValueSchema], default: [] },
    quantity: { type: evidenceValueSchema, required: true },
    price: { type: evidenceValueSchema, required: true },
    delivery: { type: evidenceValueSchema, required: true },
    questions: { type: [questionSchema], default: [] },
  }, { _id: false }), required: true },
  safety: { type: new Schema({
    classification: { type: String, enum: AGENT_MAIL_SAFETY, required: true },
    marketingBlocked: { type: Boolean, required: true },
    reason: { type: String, default: '', maxlength: 1200 },
    evidenceMessageIds: { type: [String], default: [] },
  }, { _id: false }), required: true },
  replyDraft: { type: new Schema({
    subject: { type: String, default: '', maxlength: 300 },
    bodyText: { type: String, default: '', maxlength: 20000 },
  }, { _id: false }), required: true },
  statusSuggestion: { type: new Schema({
    status: { type: String, enum: ['pending', 'contacted', 'replied', 'interested', 'quoting', 'negotiating', 'won', 'lost'], required: true },
    reason: { type: String, required: true, maxlength: 1200 },
  }, { _id: false }), required: true },
  followUpSuggestion: { type: new Schema({
    method: { type: String, enum: ['email', 'whatsapp', 'phone', 'chat', 'other'], required: true },
    content: { type: String, required: true, maxlength: 5000 },
    result: { type: String, enum: ['no_reply', 'replied', 'interested', 'quoted', 'negotiating', 'won', 'no_need', 'other'], required: true },
    reason: { type: String, default: '', maxlength: 1200 },
    evidenceMessageIds: { type: [String], default: [] },
    nextFollowUpAt: Date,
  }, { _id: false }), required: true },
  replyStatus: { type: String, enum: ['editable', 'saving', 'saved', 'blocked', 'failed'], required: true, default: 'editable' },
  customerStatusUpdate: { type: String, enum: ['editable', 'updating', 'updated', 'failed'], required: true, default: 'editable' },
  followUpStatus: { type: String, enum: ['editable', 'saving', 'saved', 'failed'], required: true, default: 'editable' },
  replyConfirmationKey: { type: String, maxlength: 128 },
  statusConfirmationKey: { type: String, maxlength: 128 },
  followUpConfirmationKey: { type: String, maxlength: 128 },
  createdLetterId: { type: Schema.Types.ObjectId, ref: 'DevelopmentLetter' },
  createdFollowUpId: { type: Schema.Types.ObjectId, ref: 'FollowUp' },
  version: { type: Number, required: true, default: 1, min: 1 },
  lastError: { type: String, maxlength: 120 },
}, { timestamps: true, versionKey: false });

schema.index({ projectId: 1, userId: 1, requestKey: 1 }, { unique: true });
schema.index({ projectId: 1, userId: 1, rootMailId: 1, updatedAt: -1 });

export type AgentMailThreadAnalysisDocument = HydratedDocument<IAgentMailThreadAnalysis>;
export const AgentMailThreadAnalysis = model<IAgentMailThreadAnalysis>('AgentMailThreadAnalysis', schema);

