import './tenant-setup';
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import { ORGANIZATION_PLANS, limitsForPlan, type OrganizationLimits, type OrganizationPlan } from '../constants/plans';

export type OrganizationStatus = 'active' | 'trialing' | 'suspended';

export interface IOrganization {
  name: string;
  slug: string;
  status: OrganizationStatus;
  plan: OrganizationPlan;
  limits: OrganizationLimits;
  billingEmail?: string;
  billingAddress?: string;
  taxId?: string;
  currency: string;
  locale: 'zh' | 'en';
  trialEndsAt?: Date;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'cancelled';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  externalCustomerId?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationDocument = HydratedDocument<IOrganization>;
export type OrganizationModel = Model<IOrganization>;

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 80, match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '组织标识格式不正确'] },
    status: { type: String, enum: ['active', 'trialing', 'suspended'], default: 'active', index: true },
    plan: { type: String, enum: ORGANIZATION_PLANS, default: 'starter', index: true },
    limits: {
      integrationCredentialsPerProject: { type: Number, min: 1, max: 1000 },
      users: { type: Number, default: () => limitsForPlan('starter').users, min: 1 },
      projects: { type: Number, default: () => limitsForPlan('starter').projects, min: 1 },
      monthlyEmails: { type: Number, default: () => limitsForPlan('starter').monthlyEmails, min: 1 },
      monthlyAiTokens: { type: Number, default: () => limitsForPlan('starter').monthlyAiTokens, min: 1 },
      storageBytes: { type: Number, default: () => limitsForPlan('starter').storageBytes, min: 1 },
    },
    billingEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    billingAddress: { type: String, trim: true, maxlength: 500 },
    taxId: { type: String, trim: true, maxlength: 80 },
    currency: { type: String, default: 'USD', uppercase: true, minlength: 3, maxlength: 3 },
    locale: { type: String, enum: ['zh', 'en'], default: 'zh' },
    trialEndsAt: Date,
    subscriptionStatus: { type: String, enum: ['trialing', 'active', 'past_due', 'cancelled'], default: 'active' },
    currentPeriodStart: { type: Date, default: () => new Date() },
    currentPeriodEnd: { type: Date, default: () => new Date(Date.now() + 30 * 86_400_000) },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    externalCustomerId: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    versionKey: false,
    skipTenant: true,
    toJSON: { virtuals: true, versionKey: false },
  } as never,
);

OrganizationSchema.index({ status: 1, createdAt: 1 });

export const Organization = model<IOrganization, OrganizationModel>('Organization', OrganizationSchema);
export default Organization;
