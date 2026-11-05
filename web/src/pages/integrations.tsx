import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Copy, KeyRound, Plus, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { useI18n, type TranslationKey } from '@/i18n';
import { useProjectStore } from '@/store/project.store';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePageTitle } from '@/hooks/use-ui';

interface Credential {
  projectCount: number;
  id: string; name: string; scopes: string[]; createdBy: { id: string; displayName: string } | null;
  createdAt: string; lastUsedAt: string | null; expiresAt: string | null; previousValidUntil: string | null;
  status: 'active' | 'expired' | 'revoked';
}
interface Log { id: string; createdAt: string; method: string; route: string; statusCode: number; latencyMs: number }
interface Page<T> { items: T[]; total: number; page: number; limit: number }
interface Settings { scopes: { name: string; available: boolean }[]; globalsitePreset: string[]; quota: { used: number; limit: number } }
interface CreateForm { name: string; preset: string; scopes: string[]; expiresAt: string }
const scopeLabels: Record<string, TranslationKey> = {
  'products:read': 'integrations.products', 'company:read': 'integrations.company', 'playbook:read': 'integrations.playbook',
  'knowledge:read': 'integrations.knowledge', 'customers:upsert': 'integrations.customers', 'inquiries:write': 'integrations.inquiries',
  'outcomes:read': 'integrations.outcomes', 'stats:read': 'integrations.stats', 'quotations:read': 'integrations.quotationRead', 'quotations:draft': 'integrations.quotationDraft',
};
const endpoint = '/projects/integrations';
const selectClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function IntegrationsPage(): React.JSX.Element {
  const { t } = useI18n();
  const project = useProjectStore(s => s.activeProject);
  usePageTitle(t('integrations.title'));
  return project ? <IntegrationWorkspace key={project.id} projectId={project.id} projectName={project.name} /> : <p>{t('integrations.notReady')}</p>;
}

function IntegrationWorkspace({ projectId, projectName }: { projectId: string; projectName: string }): React.JSX.Element {
  const { t, language } = useI18n();
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [credentials, setCredentials] = React.useState<Page<Credential> | null>(null);
  const [logs, setLogs] = React.useState<Page<Log> | null>(null);
  const [page, setPage] = React.useState(1), [logPage, setLogPage] = React.useState(1);
  const [logCredential, setLogCredential] = React.useState('');
  const [refresh, setRefresh] = React.useState(0);
  const [loading, setLoading] = React.useState(true), [logLoading, setLogLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false), [logError, setLogError] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [target, setTarget] = React.useState<{ credential: Credential; action: 'rotate' | 'revoke' } | null>(null);
  const [graceSeconds, setGraceSeconds] = React.useState(86400);
  const [busy, setBusy] = React.useState(false), [actionError, setActionError] = React.useState('');
  // One-time token is component-local only. No URL, store, browser storage or telemetry.
  const [secret, setSecret] = React.useState<string | null>(null);
  const form = useForm<CreateForm>({ defaultValues: { name: '', preset: 'globalsite', scopes: [], expiresAt: '' } });
  const selectedScopes = form.watch('scopes');
  const date = (value: string | null) => value ? new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US') : '—';
  const errorMessage = (error: unknown) => {
    if (error instanceof ApiClientError) {
      if (error.status === 403) return t('integrations.noPermission');
      if (error.details.some(d => d.reason === 'CREDENTIAL_LIMIT')) return t('integrations.quotaReached');
      if (error.details.some(d => d.reason === 'ROTATION_IN_PROGRESS')) return t('integrations.rotationInProgress');
      if (error.status === 422) return t('integrations.invalid');
    }
    return t('integrations.actionError');
  };
  React.useEffect(() => {
    let current = true; setLoading(true); setLoadError(false);
    void Promise.all([apiGet<Settings>(endpoint + '/settings'), apiGet<Page<Credential>>(`${endpoint}/credentials?page=${page}&limit=20`)]).then(([s, c]) => {
      if (current) { setSettings(s); setCredentials(c); }
    }).catch(() => { if (current) setLoadError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [projectId, page, refresh]);
  React.useEffect(() => {
    let current = true; setLogLoading(true); setLogError(false);
    const filter = logCredential ? '&credentialId=' + encodeURIComponent(logCredential) : '';
    void apiGet<Page<Log>>(`${endpoint}/request-logs?page=${logPage}&limit=20${filter}`).then(rows => { if (current) setLogs(rows); })
      .catch(() => { if (current) setLogError(true); }).finally(() => { if (current) setLogLoading(false); });
    return () => { current = false; };
  }, [projectId, logPage, logCredential, refresh]);
  const openCreate = () => {
    form.reset({ name: '', preset: 'globalsite', scopes: settings?.globalsitePreset ?? [], expiresAt: '' });
    setCreateOpen(true);
  };
  const create = form.handleSubmit(async data => {
    if (data.expiresAt && (!Number.isFinite(new Date(data.expiresAt).getTime()) || new Date(data.expiresAt).getTime() <= Date.now())) {
      form.setError('expiresAt', { message: t('integrations.invalid') }); return;
    }
    setBusy(true);
    try {
      const issued = await apiPost<{ credential: Credential; token: string }>(endpoint + '/credentials', {
        name: data.name.trim(), scopes: data.scopes, expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : null,
      });
      setCreateOpen(false); form.reset(); setSecret(issued.token); setRefresh(n => n + 1);
    } catch (error) { form.setError('root', { message: errorMessage(error) }); }
    finally { setBusy(false); }
  });
  const act = async () => {
    if (!target) return; setBusy(true); setActionError('');
    try {
      if (target.action === 'revoke') {
        await apiPost(`${endpoint}/credentials/${target.credential.id}/revoke`, {}); toast.success(t('integrations.revokeSuccess'));
      } else {
        const issued = await apiPost<{ credential: Credential; token: string }>(`${endpoint}/credentials/${target.credential.id}/rotate`, { graceSeconds });
        setSecret(issued.token);
      }
      setTarget(null); setRefresh(n => n + 1);
    } catch (error) { setActionError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); toast.success(t('common.copied')); }
    catch { toast.error(t('integrations.copyError')); }
  };
  return <div className="workspace-page space-y-6">
    <PageHeader title={t('integrations.title')} description={t('integrations.subtitle')} actions={<Button className="min-h-11" onClick={openCreate} disabled={!settings || loading || settings.quota.used >= settings.quota.limit}><Plus className="h-4 w-4" aria-hidden />{t('integrations.create')}</Button>} />
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="flex min-w-0 items-center gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden /><div className="min-w-0"><p className="text-xs text-muted-foreground">{t('integrations.project')}</p><p className="break-words font-medium" data-user-content>{projectName}</p></div></div>
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-muted-foreground">{settings ? t('integrations.quota', settings.quota) : t('common.loading')}</span><Button className="min-h-11" variant="outline" onClick={() => setRefresh(n => n + 1)} disabled={loading || logLoading}><RefreshCw className="h-4 w-4" aria-hidden />{t('common.refresh')}</Button></div>
    </div>
    {loadError ? <p role="alert" className="text-sm text-destructive">{t('integrations.loadError')}</p> : loading ? <p role="status">{t('common.loading')}</p> : <>
      {settings && settings.quota.used >= settings.quota.limit ? <p role="note" className="rounded-md border p-3 text-sm">{t('integrations.quotaReached')}</p> : null}
      {!credentials?.items.length ? <Card><CardContent className="space-y-3 py-10 text-center"><KeyRound className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden /><h2 className="font-medium">{t('integrations.empty')}</h2><p className="text-sm text-muted-foreground">{t('integrations.emptyHint')}</p></CardContent></Card> : <div className="grid gap-4 lg:grid-cols-2">{credentials.items.map(c => <Card key={c.id}>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0"><CardTitle className="min-w-0 break-words text-base" data-user-content>{c.name}</CardTitle><Badge variant="outline">{t(('integrations.' + c.status) as TranslationKey)}</Badge></CardHeader>
        <CardContent className="space-y-4"><div className="flex flex-wrap gap-1.5">{c.scopes.map(s => <Badge key={s} variant="muted" className="max-w-full whitespace-normal break-words">{scopeLabels[s] ? t(scopeLabels[s]) : s}{s === 'inquiries:write' ? ' · ' + t('integrations.reserved') : ''}</Badge>)}</div>
          <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">{[[t('integrations.creator'), c.createdBy?.displayName ?? t('integrations.unknownCreator')], [t('integrations.created'), date(c.createdAt)], [t('integrations.lastUsed'), c.lastUsedAt ? date(c.lastUsedAt) : t('integrations.never')], [t('integrations.expires'), date(c.expiresAt)]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words" data-user-content>{value}</dd></div>)}</dl>
          {c.status === 'active' && c.previousValidUntil && new Date(c.previousValidUntil).getTime() > Date.now() ? <p className="text-xs text-muted-foreground">{t('integrations.graceUntil', { time: date(c.previousValidUntil) })}</p> : null}
          <div className="flex flex-wrap gap-2 border-t pt-3"><Button className="min-h-11" variant="outline" disabled={c.status !== 'active'} onClick={() => { setTarget({ credential: c, action: 'rotate' }); setGraceSeconds(86400); setActionError(''); }}><RotateCw className="h-4 w-4" aria-hidden />{t('integrations.rotate')}</Button><Button className="min-h-11 text-destructive" variant="ghost" disabled={c.status === 'revoked'} onClick={() => { setTarget({ credential: c, action: 'revoke' }); setActionError(''); }}>{t('integrations.revoke')}</Button></div>
        </CardContent></Card>)}</div>}
      {credentials && credentials.total > 20 ? <div className="flex flex-wrap items-center justify-end gap-3"><span className="text-sm">{t('integrations.page', { page, total: credentials.total })}</span><Button className="min-h-11" variant="outline" disabled={page === 1} onClick={() => setPage(n => n - 1)}>{t('integrations.previous')}</Button><Button className="min-h-11" variant="outline" disabled={page * 20 >= credentials.total} onClick={() => setPage(n => n + 1)}>{t('integrations.next')}</Button></div> : null}
    </>}
    <Card><CardHeader className="space-y-3"><div><CardTitle className="text-base">{t('integrations.logs')}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{t('integrations.logsHint')}</p></div><select className={selectClass + ' sm:max-w-xs'} aria-label={t('integrations.allCredentials')} value={logCredential} onChange={e => { setLogCredential(e.target.value); setLogPage(1); }}><option value="">{t('integrations.allCredentials')}</option>{credentials?.items.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></CardHeader><CardContent>
      {logError ? <p role="alert">{t('integrations.loadError')}</p> : logLoading ? <p role="status">{t('common.loading')}</p> : !logs?.items.length ? <p className="py-6 text-center text-sm text-muted-foreground">{t('integrations.noLogs')}</p> : <div className="divide-y">{logs.items.map(log => <div key={log.id} className="grid min-w-0 gap-2 py-3 text-sm md:grid-cols-[11rem_1fr_5rem_6rem]"><time className="text-muted-foreground">{date(log.createdAt)}</time><code className="min-w-0 break-all">{log.method} {log.route}</code><span aria-label={t('integrations.status')}>{log.statusCode}</span><span className="text-muted-foreground" aria-label={t('integrations.latency')}>{log.latencyMs} ms</span></div>)}</div>}
      {logs && logs.total > 20 ? <div className="mt-4 flex flex-wrap items-center justify-end gap-3"><span className="text-sm">{t('integrations.page', { page: logPage, total: logs.total })}</span><Button className="min-h-11" variant="outline" disabled={logPage === 1 || logLoading} onClick={() => setLogPage(n => n - 1)}>{t('integrations.previous')}</Button><Button className="min-h-11" variant="outline" disabled={logPage * 20 >= logs.total || logLoading} onClick={() => setLogPage(n => n + 1)}>{t('integrations.next')}</Button></div> : null}
    </CardContent></Card>
    <Dialog open={createOpen} onOpenChange={next => { if (!busy) setCreateOpen(next); }}><DialogContent hideClose className="max-w-2xl"><DialogHeader><DialogTitle>{t('integrations.create')}</DialogTitle><DialogDescription>{t('integrations.issuedHint')}</DialogDescription></DialogHeader><DialogBody><form id="credential-create" onSubmit={e => void create(e)} className="space-y-4">
      <div><Label htmlFor="credential-name">{t('integrations.name')}</Label><Input id="credential-name" className="mt-2 min-h-11" autoComplete="off" maxLength={120} placeholder={t('integrations.nameHint')} aria-invalid={!!form.formState.errors.name} {...form.register('name', { required: t('integrations.invalid'), validate: v => !!v.trim() || t('integrations.invalid') })} />{form.formState.errors.name ? <p role="alert" className="mt-1 text-sm text-destructive">{form.formState.errors.name.message}</p> : null}</div>
      <div><Label htmlFor="credential-preset">{t('integrations.preset')}</Label><select id="credential-preset" className={selectClass + ' mt-2'} {...form.register('preset', { onChange: e => form.setValue('scopes', e.target.value === 'globalsite' ? settings?.globalsitePreset ?? [] : []) })}><option value="globalsite">{t('integrations.globalsite')}</option><option value="custom">{t('integrations.custom')}</option></select></div>
      <fieldset><legend className="text-sm font-medium">{t('integrations.permissions')}</legend><div className="mt-2 grid gap-x-4 sm:grid-cols-2">{settings?.scopes.map(s => <label key={s.name} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm"><input type="checkbox" value={s.name} className="h-4 w-4 shrink-0 accent-primary" {...form.register('scopes', { validate: v => v.length > 0 || t('integrations.invalid') })} /><span>{scopeLabels[s.name] ? t(scopeLabels[s.name]) : s.name}{!s.available ? <span className="ml-2 text-xs text-muted-foreground">{t('integrations.reserved')}</span> : null}</span></label>)}</div>{form.formState.errors.scopes ? <p role="alert" className="text-sm text-destructive">{t('integrations.invalid')}</p> : null}</fieldset>
      {selectedScopes?.includes('inquiries:write') ? <p role="note" className="rounded-md border bg-muted/40 p-3 text-sm leading-6">{t('integrations.reservedHint')}</p> : null}
      <div><Label htmlFor="credential-expiry">{t('integrations.expires')}</Label><Input id="credential-expiry" type="datetime-local" className="mt-2 min-h-11" {...form.register('expiresAt')} aria-describedby="credential-expiry-help" /><p id="credential-expiry-help" className="mt-2 text-xs text-muted-foreground">{t('integrations.expiresHint')}</p>{form.formState.errors.expiresAt ? <p role="alert" className="text-sm text-destructive">{form.formState.errors.expiresAt.message}</p> : null}</div>
      {form.formState.errors.root ? <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
    </form></DialogBody><DialogFooter><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button><Button className="min-h-11" form="credential-create" type="submit" disabled={busy}>{busy ? t('common.saving') : t('integrations.create')}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!target} onOpenChange={next => { if (!next && !busy) setTarget(null); }}><DialogContent hideClose><DialogHeader><DialogTitle>{t(target?.action === 'rotate' ? 'integrations.rotateTitle' : 'integrations.revokeTitle')}</DialogTitle><DialogDescription>{t(target?.action === 'rotate' ? 'integrations.rotateHint' : 'integrations.revokeHint')}</DialogDescription></DialogHeader><DialogBody className="space-y-4"><p className="break-words font-medium" data-user-content>{target?.credential.name}</p>{target && target.credential.projectCount > 1 ? <p role="note" className="rounded-md border p-3 text-sm">{t('integrations.shared', { count: target.credential.projectCount })}</p> : null}{target?.action === 'rotate' ? <div><Label htmlFor="credential-grace">{t('integrations.grace')}</Label><select id="credential-grace" className={selectClass + ' mt-2'} value={graceSeconds} onChange={e => setGraceSeconds(Number(e.target.value))}><option value={0}>{t('integrations.immediate')}</option><option value={3600}>{t('integrations.hour')}</option><option value={86400}>{t('integrations.day')}</option><option value={604800}>{t('integrations.week')}</option></select></div> : null}{actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}</DialogBody><DialogFooter><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setTarget(null)}>{t('common.cancel')}</Button><Button className="min-h-11" variant={target?.action === 'revoke' ? 'destructive' : 'default'} disabled={busy} onClick={() => void act()}>{busy ? t('common.saving') : t('common.confirm')}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={secret !== null} onOpenChange={next => { if (!next) setSecret(null); }}><DialogContent hideClose><DialogHeader><DialogTitle>{t('integrations.issuedTitle')}</DialogTitle><DialogDescription>{t('integrations.issuedHint')}</DialogDescription></DialogHeader><DialogBody><code data-secret translate="no" className="block select-all break-all rounded-md border bg-muted p-4 text-sm">{secret}</code></DialogBody><DialogFooter><Button className="min-h-11" variant="outline" onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden />{t('common.copy')}</Button><Button className="min-h-11" onClick={() => setSecret(null)}>{t('integrations.saved')}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
