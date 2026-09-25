import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { TEMPLATE_CATEGORY, type TemplateCategory } from '../constants';

export interface TemplateSuggestionSourceSummary {
  /** Count is calculated from project-scoped, attributed DevelopmentLetter records, never client input. */
  sentCount: number;
  replyCount: number;
  interestedCount: number;
  quoteCount: number;
  wonCount: number;
  unsubscribeCount: number;
  bounceCount: number;
  minimumSampleSize: number;
  sampleSufficient: boolean;
  evidence: 'project-scoped-letter-count';
  referenceTemplateId: string;
}

export interface ITemplateSuggestion {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  sourceTemplateId: Types.ObjectId;
  sourceTemplateSnapshot: { name: string; subject: string; contentHash: string; updatedAt: Date };
  model: 'rule-based-v1';
  sourceSummary: TemplateSuggestionSourceSummary;
  suggested: { name: string; subject: string; content: string; category: TemplateCategory };
  explanation: string[];
  status: 'preview' | 'copied' | 'cancelled';
  version: number;
  createdTemplateId?: Types.ObjectId;
  idempotencyKey: string;
  confirmationKey?: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ITemplateSuggestion>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  sourceTemplateId: { type: Schema.Types.ObjectId, ref: 'LetterTemplate', required: true },
  sourceTemplateSnapshot: {
    type: new Schema({
      name: { type: String, required: true, maxlength: 120 },
      subject: { type: String, required: true, maxlength: 300 },
      contentHash: { type: String, required: true, maxlength: 64 },
      updatedAt: { type: Date, required: true },
    }, { _id: false }), required: true,
  },
  model: { type: String, enum: ['rule-based-v1'], required: true },
  sourceSummary: {
    type: new Schema({
      sentCount: { type: Number, required: true, min: 0 },
      replyCount: { type: Number, required: true, min: 0 },
      interestedCount: { type: Number, required: true, min: 0 },
      quoteCount: { type: Number, required: true, min: 0 },
      wonCount: { type: Number, required: true, min: 0 },
      unsubscribeCount: { type: Number, required: true, min: 0 },
      bounceCount: { type: Number, required: true, min: 0 },
      minimumSampleSize: { type: Number, required: true, min: 1 },
      sampleSufficient: { type: Boolean, required: true },
      evidence: { type: String, enum: ['project-scoped-letter-count'], required: true },
      referenceTemplateId: { type: String, required: true, maxlength: 24 },
    }, { _id: false }), required: true,
  },
  suggested: {
    type: new Schema({
      name: { type: String, required: true, trim: true, maxlength: 120 },
      subject: { type: String, required: true, trim: true, maxlength: 300 },
      content: { type: String, required: true, maxlength: 100000 },
      category: { type: String, enum: TEMPLATE_CATEGORY, required: true },
    }, { _id: false }), required: true,
  },
  explanation: { type: [String], default: [] },
  status: { type: String, enum: ['preview', 'copied', 'cancelled'], default: 'preview', required: true },
  version: { type: Number, default: 1, required: true, min: 1 },
  createdTemplateId: { type: Schema.Types.ObjectId, ref: 'LetterTemplate' },
  idempotencyKey: { type: String, required: true, maxlength: 128 },
  confirmationKey: { type: String, maxlength: 128 },
  generatedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

schema.index({ projectId: 1, userId: 1, sourceTemplateId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ projectId: 1, userId: 1, sourceTemplateId: 1, createdAt: -1 });

export type TemplateSuggestionDocument = HydratedDocument<ITemplateSuggestion>;
export const TemplateSuggestion = model<ITemplateSuggestion>('TemplateSuggestion', schema);
export default TemplateSuggestion;
