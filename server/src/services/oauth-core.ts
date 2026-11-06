import { createHash, createHmac, randomBytes, timingSafeEqual, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import { User, Project, Organization, AuthSession, AuditLog } from '../models';
import { OAuthClient, OAuthGrant, OAuthTokenFamily, oauthModels } from '../models/OAuth';
import { runWithTenant } from '../models/tenant-context';
import { AUTH_COOKIE_NAMES, getCookie } from '../utils/auth-cookies';
import { safeTokenEqual, verifyToken } from './auth.service';
import { ApiError } from '../utils/ApiError';
export const OAUTH_SCOPES = ['openid', 'profile', 'email', 'crm.context', 'offline_access'] as const;
export const opaque = () => randomBytes(32).toString('base64url');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const authBoundaryKey = randomBytes(32);
export const internalClientSecret = (id: string) => createHmac('sha256', authBoundaryKey).update(id).digest('base64url');
export function secretHash(value: string, salt = randomBytes(16).toString('hex')) { return salt + ':' + hash(salt + ':' + value); }
export function secretMatches(value: string, encoded?: string) {
    if (!encoded || !value)
        return false;
    const actual = secretHash(value, encoded.split(':')[0]);
    return actual.length === encoded.length && timingSafeEqual(Buffer.from(actual), Buffer.from(encoded));
}
export interface ProtocolTransaction {
    session: ClientSession;
    queue: Promise<unknown>;
    revoked: boolean;
    tokenWrites: number;
    client?: any;
    registryOrg?: string;
}
export const protocolContext = new AsyncLocalStorage<ProtocolTransaction>();
export const dbSession = () => protocolContext.getStore()?.session;
export function serial<T>(fn: () => Promise<T>): Promise<T> {
    const state = protocolContext.getStore();
    if (!state)
        return fn();
    const result = state.queue.then(fn);
    state.queue = result.catch(() => undefined);
    return result;
}
export function inOrg<T>(organizationId: unknown, fn: () => T): T {
    return runWithTenant({ organizationId: String(organizationId), bypass: false, source: 'oauth' }, fn);
}
// These exact-key resolvers are the only anonymous identity lookup boundary.
export function registryClient(clientId: string) {
    return runWithTenant({ bypass: false, source: 'oauth-registry' }, () => OAuthClient.findOne({ clientId }).select('+secretHash +previousSecretHash').session(dbSession() ?? null).lean<any>());
}
export function locateFamily(key: string) {
    return runWithTenant({ bypass: false, source: 'oauth-handle' }, () => OAuthTokenFamily.findOne({ familyKey: key }).session(dbSession() ?? null).lean<any>());
}
export function oauthConfig() {
    if (process.env.OIDC_ENABLED !== 'true')
        return null;
    try {
        const issuer = new URL(process.env.OIDC_ISSUER ?? '');
        const web = new URL(process.env.OIDC_PUBLIC_WEB_ORIGIN ?? '');
        const local = process.env.NODE_ENV !== 'production' && process.env.OIDC_ALLOW_LOOPBACK === 'true';
        const loop = (u: URL) => ['127.0.0.1', '[::1]'].includes(u.hostname);
        if (issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/oidc' ||
            web.username || web.password || web.search || web.hash || web.pathname !== '/' ||
            (issuer.protocol !== 'https:' && !(local && loop(issuer))) ||
            (web.protocol !== 'https:' && !(local && loop(web))))
            return null;
        const keyring = JSON.parse(readFileSync(process.env.OIDC_SIGNING_KEYRING_PATH ?? '', 'utf8'));
        const kid = process.env.OIDC_ACTIVE_KEY_ID;
        if (!Array.isArray(keyring.keys) || !keyring.keys.some((k: any) => k.kid === kid && k.d && k.kty === 'RSA') ||
            keyring.keys.some((k: any) => !k.kid || k.kty !== 'RSA' || (k.alg && k.alg !== 'RS256')))
            return null;
        const active = keyring.keys.find((k: any) => k.kid === kid);
        const key = createPrivateKey({ key: active, format: 'jwk' });
        if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
            return null;
        return { issuer: issuer.href, webOrigin: web.origin, local, jwks: { keys: [active, ...keyring.keys.filter((k: any) => k.kid !== kid)].map((k: any) => ({ ...k, alg: 'RS256', use: 'sig' })) } };
    }
    catch {
        return null;
    }
}
export function requireOAuthConfig() { const config = oauthConfig(); if (!config)
    throw new ApiError(503, 'OAuth is not configured', 'INTERNAL_ERROR'); return config; }
export function allowedRedirect(uri: string, local: boolean) {
    try {
        const u = new URL(uri);
        return !u.username && !u.password && !u.hash &&
            (['127.0.0.1', '[::1]'].includes(u.hostname) ? local && ['http:', 'https:'].includes(u.protocol) : u.protocol === 'https:' && !isIP(u.hostname.replace(/^\[|\]$/g, '')) && u.hostname.includes('.') && !/(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname));
    }
    catch {
        return false;
    }
}
export async function cookieIdentity(req: Request, fresh = false, write = false) {
    if (req.headers.authorization)
        throw ApiError.unauthorized('CRM browser session required');
    const jwt = getCookie(req, AUTH_COOKIE_NAMES.access);
    if (!jwt)
        throw ApiError.unauthorized('CRM browser session required');
    let payload;
    try {
        payload = verifyToken(jwt);
    }
    catch {
        throw ApiError.unauthorized('CRM browser session required');
    }
    if (!payload.sid || !mongoose.isValidObjectId(payload.sid))
        throw ApiError.unauthorized('Fresh CRM login required');
    const session = await AuthSession.findOne({ _id: payload.sid, userId: payload.sub, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).lean<any>();
    const user = await User.findById(payload.sub).select('+oauthSecurityVersion').lean<any>();
    if (!user || !session || user.status === 'disabled' || !user.organizationId)
        throw ApiError.unauthorized('Fresh CRM login required');
    const organization = await Organization.findOne({ _id: user.organizationId, status: { $in: ['active', 'trialing'] } }).lean<any>();
    if (!organization)
        throw ApiError.forbidden('Organization is unavailable');
    if (write) {
        const config = requireOAuthConfig();
        const origin = req.headers.origin;
        if (origin !== config.webOrigin || !safeTokenEqual(getCookie(req, AUTH_COOKIE_NAMES.csrf), typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : undefined))
            throw ApiError.forbidden('CSRF verification failed');
    }
    const evidence = !!session.authenticatedAt && session.securityVersionAtLogin === (user.oauthSecurityVersion ?? 0) &&
        (!user.twoFactorEnabled || (!!session.mfaVerifiedAt && session.amr?.includes('otp')));
    if (fresh && (!evidence || Date.now() - new Date(session.authenticatedAt!).getTime() > 600000))
        throw ApiError.unauthorized('Fresh CRM login required');
    return { user, session, organization, fresh: evidence && Date.now() - new Date(session.authenticatedAt!).getTime() <= 600000 };
}
export async function permittedProjects(user: any) {
    return inOrg(user.organizationId, () => Project.find({ organizationId: user.organizationId, status: 'active', ...(user.role === 'admin' ? {} : { _id: { $in: user.projectIds ?? [] } }) }).select('_id name').session(dbSession() ?? null).lean<any>());
}
export async function checkFamily(family: any) {
    if (!family || family.revokedAt || +family.expiresAt <= Date.now() || +family.idleExpiresAt <= Date.now())
        return null;
    return inOrg(family.organizationId, async () => {
        const grant = await OAuthGrant.findOne({ _id: family.grantId, organizationId: family.organizationId, userId: family.userId, projectId: family.projectId, clientId: family.clientId, revision: family.grantRevision, revokedAt: { $exists: false } }).session(dbSession() ?? null).lean<any>();
        const user = await User.findOne({ _id: family.userId, organizationId: family.organizationId, status: { $ne: 'disabled' } }).select('+oauthSecurityVersion').session(dbSession() ?? null).lean<any>();
        const organization = await Organization.findOne({ _id: family.organizationId, status: { $in: ['active', 'trialing'] } }).session(dbSession() ?? null).lean<any>();
        const client = await registryClient(family.clientId);
        const session = await AuthSession.findOne({ _id: family.sid, userId: family.userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).session(dbSession() ?? null).lean<any>();
        const project = user ? await Project.findOne({ _id: family.projectId, organizationId: family.organizationId, status: 'active', ...(user.role === 'admin' ? {} : { _id: { $eq: family.projectId, $in: user.projectIds ?? [] } }) }).session(dbSession() ?? null).lean<any>() : null;
        if (!grant || !user || !organization || !client || client.status !== 'active' || client.version !== family.clientVersion || !session || !project ||
            (user.oauthSecurityVersion ?? 0) !== family.securityVersion || session.securityVersionAtLogin !== family.securityVersion ||
            !session.authenticatedAt || (user.twoFactorEnabled && (!session.mfaVerifiedAt || !session.amr?.includes('otp'))) ||
            grant.scopes.some((scope: string) => !client.scopes.includes(scope))) {
            await OAuthTokenFamily.updateOne({ _id: family._id, organizationId: family.organizationId }, { $set: { revokedAt: new Date() } }).session(dbSession() ?? null);
            if (protocolContext.getStore())
                protocolContext.getStore()!.revoked = true;
            return null;
        }
        return { user, project, organization, grant, session, client };
    });
}
export async function oauthAudit(organizationId: unknown, action: string, actorId: unknown, targetId: unknown, detail: Record<string, unknown> = {}) {
    await inOrg(organizationId, () => AuditLog.create([{ organizationId, action, actorId, targetType: 'OAuth', targetId: String(targetId).slice(0, 80), success: true, detail }], { session: dbSession() }));
}
let readinessCache = { database: '', verifiedAt: 0 };
export async function oauthStorageReady(): Promise<boolean> {
    try {
        const c = mongoose.connection;
        if (c.readyState !== 1 || !c.db)
            return false;
        const database = c.host + ':' + c.port + '/' + c.name;
        if (readinessCache.database === database && Date.now() - readinessCache.verifiedAt < 30000)
            return true;
        const hello = await c.db.admin().command({ hello: 1 });
        if (!hello.setName && hello.msg !== 'isdbgrid')
            return false;
        for (const model of oauthModels) {
            const actual = await model.collection.listIndexes().toArray();
            for (const [key, options] of model.schema.indexes()) {
                if (!actual.some(index => JSON.stringify(index.key) === JSON.stringify(key) && (!options.unique || index.unique === true) && (options.expireAfterSeconds === undefined || index.expireAfterSeconds === options.expireAfterSeconds)))
                    return false;
            }
        }
        readinessCache = { database, verifiedAt: Date.now() };
        return true;
    }
    catch {
        return false;
    }
}
