import './tenant-setup';
/**
 * Server-side refresh session.
 *
 * Only a SHA-256 hash of the opaque refresh token is stored. Revoking a
 * session therefore invalidates the browser cookie immediately.
 */
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

export interface IAuthSession {
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthSessionDocument = HydratedDocument<IAuthSession>;

const AuthSessionSchema = new Schema<IAuthSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date },
    userAgent: { type: String, trim: true, maxlength: 512 },
    ip: { type: String, trim: true, maxlength: 64 },
  },
  // Refresh sessions are global security records keyed by user; they must not
  // disappear when requireAuth later runs the request inside a tenant scope.
  { timestamps: true, versionKey: false, skipTenant: true } as never,
);

AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

export const AuthSession = model<IAuthSession>('AuthSession', AuthSessionSchema);

export default AuthSession;
