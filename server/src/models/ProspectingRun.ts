import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export interface IProspectingRun {
  projectId: Types.ObjectId;
  day: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  queries: string[];
  imported: number;
  deduped: number;
  enriched: number;
  hunterFound: number;
  scored: number;
  selected: number;
  failed: { domain: string; reason: string }[];
  error?: string;
  triggeredBy: Types.ObjectId;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ProspectingRunDocument = HydratedDocument<IProspectingRun>;
export type ProspectingRunModel = Model<IProspectingRun>;

const ProspectingRunSchema = new Schema<IProspectingRun>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  day: { type: String, required: true, index: true },
  status: { type: String, enum: ['running', 'completed', 'partial', 'failed'], default: 'running' },
  queries: { type: [String], default: [] },
  imported: { type: Number, default: 0 },
  deduped: { type: Number, default: 0 },
  enriched: { type: Number, default: 0 },
  hunterFound: { type: Number, default: 0 },
  scored: { type: Number, default: 0 },
  selected: { type: Number, default: 0 },
  failed: { type: [{ domain: String, reason: String }], default: [] },
  error: { type: String },
  triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
}, { timestamps: true, versionKey: false });

ProspectingRunSchema.index({ projectId: 1, day: 1, createdAt: -1 });

export const ProspectingRun = model<IProspectingRun, ProspectingRunModel>('ProspectingRun', ProspectingRunSchema);
