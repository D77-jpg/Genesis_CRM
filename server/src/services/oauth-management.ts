import mongoose from 'mongoose';
import type { Request } from 'express';
import { z } from 'zod';
import { OAuthClient, OAuthGrant, OAuthInteraction, OAuthTokenFamily } from '../models/OAuth';
import { oauthProvider } from './oauth-provider';
import { cookieIdentity, dbSession, hash, inOrg, opaque, oauthAudit, permittedProjects, protocolContext, registryClient, requireOAuthConfig, secretHash, allowedRedirect, OAUTH_SCOPES, type ProtocolTransaction } from './oauth-core';
import { getCookie } from '../utils/auth-cookies';
import { ApiError } from '../utils/ApiError';
const scopeSchema = z.array(z.enum(OAUTH_SCOPES)).min(1).max(5).refine(a => new Set(a).size === a.length && a.includes('openid'));
const fields = {
    name: z.string().trim().min(1).max(80), operator: z.string().trim().min(1).max(120),
    privacyUrl: z.string().url().max(2048), termsUrl: z.string().url().max(2048),
    redirectUris: z.array(z.string().url().max(2048)).min(1).max(5), scopes: scopeSchema
};
const createSchema = z.object(fields).strict();
const patchSchema = z.object({ ...fields, status: z.enum(['active', 'disabled']) }).partial().strict().refine(v => Object.keys(v).length > 0);
function redirects(input: any) {
    const config = requireOAuthConfig();
    if (input.redirectUris && (new Set(input.redirectUris).size !== input.redirectUris.length || input.redirectUris.some((v: string) => !allowedRedirect(v, config.local)) ||
        new Set(input.redirectUris.map((v: string) => new URL(v).hostname)).size !== 1))
        throw ApiError.badRequest('Exact same-host redirect URIs required');
    for (const name of ['privacyUrl', 'termsUrl'])
        if (input[name] && !allowedRedirect(input[name], config.local))
            throw ApiError.badRequest('Public HTTPS policy URLs required');
}
function dto(c: any) { return { clientId: c.clientId, name: c.name, operator: c.operator, privacyUrl: c.privacyUrl, termsUrl: c.termsUrl, redirectUris: c.redirectUris, scopes: c.scopes, status: c.status, version: c.version, createdAt: new Date(c.createdAt).toISOString(), previousValidUntil: c.previousValidUntil ? new Date(c.previousValidUntil).toISOString() : null }; }
export async function transaction<T>(client: any, fn: () => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    session.startTransaction();
    const state: ProtocolTransaction = { session, queue: Promise.resolve(), revoked: false, tokenWrites: 0, client, registryOrg: client ? String(client.organizationId) : undefined };
    try {
        const result = await protocolContext.run(state, fn);
        await state.queue;
        await session.commitTransaction();
        return result;
    }
    catch (error) {
        if (session.inTransaction())
            await session.abortTransaction();
        throw error;
    }
    finally {
        await session.endSession();
    }
}
export async function manageClients(req: Request, action: 'list' | 'create' | 'patch' | 'rotate') {
    const identity = await cookieIdentity(req, action !== 'list', action !== 'list');
    if (!identity.user.isPlatformAdmin)
        throw ApiError.forbidden('Platform administrator required');
    requireOAuthConfig();
    if (action === 'list')
        return { items: await inOrg(identity.user.organizationId, async () => (await OAuthClient.find({ organizationId: identity.user.organizationId }).sort({ _id: -1 }).limit(100).lean<any>()).map(dto)) };
    let input: any;
    if (action === 'create')
        input = createSchema.parse(req.body);
    if (action === 'patch')
        input = patchSchema.parse(req.body);
    if (action === 'rotate')
        input = z.object({ graceSeconds: z.number().int().min(0).max(86400).default(0) }).strict().parse(req.body ?? {});
    if (action !== 'rotate')
        redirects(input);
    return transaction(undefined, () => inOrg(identity.user.organizationId, async () => {
        let client: any, clientSecret: string | undefined;
        if (action === 'create') {
            clientSecret = opaque();
            [client] = await OAuthClient.create([{ ...input, organizationId: identity.user.organizationId, clientId: opaque(), secretHash: secretHash(clientSecret) }], { session: dbSession() });
        }
        else {
            client = await OAuthClient.findOne({ clientId: String(req.params.clientId), organizationId: identity.user.organizationId }).select('+secretHash +previousSecretHash').session(dbSession() ?? null);
            if (!client)
                throw ApiError.notFound('Application not found');
            if (action === 'rotate') {
                if (client.previousValidUntil && +client.previousValidUntil > Date.now())
                    throw ApiError.conflict('Secret rotation already in progress');
                clientSecret = opaque();
                client.previousSecretHash = client.secretHash;
                client.previousValidUntil = new Date(Date.now() + input.graceSeconds * 1000);
                client.secretHash = secretHash(clientSecret);
            }
            else {
                Object.assign(client, input);
                client.version++;
            }
            await client.save({ session: dbSession() });
        }
        await oauthAudit(identity.user.organizationId, action === 'create' ? 'oauth.client.created' : action === 'rotate' ? 'oauth.client.rotated' : 'oauth.client.updated', identity.user._id, client._id);
        return { client: dto(client), ...(clientSecret ? { clientSecret } : {}) };
    }));
}
async function interaction(req: Request) {
    const provider = oauthProvider();
    if (!provider)
        throw new ApiError(503, 'OAuth unavailable', 'INTERNAL_ERROR');
    const uid = String(req.params.uid);
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(uid) || getCookie(req, 'crm_oidc_interaction') !== uid)
        throw ApiError.notFound('Authorization request not found');
    // Provider checks the signed interaction cookie, expiration and associated session.
    const info = await provider.interactionDetails(req, req.res);
    if (info.uid !== uid)
        throw ApiError.notFound('Authorization request not found');
    const client = await registryClient(String(info.params.client_id));
    if (!client || client.status !== 'active' || !client.redirectUris.includes(info.params.redirect_uri))
        throw ApiError.notFound('Authorization request not found');
    return { provider, info, client, uid };
}
export async function consentData(req: Request) {
    const identity = await cookieIdentity(req);
    const { info, client, uid } = await interaction(req);
    const projects = await permittedProjects(identity.user);
    const row = await inOrg(client.organizationId, () => OAuthInteraction.findOne({ organizationId: client.organizationId, kind: 'Interaction', idHash: hash(uid), decisionAt: { $exists: false }, expiresAt: { $gt: new Date() } }).lean<any>());
    if (!row || row.clientVersion !== client.version)
        throw ApiError.notFound('Authorization request expired');
    const forcedFresh = info.params.prompt === 'login' || Number(info.params.max_age) === 0;
    const afterRequest = !!identity.session.authenticatedAt && +identity.session.authenticatedAt * 1 >= +row.createdAt;
    const maxAge = info.params.max_age === undefined ? 600 : Number(info.params.max_age);
    const age = identity.session.authenticatedAt ? (Date.now() - +identity.session.authenticatedAt) / 1000 : Infinity;
    return { uid, identity: { name: identity.user.displayName || identity.user.username, organizationName: identity.organization.name }, application: { clientId: client.clientId, name: client.name, operator: client.operator, redirectHost: new URL(info.params.redirect_uri).host, privacyUrl: client.privacyUrl, termsUrl: client.termsUrl },
        scopes: String(info.params.scope).split(' '), projects: projects.map((p: any) => ({ id: String(p._id), name: p.name })),
        freshLoginRequired: !identity.fresh || (maxAge > 0 && age > maxAge) || (forcedFresh && !afterRequest) };
}
export async function decide(req: Request) {
    const identity = await cookieIdentity(req, true, true), current = await interaction(req);
    const input = z.object({ decision: z.enum(['approve', 'deny']), projectId: z.string().regex(/^[a-f0-9]{24}$/i).optional(), scopes: scopeSchema.optional() }).strict().parse(req.body);
    const data = await consentData(req);
    if (data.freshLoginRequired)
        throw ApiError.unauthorized('Fresh CRM login required');
    const requested = String(current.info.params.scope).split(' ');
    return transaction(current.client, async () => {
        const used = await inOrg(current.client.organizationId, () => OAuthInteraction.updateOne({ kind: 'Interaction', idHash: hash(current.uid), organizationId: current.client.organizationId, decisionAt: { $exists: false }, expiresAt: { $gt: new Date() }, clientVersion: current.client.version }, { $set: { decisionAt: new Date(), resolvedUserId: String(identity.user._id) } }).session(dbSession() ?? null));
        if (used.modifiedCount !== 1)
            throw ApiError.conflict('Authorization request already completed');
        if (input.decision === 'deny') {
            const resumeUrl = await current.provider.interactionResult(req, req.res, { error: 'access_denied', error_description: 'User declined access' }, { mergeWithLastSubmission: false });
            await oauthAudit(identity.user.organizationId, 'oauth.consent.denied', identity.user._id, current.uid);
            return { resumeUrl };
        }
        const selected = input.scopes ?? requested.filter((s: string) => s !== 'offline_access');
        if (!input.projectId || selected.some((s: string) => !requested.includes(s) || !current.client.scopes.includes(s)) || !data.projects.some((p: any) => p.id === input.projectId))
            throw ApiError.forbidden('Selected project or scope is not permitted');
        return inOrg(identity.user.organizationId, async () => {
            const grant = await OAuthGrant.findOneAndUpdate({ organizationId: identity.user.organizationId, userId: identity.user._id, clientId: current.client.clientId, projectId: input.projectId }, { $set: { scopes: selected, lastConsentSessionId: String(identity.session._id) }, $inc: { revision: 1 }, $unset: { revokedAt: 1 } }, { upsert: true, new: true, session: dbSession() });
            const familyKey = opaque(), expiresAt = new Date(Math.min(+identity.session.expiresAt, Date.now() + (selected.includes('offline_access') ? 30 * 86400 : 600) * 1000));
            await OAuthTokenFamily.create([{ organizationId: identity.user.organizationId, familyKey, grantId: grant._id, grantRevision: grant.revision, userId: identity.user._id, projectId: input.projectId, clientId: current.client.clientId,
                    sid: String(identity.session._id), securityVersion: identity.user.oauthSecurityVersion ?? 0, clientVersion: current.client.version, expiresAt, idleExpiresAt: new Date(Math.min(+expiresAt, Date.now() + 7 * 86400000)), cleanupAt: new Date(+expiresAt + 7 * 86400000) }], { session: dbSession() });
            const protocolGrant = new current.provider.Grant({ jti: familyKey, accountId: familyKey, clientId: current.client.clientId });
            protocolGrant.addOIDCScope(selected.join(' '));
            const rejected = requested.filter((scope: string) => !selected.includes(scope));
            if (rejected.length)
                protocolGrant.rejectOIDCScope(rejected.join(' '));
            await protocolGrant.save();
            const resumeUrl = await current.provider.interactionResult(req, req.res, { login: { accountId: familyKey, ts: Math.floor(+identity.session.authenticatedAt! / 1000), amr: identity.session.amr, remember: true }, consent: { grantId: familyKey } }, { mergeWithLastSubmission: false });
            if (!resumeUrl.startsWith(requireOAuthConfig().issuer + '/auth/'))
                throw Error('Invalid authorization resume');
            await oauthAudit(identity.user.organizationId, 'oauth.consent.approved', identity.user._id, grant._id, { clientId: current.client.clientId, projectId: input.projectId, scopes: selected });
            return { resumeUrl };
        });
    });
}
export async function applications(req: Request) {
    const identity = await cookieIdentity(req), query = z.object({ cursor: z.string().regex(/^[a-f0-9]{24}$/i).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict().parse(req.query);
    return inOrg(identity.user.organizationId, async () => {
        const rows = await OAuthGrant.find({ organizationId: identity.user.organizationId, userId: identity.user._id, ...(query.cursor ? { _id: { $lt: query.cursor } } : {}) }).sort({ _id: -1 }).limit(query.limit + 1).lean<any>();
        const items = [];
        for (const row of rows.slice(0, query.limit)) {
            const client = await registryClient(row.clientId);
            const { Project } = await import('../models');
            const project = await Project.findOne({ _id: row.projectId, organizationId: identity.user.organizationId }).select('name').lean<any>();
            const live = await OAuthTokenFamily.exists({ organizationId: identity.user.organizationId, grantId: row._id, grantRevision: row.revision, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() }, idleExpiresAt: { $gt: new Date() } });
            items.push({ id: String(row._id), clientId: row.clientId, clientName: client?.name ?? '', operator: client?.operator ?? '', projectId: String(row.projectId), projectName: project?.name ?? '', scopes: row.scopes, status: row.revokedAt ? 'revoked' : live ? 'active' : 'expired', createdAt: new Date(row.createdAt).toISOString(), lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null });
        }
        return { items, nextCursor: rows.length > query.limit ? String(rows[query.limit - 1]._id) : null };
    });
}
export async function revokeApplications(req: Request, all = false) {
    const identity = await cookieIdentity(req, false, true);
    const clientId = all ? z.object({ clientId: z.string().min(1).max(128) }).strict().parse(req.body).clientId : undefined;
    if (!all && !mongoose.isValidObjectId(req.params.grantId))
        throw ApiError.notFound('Authorization not found');
    return transaction(undefined, () => inOrg(identity.user.organizationId, async () => {
        const filter = { organizationId: identity.user.organizationId, userId: identity.user._id, ...(all ? { clientId } : { _id: req.params.grantId }) };
        const grant = await OAuthGrant.findOne(filter).session(dbSession() ?? null);
        if (!grant && !all)
            throw ApiError.notFound('Authorization not found');
        await OAuthGrant.updateMany(filter, { $set: { revokedAt: new Date() } }).session(dbSession() ?? null);
        await oauthAudit(identity.user.organizationId, 'oauth.grant.revoked', identity.user._id, all ? clientId! : req.params.grantId);
        return { revoked: true };
    }));
}
