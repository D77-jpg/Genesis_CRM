import './tenant-setup';
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export const USAGE_METRICS = ['emails', 'ai_tokens', 'storage_bytes'] as const;
export type UsageMetric = typeof USAGE_METRICS[number];

export interface IUsageRecord {
  organizationId: Types.ObjectId;
  /** UTC month in YYYY-MM form. */
  period: string;
  metric: UsageMetric;
  value: number;
  updatedAt: Date;
  createdAt: Date;
}

export type UsageRecordDocument = HydratedDocument<IUsageRecord>;
export type UsageRecordModel = Model<IUsageRecord>;

const UsageRecordSchema = new Schema<IUsageRecord>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    metric: { type: String, enum: USAGE_METRICS, required: true },
    value: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

UsageRecordSchema.index({ organizationId: 1, period: 1, metric: 1 }, { unique: true });

export const UsageRecord = model<IUsageRecord, UsageRecordModel>('UsageRecord', UsageRecordSchema);
export default UsageRecord;
