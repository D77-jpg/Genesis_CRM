import './tenant-setup';
/**
 * Outbound marketing suppression list.
 *
 * A row blocks a recipient address for one project (or globally when scopeKey
 * is "global"). It is intentionally separate from Customer: an address may be
 * suppressed before it becomes a customer, and deleting a customer must not
 * resurrect a previous unsubscribe.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export const SUPPRESSION_REASONS = ['unsubscribe', 'hard_bounce', 'complaint', 'spam', 'manual'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export interface IEmailSuppression {
  scopeKey: string;
  projectId?: Types.ObjectId;
  email: string;
  reason: SuppressionReason;
  source: 'link' | 'inbound' | 'smtp' | 'admin' | 'import';
  note?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type EmailSuppressionDocument = HydratedDocument<IEmailSuppression>;

const schema = new Schema<IEmailSuppression>({
  scopeKey: { type: String, required: true, index: true, maxlength: 80 },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200, index: true },
  reason: { type: String, enum: SUPPRESSION_REASONS, required: true },
  source: { type: String, enum: ['link', 'inbound', 'smtp', 'admin', 'import'], required: true },
  note: { type: String, trim: true, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

schema.index({ organizationId: 1, scopeKey: 1, email: 1 }, { unique: true });
schema.index({ projectId: 1, createdAt: -1 });

export const EmailSuppression = model<IEmailSuppression>('EmailSuppression', schema);
export default EmailSuppression;
