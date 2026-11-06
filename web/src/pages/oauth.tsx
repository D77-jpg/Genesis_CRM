import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';
import { oauthRequest, OAuthUiError } from '@/lib/oauth-api';
import { API_BASE_URL, apiPost } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogBody } from '@/components/ui/dialog';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { usePageTitle } from '@/hooks/use-ui';
const scopes = ['openid', 'profile', 'email', 'crm.context', 'offline_access'];
const selectClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring';
type ErrorKey = 'oauth.failed' | 'oauth.expired' | 'oauth.unavailable' | 'oauth.forbidden' | 'oauth.freshLogin';
function errorKey(error: unknown): ErrorKey {
    if (error instanceof OAuthUiError) {
        if (error.status === 401)
            return 'oauth.freshLogin';
        if (error.status === 403)
            return 'oauth.forbidden';
        if (error.status === 404 || error.status === 409)
            return 'oauth.expired';
        if (error.status === 503)
            return 'oauth.unavailable';
    }
    return 'oauth.failed';
}
function useRelogin() {
    const navigate = useNavigate(), location = useLocation();
    return async () => { try {
        await apiPost('/auth/logout');
    }
    catch {
        return;
    } useAuthStore.getState().handleSessionExpired(); navigate('/login', { replace: true, state: { from: location.pathname + location.search } }); };
}
interface Consent {
    uid: string;
    identity: {
        name: string;
        organizationName: string;
    };
    application: {
        clientId: string;
        name: string;
        operator: string;
        redirectHost: string;
        privacyUrl: string;
        termsUrl: string;
    };
    scopes: string[];
    projects: {
        id: string;
        name: string;
    }[];
    freshLoginRequired: boolean;
}
export function OAuthConsentPage(): React.JSX.Element {
    const { t } = useI18n(), [params] = useSearchParams(), relogin = useRelogin();
    const uid = params.get('uid') ?? '', [data, setData] = React.useState<Consent | null>(null), [error, setError] = React.useState<ErrorKey | null>(null);
    const [project, setProject] = React.useState(''), [selected, setSelected] = React.useState<string[]>([]), [busy, setBusy] = React.useState(false), [reload, setReload] = React.useState(0);
    usePageTitle(t('oauth.consentTitle'));
    React.useEffect(() => { let live = true; setError(null); void oauthRequest<Consent>('/auth/oauth/interactions/' + encodeURIComponent(uid)).then(x => { if (live) {
        setData(x);
        setSelected(x.scopes.filter(s => s !== 'offline_access'));
    } }).catch(e => { if (live)
        setError(errorKey(e)); }); return () => { live = false; }; }, [uid, reload]);
    const submit = async (decision: 'approve' | 'deny') => {
        setBusy(true);
        setError(null);
        try {
            const result = await oauthRequest<{
                resumeUrl: string;
            }>('/auth/oauth/interactions/' + encodeURIComponent(uid) + '/decision', 'POST', { decision, ...(decision === 'approve' ? { projectId: project, scopes: selected } : {}) });
            const target = new URL(result.resumeUrl), apiOrigin = new URL(API_BASE_URL, window.location.origin).origin;
            if (target.origin !== apiOrigin || !/^\/oidc\/auth\/[A-Za-z0-9_-]+$/.test(target.pathname))
                throw Error();
            window.location.assign(target.href);
        }
        catch (e) {
            setError(errorKey(e));
            setBusy(false);
        }
    };
    return <main className="min-h-screen bg-muted/30 px-4 py-10"><div className="mx-auto max-w-2xl space-y-6">
  <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><ShieldCheck aria-hidden className="h-5 w-5"/>GlobalCRM</span><LanguageToggle /></div>
  <Card><CardHeader><CardTitle>{t('oauth.consentTitle')}</CardTitle><p className="text-sm text-muted-foreground">{t('oauth.consentDescription')}</p></CardHeader>
   <CardContent className="space-y-6">
    {error && <div role="alert" className="space-y-3 text-sm text-destructive"><p>{t(error)}</p><Button className="min-h-11" variant="outline" onClick={() => setReload(v => v + 1)}>{t('oauth.reload')}</Button></div>}
    {!data && !error && <p role="status">{t('common.loading')}</p>}
    {(error === 'oauth.freshLogin' || data?.freshLoginRequired) && <div className="space-y-3"><p>{t('oauth.freshLogin')}</p><Button className="min-h-11" disabled={busy} onClick={() => void relogin()}>{t('oauth.relogin')}</Button></div>}
    {data && <><dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-[auto_1fr]">
     <dt className="text-muted-foreground">{t('oauth.application')}</dt><dd className="break-words font-medium">{data.application.name}</dd>
     <dt className="text-muted-foreground">{t('oauth.operator')}</dt><dd>{data.application.operator}</dd>
     <dt className="text-muted-foreground">{t('oauth.callback')}</dt><dd className="break-all">{data.application.redirectHost}</dd>
     <dt className="text-muted-foreground">{t('oauth.identity')}</dt><dd>{data.identity.name} · {data.identity.organizationName}</dd>
    </dl>
    <div className="space-y-2"><Label htmlFor="oauth-project">{t('oauth.project')}</Label><select id="oauth-project" className={selectClass} value={project} onChange={e => setProject(e.target.value)} disabled={busy || data.freshLoginRequired}>
     <option value="">{t('oauth.chooseProject')}</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{!data.projects.length && <p role="alert" className="text-sm text-destructive">{t('oauth.noProjects')}</p>}</div>
    <fieldset disabled={busy || data.freshLoginRequired}><legend className="mb-2 font-medium">{t('oauth.permissions')}</legend>{data.scopes.map(scope => <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-3 py-2"><input className="h-4 w-4 accent-primary" type="checkbox" checked={selected.includes(scope)} disabled={scope === 'openid'} onChange={e => setSelected(s => e.target.checked ? [...s, scope] : s.filter(x => x !== scope))}/><span className="text-sm">{t(('oauth.' + scope) as TranslationKey)}</span></label>)}</fieldset>
    <p className="text-sm text-muted-foreground">{t('oauth.keepSeparate')} {t('oauth.noAutoLink')}</p>
    <div className="flex gap-4 text-sm"><a className="underline" href={data.application.privacyUrl} target="_blank" rel="noopener noreferrer">{t('oauth.privacy')}</a><a className="underline" href={data.application.termsUrl} target="_blank" rel="noopener noreferrer">{t('oauth.terms')}</a></div>
    <div className="flex flex-wrap justify-end gap-3"><Button className="min-h-11" variant="outline" disabled={busy || data.freshLoginRequired} onClick={() => void submit('deny')}>{t('oauth.deny')}</Button><Button className="min-h-11" disabled={busy || data.freshLoginRequired || !project} onClick={() => void submit('approve')}>{busy ? t('oauth.busy') : t('oauth.approve')}</Button></div></>}
   </CardContent>
  </Card>
 </div></main>;
}
interface Grant {
    id: string;
    clientId: string;
    clientName: string;
    operator: string;
    projectName: string;
    scopes: string[];
    status: 'active' | 'revoked' | 'expired';
    createdAt: string;
    lastUsedAt: string | null;
}
export function OAuthApplicationsPage(): React.JSX.Element {
    const { t, language } = useI18n(), relogin = useRelogin();
    const [items, setItems] = React.useState<Grant[]>([]), [cursor, setCursor] = React.useState(''), [next, setNext] = React.useState<string | null>(null), [reload, setReload] = React.useState(0);
    const [error, setError] = React.useState<ErrorKey | null>(null), [loading, setLoading] = React.useState(true), [target, setTarget] = React.useState<Grant | null>(null), [busy, setBusy] = React.useState(false);
    usePageTitle(t('oauth.title'));
    React.useEffect(() => { let live = true; setLoading(true); setError(null); void oauthRequest<{
        items: Grant[];
        nextCursor: string | null;
    }>('/auth/oauth/applications?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')).then(x => { if (live) {
        setItems(x.items);
        setNext(x.nextCursor);
    } }).catch(e => { if (live)
        setError(errorKey(e)); }).finally(() => { if (live)
        setLoading(false); }); return () => { live = false; }; }, [cursor, reload]);
    const revoke = async () => { if (!target)
        return; setBusy(true); try {
        await oauthRequest('/auth/oauth/applications/' + target.id + '/revoke', 'POST', {});
        setTarget(null);
        setReload(v => v + 1);
    }
    catch (e) {
        setError(errorKey(e));
    }
    finally {
        setBusy(false);
    } };
    const date = (s: string | null) => s ? new Date(s).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US') : t('oauth.never');
    return <div className="space-y-6"><PageHeader title={t('oauth.title')} description={t('oauth.description')} actions={<Button className="min-h-11" variant="outline" onClick={() => { setCursor(''); setReload(v => v + 1); }}>{t('oauth.refresh')}</Button>}/>
  {error && <p role="alert" className="text-destructive">{t(error)}</p>}{error === 'oauth.freshLogin' && <Button className="min-h-11" onClick={() => void relogin()}>{t('oauth.relogin')}</Button>}
  {loading ? <p role="status">{t('common.loading')}</p> : !items.length ? <Card><CardContent className="py-8">{t('oauth.noApps')}</CardContent></Card> : items.map(item => <Card key={item.id}><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><CardTitle>{item.clientName}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{item.operator} · {item.projectName}</p></div><Badge variant="secondary">{t(item.status === 'active' ? 'oauth.active' : item.status === 'revoked' ? 'oauth.revoked' : 'oauth.expiredStatus')}</Badge></CardHeader><CardContent className="space-y-4">
   <ul className="space-y-1 text-sm">{item.scopes.map(scope => <li key={scope}>{t(('oauth.' + scope) as TranslationKey)}</li>)}</ul>
   <p className="text-xs text-muted-foreground">{t('oauth.createdAt')}: {date(item.createdAt)} · {t('oauth.lastUsedAt')}: {date(item.lastUsedAt)}</p>
   <Button className="min-h-11" variant="outline" disabled={item.status === 'revoked'} onClick={() => setTarget(item)}>{t('oauth.revoke')}</Button>
  </CardContent></Card>)}
  {next && <Button className="min-h-11" variant="outline" onClick={() => setCursor(next)}>{t('oauth.next')}</Button>}
  <Dialog open={!!target} onOpenChange={v => { if (!v && !busy)
        setTarget(null); }}><DialogContent><DialogHeader><DialogTitle>{t('oauth.revoke')}</DialogTitle><DialogDescription>{t('oauth.revokePrompt')}</DialogDescription></DialogHeader><DialogFooter><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setTarget(null)}>{t('oauth.cancel')}</Button><Button className="min-h-11" disabled={busy} onClick={() => void revoke()}>{t('oauth.confirm')}</Button></DialogFooter></DialogContent></Dialog>
 </div>;
}
interface Client {
    clientId: string;
    name: string;
    operator: string;
    redirectUris: string[];
    scopes: string[];
    status: 'active' | 'disabled';
}
interface ClientForm {
    name: string;
    operator: string;
    privacyUrl: string;
    termsUrl: string;
    redirects: string;
}
export function OAuthClientsPage(): React.JSX.Element {
    const { t } = useI18n(), relogin = useRelogin(), [items, setItems] = React.useState<Client[]>([]), [reload, setReload] = React.useState(0);
    const [loading, setLoading] = React.useState(true), [error, setError] = React.useState<ErrorKey | null>(null), [busy, setBusy] = React.useState(false), [create, setCreate] = React.useState(false);
    const [target, setTarget] = React.useState<{
        client: Client;
        action: 'rotate' | 'status';
    } | null>(null), [selected, setSelected] = React.useState(scopes);
    // One-time secret stays component-local and is removed as soon as the dialog closes.
    const [secret, setSecret] = React.useState<string | null>(null), [copied, setCopied] = React.useState(false);
    const form = useForm<ClientForm>({ defaultValues: { name: 'GlobalSite', operator: '', privacyUrl: '', termsUrl: '', redirects: '' } });
    usePageTitle(t('oauth.clients'));
    React.useEffect(() => { let live = true; setLoading(true); setError(null); void oauthRequest<{
        items: Client[];
    }>('/oauth/clients').then(x => { if (live)
        setItems(x.items); }).catch(e => { if (live)
        setError(errorKey(e)); }).finally(() => { if (live)
        setLoading(false); }); return () => { live = false; }; }, [reload]);
    const issue = form.handleSubmit(async (values) => { setBusy(true); setError(null); try {
        const x = await oauthRequest<{
            clientSecret: string;
        }>('/oauth/clients', 'POST', { name: values.name, operator: values.operator, privacyUrl: values.privacyUrl, termsUrl: values.termsUrl, redirectUris: values.redirects.split('\n').map(s => s.trim()).filter(Boolean), scopes: selected });
        setCreate(false);
        form.reset();
        setSecret(x.clientSecret);
        setCopied(false);
        setReload(v => v + 1);
    }
    catch (e) {
        setError(errorKey(e));
    }
    finally {
        setBusy(false);
    } });
    const mutate = async () => { if (!target)
        return; setBusy(true); try {
        const x = await oauthRequest<{
            clientSecret?: string;
        }>('/oauth/clients/' + target.client.clientId + (target.action === 'rotate' ? '/rotate-secret' : ''), target.action === 'rotate' ? 'POST' : 'PATCH', target.action === 'rotate' ? { graceSeconds: 0 } : { status: target.client.status === 'active' ? 'disabled' : 'active' });
        setTarget(null);
        if (x.clientSecret) {
            setSecret(x.clientSecret);
            setCopied(false);
        }
        setReload(v => v + 1);
    }
    catch (e) {
        setError(errorKey(e));
    }
    finally {
        setBusy(false);
    } };
    return <div className="space-y-6"><PageHeader title={t('oauth.clients')} description={t('oauth.clientsDescription')} actions={<Button className="min-h-11" onClick={() => { setError(null); setSelected(scopes); setCreate(true); }}><KeyRound aria-hidden className="mr-2 h-4 w-4"/>{t('oauth.create')}</Button>}/>
  {error && <p role="alert" className="text-destructive">{t(error)}</p>}{error === 'oauth.freshLogin' && <Button className="min-h-11" onClick={() => void relogin()}>{t('oauth.relogin')}</Button>}
  {loading ? <p role="status">{t('common.loading')}</p> : !items.length ? <p>{t('oauth.emptyClients')}</p> : items.map(item => <Card key={item.clientId}><CardHeader><CardTitle>{item.name}</CardTitle><p className="break-all text-xs text-muted-foreground">{item.clientId}</p></CardHeader><CardContent className="space-y-4"><p className="text-sm">{item.operator}</p><ul className="space-y-1 text-sm">{item.redirectUris.map(uri => <li className="break-all" key={uri}>{uri}</li>)}</ul><div className="flex flex-wrap gap-2"><Badge variant="secondary">{t(item.status === 'active' ? 'oauth.active' : 'oauth.disabled')}</Badge>{item.scopes.map(scope => <Badge key={scope} variant="outline">{t(('oauth.' + scope) as TranslationKey)}</Badge>)}</div><div className="flex gap-3"><Button className="min-h-11" variant="outline" onClick={() => setTarget({ client: item, action: 'rotate' })}>{t('oauth.rotate')}</Button><Button className="min-h-11" variant="outline" onClick={() => setTarget({ client: item, action: 'status' })}>{t(item.status === 'active' ? 'oauth.disable' : 'oauth.enable')}</Button></div></CardContent></Card>)}
  <Dialog open={create} onOpenChange={v => { if (!busy)
        setCreate(v); }}><DialogContent><DialogHeader><DialogTitle>{t('oauth.create')}</DialogTitle><DialogDescription>{t('oauth.keepSeparate')}</DialogDescription></DialogHeader><form onSubmit={issue}><DialogBody className="space-y-4">
   {(['name', 'operator', 'privacyUrl', 'termsUrl'] as const).map(key => <div className="space-y-2" key={key}><Label htmlFor={'oauth-' + key}>{t(key === 'privacyUrl' ? 'oauth.privacy' : key === 'termsUrl' ? 'oauth.terms' : key === 'operator' ? 'oauth.operator' : 'oauth.name')}</Label><Input id={'oauth-' + key} required maxLength={key === 'name' ? 80 : key === 'operator' ? 120 : 2048} type={key.endsWith('Url') ? 'url' : 'text'} {...form.register(key, { required: true })}/></div>)}
   <div className="space-y-2"><Label htmlFor="oauth-redirects">{t('oauth.redirectUris')}</Label><textarea id="oauth-redirects" required className={selectClass + ' min-h-24 py-2'} {...form.register('redirects', { required: true })}/></div>
   <fieldset><legend>{t('oauth.permissions')}</legend>{scopes.map(scope => <label className="flex min-h-11 items-center gap-3 text-sm" key={scope}><input type="checkbox" checked={selected.includes(scope)} disabled={scope === 'openid'} onChange={e => setSelected(s => e.target.checked ? [...s, scope] : s.filter(x => x !== scope))}/>{t(('oauth.' + scope) as TranslationKey)}</label>)}</fieldset>
   {error && <p role="alert" className="text-destructive">{t(error)}</p>}
  </DialogBody><DialogFooter><Button className="min-h-11" type="button" variant="outline" disabled={busy} onClick={() => setCreate(false)}>{t('oauth.cancel')}</Button><Button className="min-h-11" disabled={busy} type="submit">{busy ? t('oauth.busy') : t('oauth.create')}</Button></DialogFooter></form></DialogContent></Dialog>
  <Dialog open={!!secret} onOpenChange={v => { if (!v)
        setSecret(null); }}><DialogContent><DialogHeader><DialogTitle>{t('oauth.secretTitle')}</DialogTitle><DialogDescription>{t('oauth.secretDescription')}</DialogDescription></DialogHeader><DialogBody><code className="block break-all rounded border bg-muted p-3">{secret}</code></DialogBody><DialogFooter><Button className="min-h-11" variant="outline" onClick={() => { if (secret)
        void navigator.clipboard.writeText(secret).then(() => setCopied(true)).catch(() => setError('oauth.failed')); }}><Copy aria-hidden className="mr-2 h-4 w-4"/>{t(copied ? 'oauth.copied' : 'oauth.copy')}</Button><Button className="min-h-11" onClick={() => setSecret(null)}>{t('oauth.close')}</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={!!target} onOpenChange={v => { if (!v && !busy)
        setTarget(null); }}><DialogContent><DialogHeader><DialogTitle>{t(target?.action === 'rotate' ? 'oauth.rotate' : 'oauth.status')}</DialogTitle><DialogDescription>{t(target?.action === 'rotate' ? 'oauth.rotatePrompt' : 'oauth.revokePrompt')}</DialogDescription></DialogHeader><DialogFooter><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setTarget(null)}>{t('oauth.cancel')}</Button><Button className="min-h-11" disabled={busy} onClick={() => void mutate()}>{t('oauth.confirm')}</Button></DialogFooter></DialogContent></Dialog>
 </div>;
}
