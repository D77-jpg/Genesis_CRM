import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { SendLetterDialog } from '@/components/letters/send-letter-dialog';
import { useAuthStore, selectIsAdmin } from '@/store/auth.store';
import { LETTER_STATUS_LABEL } from '@/constants';
import type { Customer, DevelopmentLetter, LetterStatus, Paginated } from '@/types';
import { usePageTitle } from '@/hooks/use-ui';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { MailInteractionSummary } from '@/components/letters/mail-interaction-summary';
import type { MailTrackingSummary } from '@/types';

interface MailItem {
  id: string; direction: 'inbound' | 'outbound'; customerId?: string;
  customerName?: string;
  subject: string; from: string; fromName?: string; to: string[]; cc: string[];
  html: string; text: string; sentAt: string; read: boolean;
  status?: LetterStatus; scheduledAt?: string; nextAttemptAt?: string; error?: string; needsReview?: boolean;
  messageId?: string; inReplyTo?: string; channel?: string; attempts?: number;
  history?: { at: string; status: LetterStatus; error?: string }[];
  tracking?: MailTrackingSummary;
  attachments: { id: string; name: string; size: number; blocked?: string }[];
}
interface Detail { mail: MailItem; thread: MailItem[]; customer: Customer | null }
interface SyncStatus { enabled: boolean; channel: string; lastSyncAt?: string; lastError?: string; skipped: number }
const folderLabels = { inbox: '收件箱', sent: '发件记录', tasks: '定时任务', unknown: '未关联邮件' };
type Folder = keyof typeof folderLabels;

export function MailPage(): React.JSX.Element {
  usePageTitle('邮件中心');
  const admin = useAuthStore(selectIsAdmin);
  const [params, setParams] = useSearchParams();
  const [folder, setFolder] = React.useState<Folder>('inbox');
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<MailItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [reply, setReply] = React.useState(false);
  const [resend, setResend] = React.useState<DevelopmentLetter | null>(null);
  const [resolve, setResolve] = React.useState<'sent' | 'not_sent' | null>(null);
  const [compose, setCompose] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null);
  const selectedId = params.get('id');
  const direction = params.get('direction') === 'outbound' ? 'outbound' : 'inbound';
  const detailRequest = React.useRef(0);
  const listRequest = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const version = ++listRequest.current;
    setLoading(true);
    try {
      const data = await apiGet<Paginated<MailItem>>('/mail', { params: { folder, page } });
      if (version !== listRequest.current) return;
      setItems(data.items); setTotal(data.total); setError('');
      if (admin) setStatus(await apiGet<SyncStatus>('/mail/status'));
    } catch (e) { setError(toErrorMessage(e)); }
    finally { setLoading(false); }
  }, [folder, page, admin]);
  React.useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, [refresh]);

  const loadDetail = React.useCallback(async () => {
    const version = ++detailRequest.current;
    if (!selectedId) { setDetail(null); return; }
    try { const data = await apiGet<Detail>(`/mail/${selectedId}`, { params: { direction } }); if (version === detailRequest.current) setDetail(data); }
    catch (e) { if (version === detailRequest.current) { setDetail(null); setError(toErrorMessage(e)); } }
  }, [selectedId, direction]);
  React.useEffect(() => { setDetail(null); void loadDetail(); }, [loadDetail]);
  React.useEffect(() => {
    if (!compose && !(admin && detail && !detail.customer)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiGet<Paginated<Customer>>('/customers', { params: { search, limit: 20 } })
        .then(data => { if (!cancelled) setCustomers(data.items); })
        .catch(e => { if (!cancelled) setError(toErrorMessage(e)); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, compose, admin, detail]);

  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await Promise.all([refresh(), loadDetail()]); }
    catch (e) { toast.error(toErrorMessage(e)); }
    finally { setBusy(false); }
  }
  function open(item: MailItem) {
    setParams({ id: item.id, direction: item.direction });
    if (item.direction === 'inbound' && !item.read) void apiPost(`/mail/${item.id}/read`, { read: true }).then(() => {
      setDetail(current => current?.mail.id === item.id ? { ...current, mail: { ...current.mail, read: true } } : current);
      void refresh();
    }).catch(e => toast.error(toErrorMessage(e)));
  }
  const customerPicker = <div className="space-y-2 rounded-lg border p-3">
    <Label htmlFor="mail-customer-search">选择已有客户</Label>
    <Input id="mail-customer-search" placeholder="搜索姓名、公司或邮箱" value={search} onChange={e => setSearch(e.target.value)} />
    <div className="max-h-44 overflow-auto space-y-1">
      {customers.map(c => <Button key={c.id} variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" disabled={busy}
        onClick={() => { if (compose) { setSelectedCustomer(c); } else if (detail) { void action(() => apiPost(`/mail/${detail.mail.id}/link`, { customerId: c.id })); } }}>
        {c.name} · {c.company || c.email}
      </Button>)}
      {!customers.length && <p className="text-sm text-muted-foreground">没有匹配客户，请调整搜索。</p>}
    </div>
  </div>;

  return <div className="space-y-5">
    <PageHeader title="邮件中心" description="客户往来、发送记录与定时任务" />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2" aria-label="邮件文件夹">
        {(Object.keys(folderLabels) as Folder[]).filter(f => admin || f !== 'unknown').map(f =>
          <Button key={f} variant={folder === f ? 'default' : 'outline'} aria-pressed={folder === f} onClick={() => { setFolder(f); setPage(1); setParams({}); }}>{folderLabels[f]}</Button>)}
      </div>
      <div className="flex gap-2"><Button variant="outline" disabled={loading} onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden />刷新</Button>
        <Button onClick={() => { setCompose(!compose); setSelectedCustomer(null); }}><Mail className="mr-2 h-4 w-4" aria-hidden />写邮件</Button></div>
    </div>
    {status && <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span>{status.enabled ? `后台收件同步 · ${status.lastSyncAt ? formatDateTime(status.lastSyncAt) : '等待首次同步'}` : '收件同步未启用'}</span>
      <span>发件通道：{status.channel === 'mock' ? '模拟发送' : 'SMTP'}</span>
      {status.lastError && <span className="text-destructive">{status.lastError}</span>}
      {status.skipped > 0 && <span>超大邮件已跳过：{status.skipped}</span>}
      <Button variant="ghost" disabled={busy || !status.enabled} onClick={() => void action(() => apiPost('/mail/sync'))}>同步收件</Button>
    </div>}
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {compose && !selectedCustomer && customerPicker}
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
      <section className="min-w-0 rounded-lg border bg-card" aria-label={folderLabels[folder]} aria-busy={loading}>
        <div className="border-b p-3 text-sm text-muted-foreground">{folderLabels[folder]} · {total} 封{loading ? ' · 加载中…' : ''}</div>
        {!items.length && <p className="p-8 text-center text-sm text-muted-foreground">{loading ? '正在加载邮件…' : '此文件夹暂无邮件'}</p>}
        {items.map(item => <button key={item.id} onClick={() => open(item)} className={`block w-full space-y-1 border-b p-4 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === item.id ? 'bg-muted' : ''}`}>
          <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-all text-sm">{item.direction === 'inbound' ? item.fromName || item.from : item.to.join(', ')}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(item.scheduledAt || item.sentAt)}</span></div>
          <p className={`line-clamp-2 break-words text-sm ${!item.read ? 'font-bold' : ''}`}>{item.subject || '（无主题）'}</p>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{item.direction === 'inbound' && <span>{item.read ? '已读' : '未读'}</span>}{item.status && <Badge variant="outline">{LETTER_STATUS_LABEL[item.status]}</Badge>}<span>{item.customerId ? (item.customerName || '已关联客户') : '未关联客户'}</span>{item.attachments.length > 0 && <span>附件 {item.attachments.length}</span>}</div>
          {item.direction === 'outbound' && ['sent', 'opened'].includes(item.status || '') && <MailInteractionSummary sentAt={item.sentAt} tracking={item.tracking} />}
        </button>)}
        <div className="flex items-center justify-between p-3"><Button variant="ghost" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</Button><span className="text-xs">{page} / {Math.max(1, Math.ceil(total / 25))}</span><Button variant="ghost" disabled={page * 25 >= total || loading} onClick={() => setPage(p => p + 1)}>下一页</Button></div>
      </section>
      <section className="min-w-0 rounded-lg border bg-card p-4 sm:p-5" aria-label="邮件会话详情">
        {!detail ? <div className="py-20 text-center text-sm text-muted-foreground">{selectedId ? '正在加载邮件详情…' : '选择一封邮件，查看客户往来会话'}</div> : <div className="space-y-4">
          <h2 className="break-words text-lg font-semibold">{detail.mail.subject || '（无主题）'}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {detail.customer ? <Link className="text-sm text-primary underline" to={`/customers/${detail.customer.id}`}>客户：{detail.customer.name} · {detail.customer.company}</Link> : <Badge variant="outline">未关联客户</Badge>}
            {detail.mail.direction === 'inbound' && <Button variant="outline" disabled={busy} onClick={() => void action(() => apiPost(`/mail/${detail.mail.id}/read`, { read: !detail.mail.read }))}>{detail.mail.read ? '标记未读' : '标记已读'}</Button>}
            {detail.customer && detail.mail.direction === 'inbound' && <Button onClick={() => setReply(true)}>回复客户</Button>}
            {detail.mail.status && ['scheduled', 'queued', 'retrying'].includes(detail.mail.status) && <Button variant="outline" disabled={busy} onClick={() => void action(() => apiPost(`/mail/${detail.mail.id}/cancel`))}>取消任务</Button>}
            {detail.customer && detail.mail.status === 'failed' && !detail.mail.needsReview && <Button disabled={busy} onClick={() => void action(async () => { setResend(await apiGet<DevelopmentLetter>(`/letters/${detail.mail.id}`)); })}>编辑并重新发送</Button>}
            {admin && detail.mail.needsReview && <><Button variant="outline" onClick={() => setResolve('sent')}>已核实投递成功</Button><Button variant="outline" onClick={() => setResolve('not_sent')}>已核实未投递</Button></>}
          </div>
          {!detail.customer && admin && customerPicker}
          {detail.thread.map(mail => <article key={mail.id} className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{mail.direction === 'inbound' ? '收到邮件' : '发出邮件'} · {formatDateTime(mail.sentAt)}</span>{mail.status && <Badge variant="outline">{LETTER_STATUS_LABEL[mail.status]}</Badge>}</div>
            <div className="space-y-1 break-all text-xs text-muted-foreground"><p>发件人：{mail.from}</p><p>收件人：{mail.to.join(', ')}</p>{mail.cc.length > 0 && <p>抄送：{mail.cc.join(', ')}</p>}</div>
            {mail.error && <p role="status" className="text-sm text-destructive">{mail.error}{mail.needsReview ? '（待核实，不会自动重发）' : ''}</p>}
            {mail.scheduledAt && <p className="text-xs">定时时间：{formatDateTime(mail.scheduledAt)}</p>}
            {mail.status === 'retrying' && <p className="text-xs">下次重试：{formatDateTime(mail.nextAttemptAt)} · 已尝试 {mail.attempts} 次</p>}
            {mail.direction === 'outbound' && ['sent', 'opened'].includes(mail.status || '') && <MailInteractionSummary sentAt={mail.sentAt} tracking={mail.tracking} detailed />}
            {mail.html ? <iframe title={`邮件正文：${mail.subject}`} sandbox="" referrerPolicy="no-referrer" className="min-h-64 w-full rounded border bg-white" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.7 sans-serif;overflow-wrap:anywhere;color:#202124}table{max-width:100%}pre{white-space:pre-wrap}</style>${mail.html}`} /> : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{mail.text || '（无正文）'}</p>}
            {mail.attachments.map(a => <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm"><span>{a.name} · {Math.ceil(a.size / 1024)} KB</span>{a.blocked ? <span className="text-destructive">{a.blocked}</span> : <Button variant="outline" disabled={busy} onClick={() => void action(() => downloadFile(`/mail/${mail.id}/attachments/${a.id}`, a.name))}>下载附件</Button>}</div>)}
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">邮件标识与发送记录</summary><p className="break-all">Message-ID：{mail.messageId || '未提供'}</p>{mail.inReplyTo && <p className="break-all">回复引用：{mail.inReplyTo}</p>}{mail.history?.map((h, i) => <p key={i}>{formatDateTime(h.at)} · {LETTER_STATUS_LABEL[h.status]} {h.error}</p>)}</details>
          </article>)}
        </div>}
      </section>
    </div>
    <SendLetterDialog open={reply} onOpenChange={setReply} customer={detail?.customer || null} reply={detail ? { id: detail.mail.id, subject: detail.mail.subject, from: detail.mail.from } : undefined} onSent={() => { void refresh(); void loadDetail(); }} />
    <SendLetterDialog open={!!resend} onOpenChange={v => { if (!v) setResend(null); }} customer={detail?.customer || null} letter={resend} onSent={() => { void refresh(); void loadDetail(); }} />
    <SendLetterDialog open={compose && !!selectedCustomer} onOpenChange={v => { if (!v) { setCompose(false); setSelectedCustomer(null); } }} customer={selectedCustomer} onSent={() => { void refresh(); }} />
    <ConfirmDialog open={!!resolve} onOpenChange={v => { if (!v) setResolve(null); }} title="确认投递核实结果" description={resolve === 'sent' ? '请仅在邮箱或服务器记录已确认投递成功后操作。此操作会将任务标记为已发送。' : '请仅在邮箱或服务器记录已确认未投递后操作。此操作解除待核实状态，之后可以手动重新发送。'} loading={busy}
      onConfirm={() => action(async () => { await apiPost(`/mail/${detail?.mail.id}/resolve`, { outcome: resolve }); setResolve(null); })} />
  </div>;
}
