import type { Model } from 'mongoose';
import { OAuthGrant, OAuthClient, OAuthInteraction, OAuthAuthorizationCode, OAuthAccessToken, OAuthRefreshToken, OAuthTokenFamily } from '../models/OAuth';
import { encryptOAuthCredential, decryptOAuthCredential } from './credential-crypto';
import { hash, internalClientSecret, inOrg, locateFamily, checkFamily, protocolContext, dbSession, registryClient, serial, oauthAudit } from './oauth-core';
const tokenKinds = new Set(['AuthorizationCode', 'AccessToken', 'RefreshToken']);
const records: Record<string, Model<any>> = { Interaction: OAuthInteraction, Session: OAuthInteraction, AuthorizationCode: OAuthAuthorizationCode, AccessToken: OAuthAccessToken, RefreshToken: OAuthRefreshToken };
const session = () => dbSession();
export class OAuthAdapter {
    constructor(readonly kind: string) { }
    private model() { const model = records[this.kind]; if (!model)
        throw Error('Unsupported OAuth persistence kind'); return model; }
    async upsert(id: string, input: any, expiresIn: number) {
        return serial(async () => {
            if (this.kind === 'Client')
                throw Error('OAuth client registration is private');
            if (this.kind === 'Grant') {
                const family = await locateFamily(id);
                if (!family)
                    throw Error('Missing OAuth family');
                await inOrg(family.organizationId, () => OAuthTokenFamily.updateOne({ _id: family._id, organizationId: family.organizationId, revokedAt: { $exists: false } }, { $set: { payload: encryptOAuthCredential(JSON.stringify(input)) } }).session(session() ?? null));
                return;
            }
            const copy = { ...input };
            if (tokenKinds.has(this.kind))
                delete copy.jti;
            const family = input.grantId ? await locateFamily(input.grantId) : undefined;
            const tx = protocolContext.getStore();
            // Before authentication, interactions are owned by the registered client organization.
            const organizationId = family?.organizationId ?? tx?.registryOrg;
            if (!organizationId)
                throw Error('Missing OAuth tenant');
            const expiresAt = new Date(Math.min(Date.now() + expiresIn * 1000, family ? +family.expiresAt : Infinity));
            const client = input.clientId ? await registryClient(input.clientId) : tx?.client;
            const retainedUntil = new Date(family ? +family.expiresAt + 7 * 86400000 : +expiresAt);
            const model = this.model();
            if (tokenKinds.has(this.kind) && tx)
                tx.tokenWrites++;
            await inOrg(organizationId, () => model.updateOne({ kind: this.kind, idHash: hash(id), organizationId }, {
                $set: { payload: encryptOAuthCredential(JSON.stringify(copy)), grantId: input.grantId, clientId: input.clientId ?? client?.clientId,
                    clientVersion: client?.version, expiresAt, cleanupAt: retainedUntil, uidHash: input.uid ? hash(input.uid) : undefined }
            }, { upsert: true, session: session() }));
            if (this.kind === 'AccessToken' && family)
                await inOrg(organizationId, () => OAuthGrant.updateOne({ _id: family.grantId, organizationId }, { $set: { lastUsedAt: new Date() } }).session(session() ?? null));
            if (this.kind === 'RefreshToken' && family)
                await inOrg(organizationId, () => OAuthTokenFamily.updateOne({ _id: family._id, organizationId }, { $set: { idleExpiresAt: new Date(Math.min(+family.expiresAt, Date.now() + 7 * 86400000)), lastUsedAt: new Date() } }).session(session() ?? null));
        });
    }
    async find(id: string) {
        return serial(async () => {
            if (this.kind === 'Client') {
                const client = await registryClient(id);
                if (!client || client.status !== 'active')
                    return undefined;
                return { client_id: client.clientId, client_secret: internalClientSecret(client.clientId), client_name: client.name,
                    redirect_uris: client.redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
                    scope: client.scopes.join(' '), token_endpoint_auth_method: 'client_secret_basic', subject_type: 'pairwise', require_auth_time: true, id_token_signed_response_alg: 'RS256' };
            }
            if (this.kind === 'Grant') {
                const family = await locateFamily(id);
                if (!family || !await checkFamily(family))
                    return undefined;
                const row = await inOrg(family.organizationId, () => OAuthTokenFamily.findOne({ _id: family._id, organizationId: family.organizationId }).select('+payload').session(session() ?? null).lean<any>());
                if (!row?.payload)
                    return undefined;
                return { ...JSON.parse(decryptOAuthCredential(row.payload)), jti: id };
            }
            const model = this.model();
            // Anonymous token resolver is exact digest + artifact type, never a business query.
            const row = await inAnonymous(() => model.findOne({ kind: this.kind, idHash: hash(id) }).select('+payload').session(session() ?? null).lean<any>());
            if (!row || +row.cleanupAt <= Date.now())
                return undefined;
            const client = row.clientId ? await registryClient(row.clientId) : undefined;
            if (client && (client.status !== 'active' || client.version !== row.clientVersion))
                return undefined;
            if (row.grantId) {
                const family = await locateFamily(row.grantId);
                if (!await checkFamily(family))
                    return undefined;
            }
            else if (+row.expiresAt <= Date.now())
                return undefined;
            return { ...JSON.parse(decryptOAuthCredential(row.payload)), jti: id, ...(row.consumedAt ? { consumed: row.consumedAt } : {}) };
        });
    }
    async consume(id: string) {
        return serial(async () => {
            const model = this.model();
            const row = await inAnonymous(() => model.findOne({ kind: this.kind, idHash: hash(id) }).session(session() ?? null).lean<any>());
            if (!row)
                throw Error('Missing OAuth artifact');
            const result = await inOrg(row.organizationId, () => model.updateOne({ _id: row._id, organizationId: row.organizationId, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: Math.floor(Date.now() / 1000) } }).session(session() ?? null));
            if (result.modifiedCount !== 1)
                throw Error('OAuth atomic consume rejected');
        });
    }
    async destroy(id: string) {
        return serial(async () => {
            if (this.kind === 'Grant') {
                await revokeFamily(id, 'oauth.token.revoked');
                return;
            }
            const model = this.model();
            const row = await inAnonymous(() => model.findOne({ kind: this.kind, idHash: hash(id) }).session(session() ?? null).lean<any>());
            if (!row)
                return;
            // Keep consumed refresh/code hashes as replay evidence; family revocation is the truth.
            if (tokenKinds.has(this.kind)) {
                if (row.grantId)
                    await revokeFamily(row.grantId, this.kind === 'RefreshToken' ? 'oauth.token.reused' : 'oauth.token.revoked');
                return;
            }
            await inOrg(row.organizationId, () => model.deleteOne({ _id: row._id, organizationId: row.organizationId }).session(session() ?? null));
        });
    }
    async revokeByGrantId(grantId: string) { return serial(() => revokeFamily(grantId, 'oauth.token.reused')); }
    async findByUid(uid: string) {
        const row = await serial(() => inAnonymous(() => this.model().findOne({ kind: this.kind, uidHash: hash(uid), expiresAt: { $gt: new Date() } }).select('+payload').session(session() ?? null).lean<any>()));
        return row?.payload ? JSON.parse(decryptOAuthCredential(row.payload)) : undefined;
    }
    async findByUserCode() { return undefined; }
}
import { runWithTenant } from '../models/tenant-context';
function inAnonymous<T>(fn: () => T): T { return runWithTenant({ bypass: false, source: 'oauth-artifact-resolver' }, fn); }
async function revokeFamily(familyKey: string, action: string) {
    const family = await locateFamily(familyKey);
    if (!family)
        return;
    const state = protocolContext.getStore();
    if (state)
        state.revoked = true;
    await inOrg(family.organizationId, () => OAuthTokenFamily.updateOne({ _id: family._id, organizationId: family.organizationId }, { $set: { revokedAt: new Date() } }).session(session() ?? null));
    await oauthAudit(family.organizationId, action, family.userId, family._id);
}
export { OAuthClient };
