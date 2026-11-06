import './tenant-setup';
import { Schema, model } from 'mongoose';
// Identity protocol state is tenant-scoped, including anonymous interactions
// owned by the registering organization. Token handles are never persisted.
const secret = { type: Schema.Types.Mixed, select: false };
const client = new Schema<any>({
    clientId: { type: String, required: true, unique: true }, name: String, operator: String,
    privacyUrl: String, termsUrl: String, redirectUris: [String], scopes: [String],
    secretHash: { type: String, select: false }, previousSecretHash: { type: String, select: false },
    previousValidUntil: { type: Date, default: null }, status: { type: String, default: 'active' },
    version: { type: Number, default: 1 }
}, { timestamps: true });
client.index({ organizationId: 1, status: 1 });
export const OAuthClient = model<any>('OAuthClient', client);
const subject = new Schema<any>({ userId: { type: Schema.Types.ObjectId, required: true }, sector: String, sub: { type: String, required: true, unique: true } }, { timestamps: true });
subject.index({ organizationId: 1, userId: 1, sector: 1 }, { unique: true });
export const OAuthSubject = model<any>('OAuthSubject', subject);
const consent = new Schema<any>({
    userId: { type: Schema.Types.ObjectId, required: true }, clientId: String, projectId: { type: Schema.Types.ObjectId, required: true },
    scopes: [String], revision: { type: Number, default: 1 }, revokedAt: Date, lastUsedAt: Date, lastConsentSessionId: String
}, { timestamps: true });
consent.index({ organizationId: 1, userId: 1, clientId: 1, projectId: 1 }, { unique: true });
export const OAuthGrant = model<any>('OAuthGrant', consent);
const family = new Schema<any>({
    familyKey: { type: String, required: true, unique: true }, grantId: { type: Schema.Types.ObjectId, required: true }, grantRevision: Number,
    userId: { type: Schema.Types.ObjectId, required: true }, projectId: { type: Schema.Types.ObjectId, required: true }, clientId: String,
    sid: String, securityVersion: Number, clientVersion: Number, expiresAt: Date, idleExpiresAt: Date,
    revokedAt: Date, lastUsedAt: Date, payload: secret, cleanupAt: Date
}, { timestamps: true });
family.index({ organizationId: 1, grantId: 1 });
family.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 });
export const OAuthTokenFamily = model<any>('OAuthTokenFamily', family);
function state(name: string) {
    const schema = new Schema<any>({
        kind: { type: String, required: true }, idHash: { type: String, required: true }, payload: secret,
        grantId: String, clientId: String, clientVersion: Number, uidHash: String,
        expiresAt: Date, cleanupAt: Date, consumedAt: Number, decisionAt: Date, resolvedUserId: String
    }, { timestamps: true });
    schema.index({ kind: 1, idHash: 1 }, { unique: true });
    schema.index({ organizationId: 1, grantId: 1 });
    schema.index({ kind: 1, uidHash: 1 }, { sparse: true });
    schema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 });
    return model<any>(name, schema);
}
export const OAuthInteraction = state('OAuthInteraction'); // provider Session + Interaction
export const OAuthAuthorizationCode = state('OAuthAuthorizationCode');
export const OAuthRefreshToken = state('OAuthRefreshToken');
export const OAuthAccessToken = state('OAuthAccessToken');
const rate = new Schema<any>({ keyHash: { type: String, required: true }, minute: { type: Number, required: true }, count: Number, cleanupAt: Date }, { timestamps: true });
rate.index({ organizationId: 1, keyHash: 1, minute: 1 }, { unique: true });
rate.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 });
export const OAuthRateBucket = model<any>('OAuthRateBucket', rate);
export const oauthModels = [OAuthRateBucket, OAuthClient, OAuthSubject, OAuthGrant, OAuthTokenFamily, OAuthInteraction, OAuthAuthorizationCode, OAuthRefreshToken, OAuthAccessToken];
