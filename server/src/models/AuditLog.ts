import './tenant-setup';
/**
 * Application audit trail.
 *
 * Stores security-relevant actions performed through the CRM UI/API. Details
 * are intentionally limited to identifiers and small operational summaries;
 * passwords, mail credentials, tokens and message bodies must never be stored.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export const AUDIT_ACTIONS = [
  'oauth.client.created', 'oauth.client.updated', 'oauth.client.rotated', 'oauth.consent.approved', 'oauth.consent.denied', 'oauth.grant.revoked', 'oauth.token.revoked', 'oauth.token.reused',
  'integration.webhook.saved','integration.webhook.rotated','integration.webhook.retried',
  'integration.credential.create',
  'integration.credential.rotate',
  'integration.credential.revoke',
  'integration.credential.list',
  'integration.logs.view',
  'auth.login.success',
  'auth.login.failed',
  'auth.login.locked',
  'auth.login.2fa_required',
  'auth.logout',
  'auth.password_reset.requested',
  'auth.password_reset.success',
  'user.create',
  'user.update',
  'user.password_reset',
  'user.status_change',
  'user.delete',
  'customer.import',
  'customer.export',
  'customer.delete',
  'customer.bulk_delete',
  'project.onboarding.completed',
  'mail.suppression.add',
  'mail.suppression.remove',
  'mail.compliance.settings',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface IAuditLog {
  actorId?: Types.ObjectId;
  actorUsername?: string;
  actorRole?: 'admin' | 'project_admin' | 'user' | 'viewer';
  projectId?: Types.ObjectId;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  success: boolean;
  requestId?: string;
  ip?: string;
  detail: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type AuditLogDocument = HydratedDocument<IAuditLog>;

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorUsername: { type: String, trim: true, maxlength: 80 },
    actorRole: { type: String, enum: ['admin', 'project_admin', 'user', 'viewer'] },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    targetType: { type: String, trim: true, maxlength: 40 },
    targetId: { type: String, trim: true, maxlength: 80 },
    success: { type: Boolean, required: true, default: true },
    requestId: { type: String, trim: true, maxlength: 128 },
    ip: { type: String, trim: true, maxlength: 64 },
    detail: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ projectId: 1, createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', AuditLogSchema);

export default AuditLog;
