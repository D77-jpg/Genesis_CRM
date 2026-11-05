import './tenant-setup';
import { Schema, model, Types } from 'mongoose';

export interface IPublicResource {
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  kind: 'product' | 'company' | 'playbook' | 'knowledge';
  sourceId: Types.ObjectId;
  enabled: boolean;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
const schema = new Schema<IPublicResource>({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['product', 'company', 'playbook', 'knowledge'], required: true },
  sourceId: { type: Schema.Types.ObjectId, required: true },
  enabled: { type: Boolean, default: true },
  payload: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, versionKey: false });
schema.index({ organizationId: 1, projectId: 1, kind: 1, sourceId: 1 }, { unique: true });
schema.index({ organizationId: 1, projectId: 1, kind: 1, updatedAt: 1, sourceId: 1 });
export const IntegrationPublicResource = model<IPublicResource>('IntegrationPublicResource', schema);

// Infrastructure counters use only credential-derived keys, never caller-supplied keys.
// The tenant plugin remains registered; the limiter uses a narrow bypass to share a
// credential's budget across all bound projects/organizations and API processes.
export const IntegrationRateLimit = model('IntegrationRateLimit', new Schema({
  credentialId: { type: Schema.Types.ObjectId, required: true },
  window: { type: Number, required: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
}, { versionKey: false })
  .index({ credentialId: 1, window: 1 }, { unique: true })
  .index({ expiresAt: 1 }, { expireAfterSeconds: 0 }));
