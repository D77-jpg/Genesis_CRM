import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export type MailAccountStatus = 'active' | 'disabled';
export type MailVerificationStatus = 'unverified' | 'verified' | 'failed';

export interface IUserMailAccount {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  email: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUsername: string;
  imapEnabled: boolean;
  imapHost?: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername?: string;
  credentialCiphertext: string;
  credentialIv: string;
  credentialTag: string;
  credentialVersion: number;
  status: MailAccountStatus;
  verificationStatus: MailVerificationStatus;
  verifiedAt?: Date;
  lastVerificationError?: string;
  imapVerificationStatus: MailVerificationStatus;
  imapVerifiedAt?: Date;
  lastImapVerificationError?: string;
  dailyLimit: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type UserMailAccountDocument = HydratedDocument<IUserMailAccount>;

const UserMailAccountSchema = new Schema<IUserMailAccount>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    displayName: { type: String, trim: true, default: '', maxlength: 120 },
    smtpHost: { type: String, required: true, trim: true, lowercase: true, maxlength: 253 },
    smtpPort: { type: Number, required: true, min: 1, max: 65535 },
    smtpSecure: { type: Boolean, default: true },
    smtpRequireTls: { type: Boolean, default: true },
    smtpUsername: { type: String, required: true, trim: true, maxlength: 300 },
    imapEnabled: { type: Boolean, default: false, index: true },
    imapHost: { type: String, trim: true, lowercase: true, maxlength: 253 },
    imapPort: { type: Number, default: 993, min: 1, max: 65535 },
    imapSecure: { type: Boolean, default: true },
    imapUsername: { type: String, trim: true, maxlength: 300 },
    credentialCiphertext: { type: String, required: true, select: false },
    credentialIv: { type: String, required: true, select: false },
    credentialTag: { type: String, required: true, select: false },
    credentialVersion: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true },
    verificationStatus: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
    verifiedAt: Date,
    lastVerificationError: { type: String, maxlength: 500 },
    imapVerificationStatus: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
    imapVerifiedAt: Date,
    lastImapVerificationError: { type: String, maxlength: 500 },
    dailyLimit: { type: Number, default: 100, min: 1, max: 5000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.credentialCiphertext;
        delete ret.credentialIv;
        delete ret.credentialTag;
      },
    },
  },
);

UserMailAccountSchema.index({ projectId: 1, userId: 1 }, { unique: true });
UserMailAccountSchema.index({ projectId: 1, email: 1 });

export const UserMailAccount = model<IUserMailAccount>('UserMailAccount', UserMailAccountSchema);

const MailQuotaBucketSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mailAccountId: { type: Schema.Types.ObjectId, ref: 'UserMailAccount', required: true, index: true },
  day: { type: String, required: true },
  attempts: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false });
MailQuotaBucketSchema.index({ mailAccountId: 1, day: 1 }, { unique: true });
export const MailQuotaBucket = model('MailQuotaBucket', MailQuotaBucketSchema);

const MailAccountAuditSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  accountId: { type: Schema.Types.ObjectId, ref: 'UserMailAccount', index: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: {
    type: String,
    enum: ['created', 'updated', 'verified', 'verification_failed', 'imap_verified', 'imap_verification_failed', 'send_attempt', 'send_success', 'send_failed', 'quota_blocked'],
    required: true,
  },
  detail: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: false });
MailAccountAuditSchema.index({ projectId: 1, createdAt: -1 });
export const MailAccountAudit = model('MailAccountAudit', MailAccountAuditSchema);
