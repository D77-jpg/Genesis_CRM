import { before, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, generateKeyPairSync, createHash, createPublicKey, verify } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inquiryFixture } from './fixtures/integration-inquiry';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
let f: Awaited<ReturnType<typeof inquiryFixture>>, models: typeof import('../src/models/OAuth');
let client: any, clientSecret: string, admin: any, viewer: Jar;
let count = 1;
const password = () => 'Fictional-C5-' + randomBytes(16).toString('hex');
let adminPassword: string;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
let spec: any;
class Jar {
    values = new Map<string, {
        name: string;
        value: string;
        path: string;
    }>();
    absorb(r: Response) { for (const c of r.headers.getSetCookie()) {
        const p = c.split(';'), at = p[0].indexOf('='), name = p[0].slice(0, at), value = p[0].slice(at + 1), path = p.find(x => x.trim().toLowerCase().startsWith('path='))?.trim().slice(5) ?? '/';
        this.values.set(name + '|' + path, { name, value, path });
    } }
    cookie(path: string) { return [...this.values.values()].filter(c => path.startsWith(c.path)).sort((a, b) => b.path.length - a.path.length).map(c => c.name + '=' + c.value).join('; '); }
    csrf() { return [...this.values.values()].find(c => c.name === 'cdlm_csrf')?.value ?? ''; }
    async req(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
        const r = await fetch(f.base + path, { method, redirect: 'manual', headers: { Cookie: this.cookie(path), Origin: f.base, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf(), 'X-Forwarded-For': '198.51.100.' + (count++ % 200 + 1), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        this.absorb(r);
        return r;
    }
    async json(path: string, method = 'GET', body?: unknown) { const r = await this.req(path, method, body); return { status: r.status, body: await r.json() as any }; }
}
async function login(username: string, pass: string) { const jar = new Jar(), r = await jar.json('/api/auth/login', 'POST', { username, password: pass }); assert.equal(r.status, 200); assert(r.body.data.user); return jar; }
before(async () => {
    f = await inquiryFixture();
    (await import('../src/config/env')).default.corsOrigins.push(f.base);
    models = await import('../src/models/OAuth');
    for (const model of models.oauthModels)
        await model.init();
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
    Object.assign(key, { kid: 'fictional-test-only', alg: 'RS256', use: 'sig' });
    const keyPath = join(f.temp, 'c5-test-keyring.json');
    await writeFile(keyPath, JSON.stringify({ keys: [key] }));
    Object.assign(process.env, { OIDC_ENABLED: 'true', OIDC_ALLOW_LOOPBACK: 'true', OIDC_ISSUER: f.base + '/oidc', OIDC_PUBLIC_WEB_ORIGIN: f.base, OIDC_SIGNING_KEYRING_PATH: keyPath, OIDC_ACTIVE_KEY_ID: 'fictional-test-only' });
    adminPassword = password();
    const p = await f.asA(async () => f.m.User.create({ organizationId: f.org._id, username: 'fictional-c5-platform', displayName: 'Fictional Operator', role: 'admin', isPlatformAdmin: true, passwordHash: await f.m.hashPassword(adminPassword), projectIds: [f.project._id] }));
    admin = await login(p.username, adminPassword);
    viewer = await login(f.viewer.username, 'Fictional-J1-Login-Only');
    const created = await admin.json('/api/oauth/clients', 'POST', { name: 'Fictional GlobalSite', operator: 'Fictional Operator', privacyUrl: 'https://site.example.test/privacy', termsUrl: 'https://site.example.test/terms', redirectUris: ['https://site.example.test/callback'], scopes: ['openid', 'profile', 'email', 'crm.context', 'offline_access'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    client = created.body.data.client;
    clientSecret = created.body.data.clientSecret;
    spec = yaml.load(await readFile(join(__dirname, '../../docs/integration/integration-v1.openapi.yaml'), 'utf8'));
});
after(async () => { mock.restoreAll(); delete process.env.OIDC_ENABLED; await f?.cleanup(); });
function validate(name: string, data: unknown) { const check = ajv.compile({ ...spec.components.schemas[name], components: spec.components }); assert(check(data), ajv.errorsText(check.errors)); }
async function start(jar: Jar, scopes = 'openid profile crm.context offline_access', overrides: Record<string,string> = {}) {
    const verifier = randomBytes(32).toString('base64url'), params = new URLSearchParams({ client_id: client.clientId, response_type: 'code', prompt: 'consent', redirect_uri: client.redirectUris[0], scope: scopes, state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    for(const [key,value]of Object.entries(overrides))params.set(key,value);
    const r = await jar.req('/oidc/auth?' + params);
    assert.equal(r.status, 303, await r.clone().text());
    const ui = new URL(r.headers.get('location')!);
    return { uid: ui.searchParams.get('uid')!, verifier, params };
}
async function authorize(jar: Jar, options: {
    projectId?: string;
    scopes?: string[];
} = {}) {
    const started = await start(jar, options.scopes?.join(' '));
    const data = await jar.json('/api/auth/oauth/interactions/' + started.uid);
    assert.equal(data.status, 200, JSON.stringify(data.body));
    validate('C5InteractionEnvelope', data.body);
    assert.equal(data.body.data.freshLoginRequired, false);
    const decision = await jar.json('/api/auth/oauth/interactions/' + started.uid + '/decision', 'POST', { decision: 'approve', projectId: options.projectId ?? String(f.project._id), scopes: options.scopes ?? ['openid', 'profile', 'crm.context', 'offline_access'] });
    assert.equal(decision.status, 200, JSON.stringify(decision.body));
    validate('C5DecisionEnvelope', decision.body);
    const resumed = await jar.req(new URL(decision.body.data.resumeUrl).pathname);
    assert.equal(resumed.status, 303, await resumed.clone().text());
    const target = new URL(resumed.headers.get('location')!);
    assert.equal(target.origin, 'https://site.example.test');
    assert.equal(target.searchParams.get('state'), started.params.get('state'));
    assert.equal(target.searchParams.get('iss'), f.base + '/oidc');
    assert(target.searchParams.get('code'), target.searchParams.get('error') ?? 'Missing code');
    return { ...started, code: target.searchParams.get('code')! };
}
async function token(params: Record<string, string>, secret = clientSecret) {
    const r = await fetch(f.base + '/oidc/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(client.clientId + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '203.0.113.' + (count++ % 200 + 1) }, body: new URLSearchParams(params) });
    return { status: r.status, body: await r.json() as any };
}
const exchange = (x: {
    code: string;
    verifier: string;
}) => token({ grant_type: 'authorization_code', code: x.code, code_verifier: x.verifier, redirect_uri: client.redirectUris[0] });
async function info(access: string) { const r = await fetch(f.base + '/oidc/me', { headers: { Authorization: 'Bearer ' + access, 'X-Forwarded-For': '203.0.113.' + (count++ % 200 + 1) } }); return { status: r.status, body: await r.json() as any }; }
test('C5 discovery, public keys and Cookie-only client administration match the frozen contract', async () => {
    for (const [path, name] of [['/oidc/.well-known/openid-configuration', 'C5Discovery'], ['/oidc/jwks', 'C5Jwks']]) {
        const r = await fetch(f.base + path);
        assert.equal(r.status, 200);
        const body = await r.json();
        validate(name, body);
        assert(!JSON.stringify(body).includes('"d":'));
    }
    assert.equal((await viewer.json('/api/oauth/clients')).status, 403);
    const bearer = await fetch(f.base + '/api/oauth/clients', { headers: { Authorization: 'Bearer ' + f.tokenFor(f.manager) } });
    assert.equal(bearer.status, 401);
    const csrf = await admin.req('/api/oauth/clients', 'POST', {}, { 'X-CSRF-Token': '' });
    assert.equal(csrf.status, 403);
    const list = await admin.json('/api/oauth/clients');
    assert.equal(list.status, 200);
    validate('C5ClientListEnvelope', list.body);
    assert(!JSON.stringify(list.body).includes(clientSecret));
    const db = await f.asA(() => models.OAuthClient.findOne({ clientId: client.clientId }).select('+secretHash').lean());
    assert(!JSON.stringify(db).includes(clientSecret));
});
test('C5 real HTTP: PKCE rejects incorrect verifier; code once, userinfo scope and identity match', async () => {
    const issued = await authorize(viewer);
    const wrong = await exchange({ ...issued, verifier: 'x'.repeat(43) });
    assert.equal(wrong.status, 400);
    const good = await exchange(issued);
    assert.equal(good.status, 200, JSON.stringify(good.body));
    validate('C5Token', good.body);
    const user = await info(good.body.access_token);
    assert.equal(user.status, 200, JSON.stringify(user.body));
    validate('C5UserInfo', user.body);
    assert.equal(user.body.crm_context.project_id, String(f.project._id));
    assert(!('email' in user.body));
    assert(!('role' in user.body));
    const jwt = JSON.parse(Buffer.from(good.body.id_token.split('.')[1], 'base64url').toString());
    assert.equal(jwt.sub, user.body.sub);
    assert.equal(jwt.nonce, issued.params.get('nonce'));
    assert.equal(jwt.aud, client.clientId);
    const keys = await (await fetch(f.base + '/oidc/jwks')).json() as any;
    const parts = good.body.id_token.split('.'), header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const key = createPublicKey({ key: keys.keys.find((k: any) => k.kid === header.kid), format: 'jwk' });
    assert(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url')));
    assert(!verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1] + 'tamper'), key, Buffer.from(parts[2], 'base64url')));
    assert.equal((await exchange(issued)).status, 400);
    assert.equal((await info(good.body.access_token)).status, 401);
    for (const m of [models.OAuthAuthorizationCode, models.OAuthAccessToken, models.OAuthRefreshToken]) {
        const raw = await f.asA(() => m.find({}).select('+payload').lean());
        for (const secret of [issued.code, good.body.access_token, good.body.refresh_token])
            assert(!JSON.stringify(raw).includes(secret));
    }
});
test('C5 refresh rotation and replay revoke newly issued tokens', async () => {
    const x = await exchange(await authorize(viewer));
    assert.equal(x.status, 200);
    assert.equal((await token({ grant_type: 'refresh_token', refresh_token: x.body.refresh_token, scope: 'profile' })).status, 400);
    const next = await token({ grant_type: 'refresh_token', refresh_token: x.body.refresh_token });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.notEqual(next.body.refresh_token, x.body.refresh_token);
    assert.equal((await token({ grant_type: 'refresh_token', refresh_token: x.body.refresh_token })).status, 400);
    assert.equal((await info(next.body.access_token)).status, 401);
});
test('C5 cross-organization / unauthorized project is rejected, and viewer can revoke only own grant', async () => {
    const x = await start(viewer);
    assert.equal((await viewer.json('/api/auth/oauth/interactions/' + x.uid + '/decision', 'POST', { decision: 'approve', projectId: String(f.other._id) })).status, 403);
    const allowed = await exchange(await authorize(viewer));
    assert.equal(allowed.status, 200);
    const list = await viewer.json('/api/auth/oauth/applications');
    assert.equal(list.status, 200);
    validate('C5GrantListEnvelope', list.body);
    const grant = list.body.data.items[0];
    const foreignPassword = password();
    const foreignUser = await f.tenant.runWithTenant({ organizationId: String(f.foreign._id) }, async () => f.m.User.create({ organizationId: f.foreign._id, username: 'fictional-c5-foreign', role: 'admin', passwordHash: await f.m.hashPassword(foreignPassword), projectIds: [f.other._id] }));
    const foreignJar = await login(foreignUser.username, foreignPassword);
    assert.equal((await foreignJar.json('/api/auth/oauth/applications/' + grant.id + '/revoke', 'POST', {})).status, 404);
    assert.equal((await foreignJar.json('/api/auth/oauth/applications')).body.data.items.length, 0);
    assert.equal((await admin.json('/api/auth/oauth/applications/' + grant.id + '/revoke', 'POST', {})).status, 404);
    assert.equal((await viewer.json('/api/auth/oauth/applications/' + grant.id + '/revoke', 'POST', {})).status, 200);
    assert.equal((await info(allowed.body.access_token)).status, 401);
});
test('C5 no offline consent yields no refresh; expired session and changed security version reject tokens', async () => {
    const x = await exchange(await authorize(viewer, { scopes: ['openid'] }));
    assert.equal(x.status, 200);
    assert(!x.body.refresh_token);
    assert.deepEqual(Object.keys((await info(x.body.access_token)).body), ['sub']);
    await f.asA(() => f.m.User.updateOne({ _id: f.viewer._id }, { $inc: { oauthSecurityVersion: 1 } }));
    assert.equal((await info(x.body.access_token)).status, 401);
    const stale = await start(viewer);
    assert.equal((await viewer.json('/api/auth/oauth/interactions/' + stale.uid)).body.data.freshLoginRequired, true);
    viewer = await login(f.viewer.username, 'Fictional-J1-Login-Only');
});
test('C5 optional unconfigured OAuth leaves legacy CRM health and login available', async () => {
    process.env.OIDC_ENABLED = 'false';
    assert.equal((await fetch(f.base + '/oidc/jwks')).status, 503);
    assert.equal((await fetch(f.base + '/api/health/live')).status, 200);
    assert.equal((await admin.json('/api/oauth/clients')).status, 503);
    process.env.OIDC_ENABLED = 'true';
});
test('C5 authorization validation rejects plain PKCE, invalid redirect and missing nonce', async () => {
    const { allowedRedirect } = await import('../src/services/oauth-core');
    assert.equal(allowedRedirect('https://127.0.0.1/callback', false), false);
    assert.equal(allowedRedirect('http://127.0.0.1:5173/callback', true), true);
    assert.equal(allowedRedirect('https://10.0.0.1/callback', true), false);
    const base = { client_id: client.clientId, response_type: 'code', redirect_uri: client.redirectUris[0], scope: 'openid', state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), code_challenge: randomBytes(32).toString('base64url'), code_challenge_method: 'S256' };
    for (const change of [{ code_challenge_method: 'plain' }, { redirect_uri: 'https://attacker.example.test/callback' }, { nonce: '' }, { scope: 'openid products:read' }]) {
        const r = await viewer.req('/oidc/auth?' + new URLSearchParams({ ...base, ...change }));
        assert.equal(r.status, 400);
        assert(!r.headers.has('location'));
    }
    assert.equal((await fetch(f.base + '/oidc/me', { headers: { Authorization: 'Bearer ' + f.issued.token } })).status, 401);
});
test('C5 concurrent code redemption commits at most one token set', async () => {
    const issued = await authorize(viewer), results = await Promise.all([exchange(issued), exchange(issued)]);
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert(results.every(r => [200, 400, 503].includes(r.status)));
    const code = await f.asA(() => models.OAuthAuthorizationCode.findOne({ idHash: createHash('sha256').update(issued.code).digest('hex') }).lean());
    assert.equal(await f.asA(() => models.OAuthAccessToken.countDocuments({ grantId: code!.grantId })), 1);
});
test('C5 token storage failure aborts code consumption and leaves retry possible', async () => {
    const issued = await authorize(viewer);
    const failure = mock.method(models.OAuthAccessToken, 'updateOne', () => { throw Error('Fictional storage failure'); });
    const failed = await exchange(issued);
    assert.equal(failed.status, 503);
    failure.mock.restore();
    const code = await f.asA(() => models.OAuthAuthorizationCode.findOne({ idHash: createHash('sha256').update(issued.code).digest('hex') }).lean());
    assert(!code!.consumedAt);
    assert.equal((await exchange(issued)).status, 200);
});
test('C5 code and access token expiration are enforced without relying on TTL deletion', async () => {
    let issued = await authorize(viewer);
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    mock.timers.tick(61000);
    assert.equal((await exchange(issued)).status, 400);
    mock.timers.reset();
    issued = await authorize(viewer);
    const good = await exchange(issued);
    assert.equal(good.status, 200);
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    mock.timers.tick(601000);
    assert.equal((await info(good.body.access_token)).status, 401);
    mock.timers.reset();
});
test('C5 two-step verification is required and its proof is carried into the ID Token', async () => {
    let code = '';
    mock.method(console, 'warn', (message: unknown) => { code = /\b\d{6}\b/.exec(String(message))?.[0] ?? code; });
    const pass = password(), user = await f.asA(async () => f.m.User.create({ organizationId: f.org._id, username: 'fictional-c5-otp', displayName: 'Fictional OTP User', email: 'fictional-otp@example.test', twoFactorEnabled: true, role: 'viewer', passwordHash: await f.m.hashPassword(pass), projectIds: [f.project._id] }));
    const jar = new Jar(), challenge = await jar.json('/api/auth/login', 'POST', { username: user.username, password: pass });
    assert(challenge.body.data.twoFactorRequired);
    const started = await start(jar);
    assert.equal((await jar.json('/api/auth/oauth/interactions/' + started.uid)).status, 401);
    assert.equal((await jar.json('/api/auth/login/verify-2fa', 'POST', { challengeId: challenge.body.data.challengeId, code })).status, 200);
    const token = await exchange(await authorize(jar, { scopes: ['openid', 'email'] }));
    assert.equal(token.status, 200);
    const payload = JSON.parse(Buffer.from(token.body.id_token.split('.')[1], 'base64url').toString());
    assert(payload.amr.includes('otp'));
    assert(payload.auth_time);
    const profile = await info(token.body.access_token);
    assert.equal(profile.body.email_verified, false);
    assert.equal(profile.body.email, 'fictional-otp@example.test');
    await f.asA(() => f.m.User.updateOne({ _id: user._id }, { $inc: { oauthSecurityVersion: 1 }, $set: { twoFactorEnabled: false } }));
    assert.equal((await info(token.body.access_token)).status, 401);
    mock.restoreAll();
});
test('C5 shared Mongo rate limit enforces client and subject budget', async () => {
    const good = await exchange(await authorize(viewer));
    assert.equal(good.status, 200);
    const minute = Math.floor(Date.now() / 60000), keyHash = createHash('sha256').update('userinfo:client:' + client.clientId + ':' + String(f.viewer._id)).digest('hex');
    await f.asA(() => models.OAuthRateBucket.updateOne({ organizationId: f.org._id, keyHash, minute }, { $set: { count: 300, cleanupAt: new Date(Date.now() + 120000) } }, { upsert: true }));
    const denied = await fetch(f.base + '/oidc/me', { headers: { Authorization: 'Bearer ' + good.body.access_token } });
    assert.equal(denied.status, 429);
    assert(Number(denied.headers.get('retry-after')) > 0);
    await f.asA(() => models.OAuthRateBucket.deleteOne({ organizationId: f.org._id, keyHash, minute }));
});
test('C5 prompt=login and max_age=0 require a new CRM login and then allow consent', async () => {
 const started=await start(viewer,'openid',{prompt:'login',max_age:'0'});
 const path='/api/auth/oauth/interactions/'+started.uid;
 assert.equal((await viewer.json(path)).body.data.freshLoginRequired,true);
 const logged=await viewer.json('/api/auth/login','POST',{username:f.viewer.username,password:'Fictional-J1-Login-Only'});
 assert.equal(logged.status,200);
 assert.equal((await viewer.json(path)).body.data.freshLoginRequired,false);
 const approved=await viewer.json(path+'/decision','POST',{decision:'approve',projectId:String(f.project._id),scopes:['openid']});
 assert.equal(approved.status,200);
 const resumed=await viewer.req(new URL(approved.body.data.resumeUrl).pathname);assert.equal(resumed.status,303);
 assert(new URL(resumed.headers.get('location')!).searchParams.get('code'));
});

test('C5 token revocation and client secret rotation enforce live state', async () => {
    const good = await exchange(await authorize(viewer));
    assert.equal(good.status, 200);
    const revoke = await fetch(f.base + '/oidc/token/revocation', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(client.clientId + ':' + clientSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: good.body.refresh_token, token_type_hint: 'refresh_token' }) });
    assert.equal(revoke.status, 200);
    assert.equal((await info(good.body.access_token)).status, 401);
    const old = clientSecret, rotated = await admin.json('/api/oauth/clients/' + client.clientId + '/rotate-secret', 'POST', { graceSeconds: 60 });
    assert.equal(rotated.status, 200);
    clientSecret = rotated.body.data.clientSecret;
    let grant = await authorize(viewer);
    assert.equal((await token({ grant_type: 'authorization_code', code: grant.code, code_verifier: grant.verifier, redirect_uri: client.redirectUris[0] }, old)).status, 200);
    await f.asA(() => models.OAuthClient.updateOne({ clientId: client.clientId }, { $set: { previousValidUntil: new Date(0) } }));
    grant = await authorize(viewer);
    assert.equal((await token({ grant_type: 'authorization_code', code: grant.code, code_verifier: grant.verifier, redirect_uri: client.redirectUris[0] }, old)).status, 401);
    assert.equal((await exchange(grant)).status, 200);
    const disabled = await admin.req('/api/oauth/clients/' + client.clientId, 'PATCH', { status: 'disabled' });
    assert.equal(disabled.status, 200);
    assert.equal((await viewer.json('/api/auth/oauth/applications')).status, 200);
});
