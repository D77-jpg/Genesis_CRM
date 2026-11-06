import type { Application, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { runWithTenant } from '../models/tenant-context';
import { OAuthAdapter } from './oauth-adapter';
import { OAuthInteraction, OAuthSubject, OAuthRateBucket, OAuthAccessToken } from '../models/OAuth';
import { oauthStorageReady, checkFamily, hash, inOrg, internalClientSecret, locateFamily, oauthConfig, protocolContext, registryClient, secretMatches, opaque, type ProtocolTransaction } from './oauth-core';
let instance: any;
let fingerprint: string;
export function oauthProvider(): any {
    const config = oauthConfig();
    if (!config)
        return null;
    const nextFingerprint = hash(JSON.stringify([config.issuer, config.jwks]));
    if (instance && fingerprint === nextFingerprint)
        return instance;
    // Node >=22.12 supports require(ESM); keep the rest of CRM CommonJS.
    const { Provider, errors } = require('oidc-provider');
    const provider = new Provider(config.issuer, {
        adapter: OAuthAdapter, jwks: config.jwks, responseTypes: ['code'], subjectTypes: ['pairwise'],
        clientAuthMethods: ['client_secret_basic'], scopes: ['openid', 'profile', 'email', 'crm.context', 'offline_access'],
        claims: { openid: ['sub', 'amr', 'auth_time'], profile: ['name'], email: ['email', 'email_verified'], 'crm.context': ['crm_context'], auth_time: null, amr: null },
        pkce: { methods: ['S256'], required: () => true },
        cookies: { keys: [createHash('sha256').update('oauth-cookie:' + JSON.stringify(config.jwks)).digest('hex')],
            names: { session: 'crm_oidc_session', interaction: 'crm_oidc_interaction', resume: 'crm_oidc_resume' },
            short: { path: '/', httpOnly: true, sameSite: 'lax', secure: !config.local },
            long: { path: '/', httpOnly: true, sameSite: 'lax', secure: !config.local } },
        features: { dPoP: { enabled: false }, devInteractions: { enabled: false }, revocation: { enabled: true }, rpInitiatedLogout: { enabled: false },
            pushedAuthorizationRequests: { enabled: false }, resourceIndicators: { enabled: false } },
        enabledJWA: { idTokenSigningAlgValues: ['RS256'] }, acceptQueryParamAccessTokens: false,
        discovery: { response_modes_supported: ['query'] },
        clientBasedCORS: () => false, clockTolerance: 0, allowOmittingSingleRegisteredRedirectUri: false,
        ttl: {
            AccessToken: (_ctx: any, token: any) => remaining(token.grantId, 600),
            AuthorizationCode: 60, IdToken: 300, Interaction: 600, Session: 1800,
            Grant: (_ctx: any, token: any) => remaining(token.jti, 30 * 86400),
            RefreshToken: (_ctx: any, token: any) => remaining(token.grantId, 7 * 86400)
        },
        formats: { bitsOfOpaqueRandomness: 256 }, rotateRefreshToken: (ctx: any) => {
            if (ctx.oidc.params.scope && !String(ctx.oidc.params.scope).split(' ').includes('openid'))
                throw new errors.InvalidScope('openid is required');
            return true;
        },
        expiresWithSession: () => false,
        issueRefreshToken: (_ctx: any, client: any, source: any) => client.grantTypeAllowed('refresh_token') && source.scopes.has('offline_access'),
        interactions: { url: (_ctx: any, interaction: any) => config.webOrigin + '/oauth/authorize?uid=' + encodeURIComponent(interaction.uid) },
        loadExistingGrant: (ctx: any) => ctx.oidc.result?.consent?.grantId ? provider.Grant.find(ctx.oidc.result.consent.grantId) : undefined, // Every new login requires explicit consent.
        pairwiseIdentifier: async (_ctx: any, accountId: string, client: any) => {
            const family = await locateFamily(accountId);
            if (!family)
                throw Error('Invalid identity');
            const sector = new URL(client.redirectUris[0]).hostname;
            return inOrg(family.organizationId, async () => {
                const subject = await OAuthSubject.findOneAndUpdate({ organizationId: family.organizationId, userId: family.userId, sector }, { $setOnInsert: { sub: opaque() } }, { new: true, upsert: true, session: protocolContext.getStore()?.session });
                return subject.sub;
            });
        },
        findAccount: async (_ctx: any, accountId: string) => {
            if (_ctx?.oidc?.params?.grant_type === 'authorization_code' && !/^[A-Za-z0-9._~-]{43,128}$/.test(_ctx.oidc.params.code_verifier ?? ''))
                throw new errors.InvalidGrant('Invalid PKCE verifier');
            const family = await locateFamily(accountId), identity = await checkFamily(family);
            if (!identity)
                return undefined;
            return { accountId, claims: async () => ({
                    sub: accountId,
                    ...(identity.user.displayName ? { name: identity.user.displayName } : {}),
                    ...(identity.user.email ? { email: identity.user.email, email_verified: false } : {}),
                    crm_context: { organization_id: String(family.organizationId), organization_name: identity.organization.name,
                        project_id: String(family.projectId), project_name: identity.project.name }
                }) };
        },
        renderError: (ctx: any) => { ctx.type = 'application/json'; ctx.body = { error: 'invalid_request' }; }
    });
    provider.proxy = true;
    provider.on('server_error', () => undefined); // Never log protocol exception objects.
    provider.use(async (ctx: any, next: () => Promise<void>) => {
        ctx.set('Cache-Control', 'no-store');
        ctx.set('Pragma', 'no-cache');
        ctx.set('Referrer-Policy', 'no-referrer');
        ctx.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        // The HTTP boundary verifies the real hashed secret on every request.
        if (['/token', '/token/revocation'].includes(ctx.path)) {
            let decoded: string[] = [];
            try {
                const header = ctx.headers.authorization ?? '';
                if (!/^Basic [A-Za-z0-9+/]+=*$/.test(header))
                    throw Error();
                const raw = Buffer.from(header.slice(6), 'base64').toString('utf8'), at = raw.indexOf(':');
                if (at < 0)
                    throw Error();
                decoded = [raw.slice(0, at), raw.slice(at + 1)].map(v => decodeURIComponent(v.replace(/\+/g, ' ')));
            }
            catch {
                ctx.status = 401;
                ctx.body = { error: 'invalid_client' };
                return;
            }
            const client = await registryClient(decoded[0]);
            if (!client || client.status !== 'active' || !(secretMatches(decoded[1], client.secretHash) ||
                (client.previousValidUntil && +client.previousValidUntil > Date.now() && secretMatches(decoded[1], client.previousSecretHash)))) {
                ctx.status = 401;
                ctx.set('WWW-Authenticate', 'Basic');
                ctx.body = { error: 'invalid_client' };
                return;
            }
            ctx.req.headers.authorization = 'Basic ' + Buffer.from(encodeURIComponent(client.clientId) + ':' + encodeURIComponent(internalClientSecret(client.clientId))).toString('base64');
            ctx.state.crmClient = client;
        }
        if (ctx.path === '/auth') {
            // CRM is the sole login authority. Start each consent with a fresh protocol
            // session instead of reusing an OIDC account whose CRM grant may be revoked.
            ctx.req.headers.cookie = (ctx.req.headers.cookie ?? '').split(';').filter((p: string) => !/^crm_oidc_session(?:\.sig)?=/.test(p.trim())).join(';');
            const params = new URLSearchParams(ctx.querystring);
            const client = await registryClient(params.get('client_id') ?? '');
            // Reject before the library caches or resolves any caller-controlled metadata.
            if (!client || client.status !== 'active' || [...params.keys()].some(k => params.getAll(k).length !== 1) ||
                !client.redirectUris.includes(params.get('redirect_uri')) ||
                !params.get('state') || params.get('state')!.length < 32 || params.get('state')!.length > 512 ||
                !params.get('nonce') || params.get('nonce')!.length < 32 || params.get('nonce')!.length > 512 ||
                params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' ||
                !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '') ||
                !params.get('scope')?.split(' ').includes('openid') || params.get('scope')!.split(' ').some(s => !client.scopes.includes(s)) ||
                [...params.keys()].some(k => !['client_id', 'response_type', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method', 'prompt', 'max_age'].includes(k))) {
                ctx.status = 400;
                ctx.body = { error: 'invalid_request' };
                return;
            }
            ctx.state.crmClient = client;
        }
        if (ctx.path.startsWith('/auth/')) {
            ctx.req.headers.cookie = (ctx.req.headers.cookie ?? '').split(';').filter((p: string) => !/^crm_oidc_session(?:\.sig)?=/.test(p.trim())).join(';');
            const uid = ctx.path.split('/').pop();
            const row = await runWithTenant({ bypass: false, source: 'oauth-resume-resolver' }, () => OAuthInteraction.findOne({ kind: 'Interaction', idHash: hash(uid ?? ''), expiresAt: { $gt: new Date() } }).select('clientId').lean<any>());
            if (!row) {
                ctx.status = 400;
                ctx.body = { error: 'invalid_request' };
                return;
            }
            const client = await registryClient(row.clientId);
            if (!client || client.status !== 'active') {
                ctx.status = 400;
                ctx.body = { error: 'invalid_request' };
                return;
            }
            ctx.state.crmClient = client;
        }
        if (ctx.path === '/me') {
            const bearer = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(ctx.headers.authorization ?? '');
            const row = bearer ? await runWithTenant({ bypass: false, source: 'oauth-rate-resolver' }, () => OAuthAccessToken.findOne({ kind: 'AccessToken', idHash: hash(bearer[1]) }).select('grantId').lean<any>()) : null;
            const family = row ? await locateFamily(row.grantId) : null;
            if (family) {
                ctx.state.crmClient = await registryClient(family.clientId);
                ctx.state.crmRateSubject = String(family.userId);
            }
        }
        const registry = ctx.state.crmClient;
        if (registry) {
            const group = ctx.path === '/auth' ? 'authorize' : ctx.path === '/me' ? 'userinfo' : 'token';
            const minute = Math.floor(Date.now() / 60000);
            const counters: [
                string,
                number
            ][] = [[group + ':ip:' + ctx.ip, group === 'authorize' ? 30 : group === 'userinfo' ? 300 : 60],
                [group + ':client:' + registry.clientId + (ctx.state.crmRateSubject ? ':' + ctx.state.crmRateSubject : ''), group === 'authorize' ? 300 : group === 'userinfo' ? 300 : 120]];
            try {
                for (const [key, maximum] of counters) {
                    const filter = { organizationId: registry.organizationId, keyHash: hash(key), minute };
                    let bucket: any;
                    try {
                        bucket = await inOrg(registry.organizationId, () => OAuthRateBucket.findOneAndUpdate(filter, { $inc: { count: 1 }, $setOnInsert: { cleanupAt: new Date((minute + 2) * 60000) } }, { upsert: true, new: true }).lean<any>());
                    }
                    catch (error) {
                        if ((error as {
                            code?: number;
                        }).code !== 11000)
                            throw error;
                        bucket = await inOrg(registry.organizationId, () => OAuthRateBucket.findOneAndUpdate(filter, { $inc: { count: 1 } }, { new: true }).lean<any>());
                    }
                    if (!bucket || bucket.count > maximum) {
                        ctx.status = 429;
                        ctx.set('Retry-After', String(60 - Math.floor(Date.now() / 1000) % 60));
                        ctx.body = { error: 'temporarily_unavailable' };
                        return;
                    }
                }
            }
            catch {
                ctx.status = 503;
                ctx.body = { error: 'temporarily_unavailable' };
                return;
            }
        }
        const session = await mongoose.startSession();
        const state: ProtocolTransaction = { session, queue: Promise.resolve(), revoked: false, tokenWrites: 0, client: registry, registryOrg: registry ? String(registry.organizationId) : undefined };
        session.startTransaction();
        try {
            await protocolContext.run(state, next);
            await state.queue;
            if (ctx.status === 200 && ['/jwks', '/.well-known/openid-configuration'].includes(ctx.path)) {
                ctx.set('Cache-Control', 'public, max-age=300');
                ctx.remove('Pragma');
            }
            if (ctx.status >= 500) {
                ctx.status = 503;
                ctx.body = { error: 'temporarily_unavailable' };
            }
            if (ctx.status >= 400 && !(state.revoked && state.tokenWrites === 0))
                await session.abortTransaction();
            else
                await session.commitTransaction();
        }
        catch {
            if (session.inTransaction())
                await session.abortTransaction();
            ctx.status = 503;
            ctx.body = { error: 'temporarily_unavailable' };
        }
        finally {
            await session.endSession();
        }
    });
    instance = provider;
    fingerprint = nextFingerprint;
    return provider;
}
function remaining(_key: string, cap: number) { return cap; }
export function mountOAuth(app: Application) {
    const limit = rateLimit({ windowMs: 60000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'temporarily_unavailable' } });
    app.use('/oidc', limit, async (req: Request, res: Response) => {
        const allowed = (req.method === 'GET' && ['/auth', '/me', '/jwks', '/.well-known/openid-configuration'].includes(req.path)) ||
            (req.method === 'GET' && /^\/auth\/[A-Za-z0-9_-]{20,256}$/.test(req.path)) ||
            (req.method === 'POST' && ['/token', '/token/revocation'].includes(req.path));
        if (!allowed) {
            res.status(404).json({ error: 'invalid_request' });
            return;
        }
        if (!oauthConfig() || !await oauthStorageReady()) {
            res.status(503).json({ error: 'temporarily_unavailable' });
            return;
        }
        let provider: any;
        try {
            provider = oauthProvider();
        }
        catch {
            provider = null;
        }
        if (!provider) {
            res.status(503).set('Cache-Control', 'no-store').json({ error: 'temporarily_unavailable' });
            return;
        }
        Promise.resolve(provider.callback()(req, res)).catch(() => { if (!res.headersSent)
            res.status(503).json({ error: 'temporarily_unavailable' }); });
    });
}
