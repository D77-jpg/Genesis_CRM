import './tenant-setup';
/**
 * Short-lived authentication challenges.
 *
 * Used for email OTP two-factor login and password-reset links. Only an
 * HMAC-SHA-256 digest of the OTP/token is stored; the raw value exists only in
 * the email sent to the account owner.
 */
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

export type AuthChallengePurpose = 'login-2fa' | 'password-reset';

export interface IAuthChallenge {
  userId: Types.ObjectId;
  purpose: AuthChallengePurpose;
  secretHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthChallengeDocument = HydratedDocument<IAuthChallenge>;

const AuthChallengeSchema = new Schema<IAuthChallenge>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['login-2fa', 'password-reset'], required: true },
    secretHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    consumedAt: { type: Date },
  },
  { timestamps: true, versionKey: false, skipTenant: true } as never,
);

AuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthChallengeSchema.index({ purpose: 1, secretHash: 1 });
AuthChallengeSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });

export const AuthChallenge = model<IAuthChallenge>('AuthChallenge', AuthChallengeSchema);

export default AuthChallenge;
