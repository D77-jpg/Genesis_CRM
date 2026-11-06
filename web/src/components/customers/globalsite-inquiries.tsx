import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bell, Mail } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useAuthStore } from '@/store/auth.store';
import { useProjectStore } from '@/store/project.store';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
type NoticeRow = {
    id: string;
    customerId: string;
    url: string;
    siteName: string;
    submittedAt: string;
};
type Row = {
    id: string;
    read: boolean;
    site: {
        name: string;
    };
    submittedAt: string;
    contact: {
        name: string;
        company: string;
        email: string;
    };
    message: string;
    products: {
        name: string;
    }[];
    quantity: number | null;
    source: {
        pageUrl: string;
        referrer: string | null;
        utm: Record<string, string | null>;
    };
    spamScore: number;
    attachments: {
        id: string;
        fileName: string;
        url: string | null;
        status: string;
    }[];
};
export function GlobalSiteNotifications() {
    const projectId = useProjectStore(s => s.activeProject?.id), { t } = useI18n(), [data, setData] = React.useState<{
        items: NoticeRow[];
        count: number;
    }>({ items: [], count: 0 });
    React.useEffect(() => { let live = true; setData({ items: [], count: 0 }); const load = () => { void apiGet<{
        items: NoticeRow[];
        count: number;
    }>('/globalsite-inquiries/notifications').then(r => { if (live)
        setData(r); }).catch(() => undefined); }; if (projectId)
        load(); const timer = setInterval(load, 30000); return () => { live = false; clearInterval(timer); }; }, [projectId]);
    return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="relative min-h-11 min-w-11 px-2" aria-label={t('j1.notifications')}><Bell className="h-4 w-4" aria-hidden/>{data.count > 0 ? <Badge className="absolute -right-1 -top-1 px-1 text-[10px]">{data.count}</Badge> : null}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]"><DropdownMenuLabel>{t('j1.notifications')}</DropdownMenuLabel>{data.items.length ? data.items.map(r => <DropdownMenuItem key={r.id} asChild><Link className="max-w-xs whitespace-normal break-words" to={r.url}>{t('j1.from')} · {r.siteName}</Link></DropdownMenuItem>) : <DropdownMenuLabel className="text-muted-foreground">{t('j1.noNotices')}</DropdownMenuLabel>}</DropdownMenuContent></DropdownMenu>;
}
export function GlobalSiteInquiries({ customerId, onDraft }: {
    customerId: string;
    onDraft: () => void;
}) {
    const projectId = useProjectStore(s => s.activeProject?.id), role = useAuthStore(s => s.user?.role), { t } = useI18n(), [items, setItems] = React.useState<Row[]>([]), [cursor, setCursor] = React.useState<string | null>(null), [error, setError] = React.useState(false), [busy, setBusy] = React.useState<string | null>(null), [notice, setNotice] = React.useState<string>('');
    const load = React.useCallback(async (next?: string) => { setError(false); try {
        const d = await apiGet<{
            items: Row[];
            nextCursor: string | null;
        }>('/globalsite-inquiries', { params: { customerId, ...(next ? { cursor: next } : {}) } });
        setItems(v => next ? [...v, ...d.items] : d.items);
        setCursor(d.nextCursor);
    }
    catch {
        setError(true);
    } }, [customerId]);
    React.useEffect(() => { setItems([]); void load(); }, [load, projectId]);
    async function action(row: Row, draft: boolean) { setBusy(row.id); setNotice(''); setError(false); try {
        await apiPost('/globalsite-inquiries/' + row.id + (draft ? '/reply-draft' : '/read'), {});
        if (draft) {
            setNotice(t('j1.draftSaved'));
            onDraft();
        }
        await load();
    }
    catch {
        setError(true);
    }
    finally {
        setBusy(null);
    } }
    return <Card id="globalsite-inquiries"><CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" aria-hidden/>{t('j1.title')}</CardTitle></CardHeader><CardContent className="space-y-5">
 <p className="text-sm text-muted-foreground">{t('j1.draftHint')}</p>{error ? <p role="alert" className="text-destructive">{t('j1.error')}</p> : null}{notice ? <p role="status">{notice} <a href="#letters" className="underline">{t('j1.openDraft')}</a></p> : null}
 {!items.length && !error ? <p className="text-sm text-muted-foreground">{t('j1.empty')}</p> : null}
 {items.map(row => <article key={row.id} className="space-y-3 rounded-lg border p-4 [overflow-wrap:anywhere]"><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant="muted">{t('j1.from')}</Badge><h3 className="mt-2 font-semibold">{row.site.name}</h3><p className="text-sm text-muted-foreground">{new Date(row.submittedAt).toLocaleString()}</p></div>{role !== 'viewer' ? <Button className="min-h-11" disabled={busy !== null} onClick={() => void action(row, true)}>{busy === row.id ? t('common.loading') : t('j1.reply')}</Button> : null}</div>
 <p>{row.contact.name} · {row.contact.company} · {row.contact.email}</p><p className="whitespace-pre-wrap">{row.message}</p>{row.products.length ? <p>{t('j1.products')}: {row.products.map(p => p.name).join(', ')}</p> : null}{row.quantity !== null ? <p>{t('j1.quantity')}: {row.quantity}</p> : null}
 <a className="block text-sm underline" href={row.source.pageUrl} target="_blank" rel="noreferrer">{t('j1.page')}: {row.source.pageUrl}</a>
 <details><summary className="min-h-11 cursor-pointer py-3 text-sm">{t('j1.source')}</summary><dl className="grid gap-2 text-sm"><dt>{t('j1.referrer')}</dt><dd>{row.source.referrer || '—'}</dd><dt>UTM</dt><dd>{Object.entries(row.source.utm).filter(([, v]) => v).map(([k, v]) => k + ': ' + v).join(' · ') || '—'}</dd><dt>{t('j1.score')}</dt><dd>{row.spamScore}</dd></dl></details>
 {row.attachments.length ? <ul className="space-y-2">{row.attachments.map(a => <li key={a.id} className="flex flex-wrap gap-2 text-sm">{a.url ? <a className="underline" href={a.url}>{a.fileName}</a> : <span>{a.fileName}</span>}<Badge variant="muted">{a.status === 'stored' ? t('j1.stored') : a.status === 'failed' ? t('j1.failed') : t('j1.pending')}</Badge></li>)}</ul> : null}
 {!row.read && role !== 'viewer' ? <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void action(row, false)}>{t('j1.read')}</Button> : null}
 </article>)}
 {cursor ? <Button variant="outline" onClick={() => void load(cursor)}>{t('j1.more')}</Button> : null}</CardContent></Card>;
}
