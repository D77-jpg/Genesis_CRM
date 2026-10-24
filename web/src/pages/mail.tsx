import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  Clock,
  Inbox,
  Loader2,
  Mail,
  MailSearch,
  Paperclip,
  RefreshCw,
  Send,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { WorkspaceToolbar } from '@/components/common/workspace';
import { EmptyState, ErrorState } from '@/components/common/empty-state';
import { SendLetterDialog } from '@/components/letters/send-letter-dialog';
import { useAuthStore, selectIsAdmin } from '@/store/auth.store';
import { LETTER_STATUS_LABEL } from '@/constants';
import type { Customer, DevelopmentLetter, LetterStatus, Paginated } from '@/types';
import { usePageTitle } from '@/hooks/use-ui';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { MailInteractionSummary } from '@/components/letters/mail-interaction-summary';
import type { MailTrackingSummary } from '@/types';
import { useUiStore } from '@/store/ui.store';

interface MailItem {
  id: string; direction: 'inbound' | 'outbound'; customerId?: string;
  mailboxUserId?: string; mailboxAddress?: string;
  customerName?: string; prospectId?: string; prospectName?: string;
  subject: string; from: string; fromName?: string; to: string[]; cc: string[];
  html: string; text: string; sentAt: string; read: boolean;
  status?: LetterStatus; scheduledAt?: string; nextAttemptAt?: string; error?: string; needsReview?: boolean;
  messageId?: string; inReplyTo?: string; channel?: string; attempts?: number;
  history?: { at: string; status: LetterStatus; error?: string }[];
  tracking?: MailTrackingSummary;
  attachments: { id: string; name: string; size: number; blocked?: string }[];
}
interface Detail { mail: MailItem; thread: MailItem[]; customer: Customer | null }
interface MailCustomerPlanItem {
  key: string; name: string; company?: string; email: string; website?: string;
  mailCount: number; lastAt: string; firstSubject: string;
  action: 'create' | 'link' | 'skip-supplier' | 'skip-system' | 'skip-prospect' | 'skip-blocked' | 'skip-auto';
  customerId?: string; reason?: string;
}
interface MailCustomerPlan {
  items: MailCustomerPlanItem[];
  totals: { create: number; link: number; skipSupplier: number; skipSystem: number; skipProspect: number; skipBlocked: number; skipAuto: number; mails: number };
  created?: { id: string; name: string; email: string; mails: number }[];
  linkedMails?: number;
}
interface OutreachFollowUpItem {
  customerId: string; name: string; company?: string; email?: string; ownerId?: string; status: string;
  step: number; nextStep: number; lastSubject?: string; lastSentAt?: string;
  abandonAfter: number; dueAt: string; overdueDays: number;
}
interface OutreachFollowUpList {
  items: OutreachFollowUpItem[];
  totals: { due: number; overdue: number; today: number; second: number; third: number; lastChance: number };
  config: { days: number[]; maxSteps: number; abandonTag: string };
}
interface SyncStatus { enabled: boolean; configured: boolean; source: 'personal' | 'project'; verificationStatus: 'unverified' | 'verified' | 'failed'; mailboxAddress?: string; channel: string; lastSyncAt?: string; lastError?: string; skipped: number }
const folderLabels = { inbox: '收件箱', sent: '发件记录', tasks: '定时任务', followup: '跟进提醒', unknown: '未关联邮件' };
type Folder = keyof typeof folderLabels;

/** 头像缩写：优先取姓名首字母，邮箱取 @ 前两段 */
function initialsOf(value: string): string {
  const source = (value || '').trim();
  if (!source) return '?';
  const bare = source.split('<')[0].replace(/"/g, '').trim() || source;
  const parts = bare.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : bare.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * 邮件正文 iframe 的安全包裹：
 * - 不允许脚本（default-src 'none'，只放开样式与图片），避免邮件内容劫持页面
 * - 允许图片：很多来信的正文图与签名 logo 都用 <img>，此前被 CSP 拦成空白
 * - 链接在新标签打开，不在 iframe 内跳转
 */
function mailSrcdoc(html: string): string {
  const csp = "default-src 'none'; img-src http: https: data: cid:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const style = 'body{margin:0;padding:16px;font:14px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere;color:#202124;background:#fff}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#6d4aff}img+hr{display:none}';
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${style}</style>${html}`;
}

function StatusChip({ status }: { status?: LetterStatus }): React.JSX.Element | null {
  if (!status) return null;
  const tone = status === 'sent' || status === 'opened'
    ? 'chip-mint'
    : status === 'failed'
      ? 'chip-rose'
      : status === 'draft' || status === 'scheduled' || status === 'queued' || status === 'retrying'
        ? 'chip-amber'
        : 'chip-muted';
  return <span className={cn('chip', tone)}>{LETTER_STATUS_LABEL[status]}</span>;
}

export function MailPage(): React.JSX.Element {
  usePageTitle('邮件中心');
  const admin = useAuthStore(selectIsAdmin);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const setAgentOpen = useUiStore((state) => state.setAgentOpen);
  const [params, setParams] = useSearchParams();
  const [folder, setFolder] = React.useState<Folder>('inbox');
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<MailItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [detailError, setDetailError] = React.useState('');
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [reply, setReply] = React.useState(false);
  const [resend, setResend] = React.useState<DevelopmentLetter | null>(null);
  const [resolve, setResolve] = React.useState<'sent' | 'not_sent' | null>(null);
  const [compose, setCompose] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [followups, setFollowups] = React.useState<OutreachFollowUpList | null>(null);
  const [followupBusy, setFollowupBusy] = React.useState(false);
  const [followupCustomer, setFollowupCustomer] = React.useState<Customer | null>(null);
  const [followupSeed, setFollowupSeed] = React.useState<{ analysisId: string; subject: string; content: string } | null>(null);
  const [followupOpen, setFollowupOpen] = React.useState(false);
  const [mailPlan, setMailPlan] = React.useState<MailCustomerPlan | null>(null);
  const [mailPlanBusy, setMailPlanBusy] = React.useState(false);
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
      if (folder === 'followup') {
        const plan = await apiGet<OutreachFollowUpList>('/mail/outreach-followups');
        if (version !== listRequest.current) return;
        setFollowups(plan); setItems([]); setTotal(plan.totals.due); setError('');
        setStatus(await apiGet<SyncStatus>('/mail/status'));
        return;
      }
      const data = await apiGet<Paginated<MailItem>>('/mail', { params: { folder, page } });
      if (version !== listRequest.current) return;
      setItems(data.items); setTotal(data.total); setError('');
      setStatus(await apiGet<SyncStatus>('/mail/status'));
    } catch (e) { setError(toErrorMessage(e)); }
    finally { setLoading(false); }
  }, [folder, page]);
  React.useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, [refresh]);

  const loadDetail = React.useCallback(async () => {
    const version = ++detailRequest.current;
    setDetailError('');
    setDetailLoading(Boolean(selectedId));
    if (!selectedId) { setDetail(null); return; }
    try { const data = await apiGet<Detail>(`/mail/${selectedId}`, { params: { direction } }); if (version === detailRequest.current) setDetail(data); }
    catch (e) { if (version === detailRequest.current) { setDetail(null); setDetailError(toErrorMessage(e)); } }
    finally { if (version === detailRequest.current) setDetailLoading(false); }
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
  const customerPicker = <details className="rounded-2xl border border-border/70 bg-surface/60 px-3.5 py-3" {...(compose ? { open: true } : {})}>
    <summary className="cursor-pointer select-none text-xs font-medium">把邮件关联到一个客户</summary>
    <div className="mt-2.5 space-y-2">
    <Label htmlFor="mail-customer-search" className="sr-only">选择已有客户</Label>
    <Input id="mail-customer-search" placeholder="搜索姓名、公司或邮箱" value={search} onChange={e => setSearch(e.target.value)} />
    <div className="max-h-44 space-y-1 overflow-auto">
      {customers.map(c => <Button key={c.id} variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" disabled={busy}
        onClick={() => { if (compose) { setSelectedCustomer(c); } else if (detail) { void action(() => apiPost(`/mail/${detail.mail.id}/link`, { customerId: c.id })); } }}>
        {c.name} · {c.company || c.email}
      </Button>)}
      {!customers.length && <p className="px-1 text-sm text-muted-foreground">没有匹配客户，请调整搜索。</p>}
    </div>
    </div>
  </details>;

  const startFollowUp = React.useCallback(async (row: OutreachFollowUpItem) => {
    if (followupBusy) return;
    setFollowupBusy(true);
    try {
      const raw = await apiGet<Customer | { customer: Customer }>(`/customers/${row.customerId}`);
      const customer = (raw as { customer?: Customer }).customer ?? (raw as Customer);
      let seed = {
        analysisId: '',
        subject: /^re:/i.test(row.lastSubject || '') ? (row.lastSubject || '') : `Re: ${row.lastSubject || ''}`,
        content: '',
      };
      try {
        const draft = await apiPost<{ subject: string; content: string; note: string }>('/letters/follow-up-draft', { customerId: row.customerId });
        seed = { analysisId: '', subject: draft.subject, content: draft.content };
        toast.success(`已生成第 ${row.nextStep} 封跟进草稿`, { description: draft.note });
      } catch (e) {
        toast.warning('跟进草稿没生成，先手动写', { description: toErrorMessage(e) });
      }
      setFollowupCustomer(customer);
      setFollowupSeed(seed);
      setFollowupOpen(true);
    } catch (e) { toast.error('打不开客户资料', { description: toErrorMessage(e) }); }
    finally { setFollowupBusy(false); }
  }, [followupBusy]);

  const openMailPlan = React.useCallback(async () => {
    if (mailPlanBusy) return;
    setMailPlanBusy(true);
    try {
      const plan = await apiGet<MailCustomerPlan>('/mail/mail-customers/plan');
      setMailPlan(plan);
    } catch (e) { toast.error('看不出方案', { description: toErrorMessage(e) }); }
    finally { setMailPlanBusy(false); }
  }, [mailPlanBusy]);

  const runMailImport = React.useCallback(async () => {
    setMailPlanBusy(true);
    try {
      const result = await apiPost<MailCustomerPlan>('/mail/mail-customers/import');
      toast.success(`建了 ${result.created?.length ?? 0} 个客户`, {
        description: `关联 ${result.linkedMails ?? 0} 封邮件${result.totals.skipSupplier ? `；跳过供应商 ${result.totals.skipSupplier} 封` : ''}`,
      });
      setMailPlan(null);
      await refresh();
    } catch (e) { toast.error('建客户失败', { description: toErrorMessage(e) }); }
    finally { setMailPlanBusy(false); }
  }, [refresh]);

  const syncOk = status?.enabled && status.verificationStatus === 'verified';
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return <div className="workspace-page">
    <PageHeader title="邮件中心" description="客户往来、发送记录与定时任务"
      actions={<>
        {admin ? (
          <Button variant="outline" disabled={mailPlanBusy} onClick={() => void openMailPlan()}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden />从邮件建客户
          </Button>
        ) : null}
        <Button variant="outline" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} aria-hidden />刷新
        </Button>
        <Button aria-pressed={compose} onClick={() => { setCompose(!compose); setSelectedCustomer(null); }}>
          <Mail className="mr-2 h-4 w-4" aria-hidden />写邮件
        </Button>
      </>} />

    <WorkspaceToolbar label="邮件文件夹与操作" className="justify-between">
      <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/60 bg-surface p-1" aria-label="邮件文件夹">
        {(Object.keys(folderLabels) as Folder[]).filter(f => admin || f !== 'unknown').map(f => {
          const active = folder === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => { setFolder(f); setPage(1); setParams({}); }}
              className={cn(
                'inline-flex min-h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'inbox' ? <Inbox className="h-3.5 w-3.5" aria-hidden /> : f === 'sent' ? <Send className="h-3.5 w-3.5" aria-hidden /> : f === 'tasks' ? <Clock className="h-3.5 w-3.5" aria-hidden /> : f === 'followup' ? <BellRing className="h-3.5 w-3.5" aria-hidden /> : <MailSearch className="h-3.5 w-3.5" aria-hidden />}
              {folderLabels[f]}
              {active ? <span className="chip chip-violet ml-0.5 px-1.5 py-0 text-[10px] tabular-nums">{total}</span> : null}
            </button>
          );
        })}
      </div>
      <p className="hidden text-xs text-muted-foreground sm:block">列表自动刷新</p>
    </WorkspaceToolbar>

    {status && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/80 bg-card px-4 py-3 text-xs text-muted-foreground shadow-card">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', syncOk ? 'bg-mint' : 'bg-amberx')} aria-hidden />
        {syncOk
          ? `${status.source === 'personal' ? '个人' : '项目统一'}收件同步${status.mailboxAddress ? `：${status.mailboxAddress}` : ''}`
          : status.enabled ? '收件邮箱还没验证通过' : '收件邮箱未开通：开通后客户的来信会自动进来'}
      </span>
      {syncOk && status.lastSyncAt && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />最近收信 {formatDateTime(status.lastSyncAt)}</span>}
      <span className="inline-flex items-center gap-1"><Send className="h-3 w-3" aria-hidden />发件方式：{status.channel === 'mock' ? '模拟发送' : '邮箱直发'}</span>
      {status.lastError && <span className="inline-flex items-center gap-1 text-destructive"><BellRing className="h-3 w-3" aria-hidden />{admin ? status.lastError : '收件同步出错了，请联系管理员看一下'}</span>}
      {status.skipped > 0 && <span>超大邮件已跳过：{status.skipped}</span>}
      <Button variant="ghost" size="sm" className="ml-auto" disabled={busy || !syncOk || !status.configured} onClick={() => void action(() => apiPost('/mail/sync'))}>立即同步收件</Button>
    </div>}

    {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}
    {compose && !selectedCustomer && customerPicker}

    <div className="mail-workspace grid gap-4 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.5fr)]">
      <section className="panel min-w-0 overflow-hidden" aria-label={folderLabels[folder]} aria-busy={loading}>
        <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">{folderLabels[folder]}<span className="chip chip-muted tabular-nums">{total}</span></p>
          {loading ? <span className="text-[11px] text-muted-foreground">加载中…</span> : null}
        </header>
        {folder === 'followup' ? (
          <div>
            <p className="border-b border-border/50 px-4 py-2 text-[11px] leading-5 text-muted-foreground">
              节奏：第 1 封 → 3 天 → 第 2 封 → 7 天 → 第 3 封 → 14 天仍无回复自动弃用（客户状态改「已流失」并打标签「三次无回复」）
            </p>
            {followups?.items.length ? followups.items.map(row => (
              <div key={row.customerId} className="border-b border-border/50 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link className="min-w-0 truncate text-[0.8125rem] font-medium hover:text-primary" to={`/customers/${row.customerId}`}>
                    {row.company || row.name}
                  </Link>
                  <span className={cn('chip shrink-0', row.overdueDays > 0 ? 'chip-amber' : 'chip-muted')}>
                    {row.overdueDays > 0 ? `逾期 ${row.overdueDays} 天` : '今天到期'}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.name}{row.email ? ` · ${row.email}` : ''}</p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  已发第 {row.step} 封：{row.lastSubject || '（无主题）'}{row.lastSentAt ? ` · ${formatDateTime(row.lastSentAt)}` : ''}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="chip chip-violet">该发第 {row.nextStep} 封</span>
                  <Button size="sm" className="ml-auto" disabled={followupBusy} onClick={() => void startFollowUp(row)}>
                    {followupBusy
                      ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />生成草稿中…</>
                      : <><Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden /></>}写第 {row.nextStep} 封
                  </Button>
                </div>
              </div>
            )) : (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {loading ? '正在算跟进计划…' : '目前没有到期的开发信跟进'}
              </p>
            )}
          </div>
        ) : (<>
        {!items.length && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{loading ? '正在加载邮件…' : '此文件夹暂无邮件'}</p>}
        {items.map(item => {
          const unread = item.direction === 'inbound' && !item.read;
          const selected = selectedId === item.id;
          const who = item.direction === 'inbound' ? (item.fromName || item.from) : item.to.join(', ');
          return (
            <button
              key={item.id}
              onClick={() => open(item)}
              className={cn(
                'block w-full border-b border-border/50 px-4 py-3 text-left transition-colors',
                'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                selected && 'bg-primary-soft/60',
              )}
            >
              <span className="flex items-start gap-2.5">
                <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold', item.direction === 'inbound' ? 'bg-mint-soft text-mint' : 'bg-primary-soft text-primary')} aria-hidden>
                  {initialsOf(who)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn('min-w-0 truncate text-[0.8125rem]', unread ? 'font-semibold text-foreground' : 'text-foreground/85')}>
                      {unread ? <span className="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary align-middle" aria-label="未读" /> : null}
                      {who || '（未知发件人）'}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(item.scheduledAt || item.sentAt)}</span>
                  </span>
                  <span className={cn('mt-0.5 block truncate text-[0.8125rem]', unread ? 'font-medium text-foreground' : 'text-muted-foreground')}>{item.subject || '（无主题）'}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusChip status={item.status} />
                    <span className={cn('chip chip-muted', !item.customerId && !item.prospectId && 'opacity-65')}>{item.customerId ? (item.customerName || '已关联客户') : item.prospectId ? `线索 · ${item.prospectName || '已匹配线索'}` : '未关联客户'}</span>
                    {item.attachments.length > 0 && <span className="chip chip-muted"><Paperclip className="h-3 w-3" aria-hidden />{item.attachments.length}</span>}
                  </span>
                </span>
              </span>
              {item.direction === 'outbound' && ['sent', 'opened'].includes(item.status || '') && <span className="mt-2 block pl-[2.625rem]"><MailInteractionSummary sentAt={item.sentAt} tracking={item.tracking} /></span>}
            </button>
          );
        })}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <Button variant="ghost" size="sm" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span className="text-xs tabular-nums text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page * 25 >= total || loading} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div>
        </>)}
      </section>

      <section className="panel min-w-0 p-4 sm:p-5" aria-label="邮件会话详情">
        {!detail
          ? folder === 'followup' ? (
            <div className="mx-auto max-w-lg space-y-3 py-8 text-sm">
              <h3 className="text-[0.9375rem] font-semibold">开发信三段式跟进</h3>
              <p className="text-xs leading-6 text-muted-foreground">
                第 1 封发出 → <b>3 天</b> → 第 2 封 → <b>7 天</b> → 第 3 封 → <b>14 天</b> → 仍无回复即弃用。
                客户一有回信就立刻停表，不再出现在左边。
              </p>
              <ul className="space-y-2 text-xs leading-6 text-muted-foreground">
                <li>· 左边只列<b>到期（含今天到期）且还没回复</b>的客户，标题是上一封的主题，方便接着上文写。</li>
                <li>· 点「写第 N 封」直接打开写信面板，发给同一个人，系统会自动记成第 N 封并排下一次跟进。</li>
                <li>· 第三封后 14 天仍无回复：客户状态自动改「已流失」并打标签<b>三次无回复</b>，不再提醒。</li>
                <li>· 逾期客户同时会出现在「今日开发」的逾期跟进里，两处数据一致。</li>
                <li>· 弃用客户如果重新发信，按新一轮从第 1 封重新算。</li>
              </ul>
            </div>
          ) : detailError
            ? <ErrorState title="无法读取这封邮件" description={detailError} onRetry={() => void loadDetail()} retrying={detailLoading} />
            : <EmptyState icon={<MailSearch className="h-6 w-6" aria-hidden />} title={detailLoading ? '正在加载邮件详情…' : '选择一封邮件'} description="在左侧点开任意一封邮件，这里会显示完整正文、附件和往来会话。" />
          : <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="break-words text-[1.0625rem] font-semibold leading-snug tracking-[-0.01em]">{detail.mail.subject || '（无主题）'}</h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('chip', detail.mail.direction === 'inbound' ? 'chip-mint' : 'chip-violet')}>
                  {detail.mail.direction === 'inbound' ? <><ArrowDownLeft className="h-3 w-3" aria-hidden />收到</> : <><ArrowUpRight className="h-3 w-3" aria-hidden />发出</>}
                </span>
                <StatusChip status={detail.mail.status} />
                <span className="chip chip-muted"><Clock className="h-3 w-3" aria-hidden />{formatDateTime(detail.mail.sentAt)}</span>
                {detail.customer
                  ? <Link className="chip chip-muted hover:text-primary" to={`/customers/${detail.customer.id}`}>客户：{detail.customer.name}{detail.customer.company ? ` · ${detail.customer.company}` : ''}</Link>
                  : <span className="chip chip-amber">未关联客户</span>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-y border-border/50 py-3">
              {detail.mail.direction === 'inbound' && <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(() => apiPost(`/mail/${detail.mail.id}/read`, { read: !detail.mail.read }))}>{detail.mail.read ? '标记未读' : '标记已读'}</Button>}
              {detail.customer && detail.mail.direction === 'inbound' && (!detail.mail.mailboxUserId || detail.mail.mailboxUserId === currentUserId)
                ? <Button size="sm" onClick={() => setReply(true)}><Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden />回复客户</Button>
                : detail.mail.direction === 'inbound' && detail.mail.mailboxUserId ? <Badge variant="warning">请由邮箱所属业务员回复</Badge> : null}
              <Button variant="outline" size="sm" onClick={() => setAgentOpen(true)}><MailSearch className="mr-1.5 h-3.5 w-3.5" aria-hidden />邮件会话助理</Button>
              {detail.mail.status && ['scheduled', 'queued', 'retrying'].includes(detail.mail.status) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(() => apiPost(`/mail/${detail.mail.id}/cancel`))}>取消任务</Button>}
              {detail.customer && detail.mail.status === 'failed' && !detail.mail.needsReview && <Button size="sm" disabled={busy} onClick={() => void action(async () => { setResend(await apiGet<DevelopmentLetter>(`/letters/${detail.mail.id}`)); })}>编辑并重新发送</Button>}
              {admin && detail.mail.needsReview && <><Button variant="outline" size="sm" onClick={() => setResolve('sent')}>已核实投递成功</Button><Button variant="outline" size="sm" onClick={() => setResolve('not_sent')}>已核实未投递</Button></>}
            </div>

            {!detail.customer && admin && customerPicker}

            {detail.thread.map(mail => (
              <article key={mail.id} className="space-y-3 rounded-2xl border border-border/70 bg-card p-3.5">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold', mail.direction === 'inbound' ? 'bg-mint-soft text-mint' : 'bg-primary-soft text-primary')} aria-hidden>
                      {initialsOf(mail.direction === 'inbound' ? (mail.fromName || mail.from) : mail.to.join(', '))}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[0.8125rem] font-medium">{mail.direction === 'inbound' ? (mail.fromName || mail.from) : `发件人：${mail.from}`}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{formatDateTime(mail.sentAt)} · 收件人 {mail.to.join(', ') || '—'}{mail.cc.length > 0 ? ` · 抄送 ${mail.cc.join(', ')}` : ''}</p>
                    </div>
                  </div>
                  <StatusChip status={mail.status} />
                </header>

                {mail.error && <p role="status" className="rounded-xl bg-destructive/5 px-3 py-2 text-xs text-destructive">{mail.error}{mail.needsReview ? '（待核实，不会自动重发）' : ''}</p>}
                {mail.scheduledAt && <p className="text-[11px] text-muted-foreground">定时时间：{formatDateTime(mail.scheduledAt)}</p>}
                {mail.status === 'retrying' && <p className="text-[11px] text-muted-foreground">下次重试：{formatDateTime(mail.nextAttemptAt)} · 已尝试 {mail.attempts} 次</p>}

                {mail.direction === 'outbound' && ['sent', 'opened'].includes(mail.status || '') && <MailInteractionSummary sentAt={mail.sentAt} tracking={mail.tracking} detailed />}

                {mail.html
                  ? <iframe title={`邮件正文：${mail.subject}`} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="min-h-64 w-full rounded-xl border border-border/60 bg-white" srcDoc={mailSrcdoc(mail.html)} />
                  : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{mail.text || '（无正文）'}</p>}

                {mail.attachments.map(a => <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface/70 px-3 py-2 text-xs">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 break-all">{a.name} · {Math.ceil(a.size / 1024)} KB</span>
                  {a.blocked ? <span className="text-destructive">{a.blocked}</span> : <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={() => void action(() => downloadFile(`/mail/${mail.id}/attachments/${a.id}`, a.name))}>下载</Button>}
                </div>)}

                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer py-1">邮件标识与发送记录</summary>
                  <div className="space-y-1 pt-1">
                    <p className="break-all">邮件编号：{mail.messageId || '未提供'}</p>
                    {mail.inReplyTo && <p className="break-all">回复引用：{mail.inReplyTo}</p>}
                    {mail.history?.map((h, i) => <p key={i}>{formatDateTime(h.at)} · {LETTER_STATUS_LABEL[h.status]} {h.error}</p>)}
                  </div>
                </details>
              </article>
            ))}
          </div>}
      </section>
    </div>
    <SendLetterDialog open={reply} onOpenChange={setReply} customer={detail?.customer || null} reply={detail ? { id: detail.mail.id, subject: detail.mail.subject, from: detail.mail.from } : undefined} onSent={() => { void refresh(); void loadDetail(); }} />
    <SendLetterDialog open={!!resend} onOpenChange={v => { if (!v) setResend(null); }} customer={detail?.customer || null} letter={resend} onSent={() => { void refresh(); void loadDetail(); }} />
    <SendLetterDialog open={compose && !!selectedCustomer} onOpenChange={v => { if (!v) { setCompose(false); setSelectedCustomer(null); } }} customer={selectedCustomer} onSent={() => { void refresh(); }} />
    <SendLetterDialog
      open={followupOpen}
      onOpenChange={(v) => { setFollowupOpen(v); if (!v) { setFollowupCustomer(null); setFollowupSeed(null); } }}
      customer={followupCustomer}
      initialDraft={followupSeed}
      onSent={() => { void refresh(); }}
    />
    <ConfirmDialog
      open={!!mailPlan}
      onOpenChange={(next) => { if (!next) setMailPlan(null); }}
      title="从邮件建客户"
      description={mailPlan
        ? mailPlan.totals.create > 0
          ? `将新建 ${mailPlan.items.filter(i => i.action === 'create').length} 个客户，关联 ${mailPlan.totals.mails} 封邮件；供应商、平台通知、已在线索池的会跳过。客户状态记为「已联系」，来源标为「邮件来访」。`
          : '暂时没有可建的客户：剩下的未关联来信都是供应商/账务往来、平台通知，或者已经在线索池里了。'
        : ''}
      confirmText={mailPlan && mailPlan.totals.create > 0 ? '建这些客户' : '关闭'}
      loading={mailPlanBusy}
      onConfirm={mailPlan && mailPlan.totals.create > 0 ? runMailImport : () => setMailPlan(null)}
    >
      {mailPlan && mailPlan.totals.create > 0 ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-border/70">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-muted-foreground">
              <tr><th className="p-2">公司 / 联系人</th><th className="p-2">邮箱</th><th className="p-2 text-right">来信</th><th className="p-2">处理</th></tr>
            </thead>
            <tbody>
              {mailPlan.items.filter(i => i.action === 'create' || i.action === 'link').map(item => (
                <tr key={item.key} className="border-t border-border/50">
                  <td className="p-2">{item.company || item.name}</td>
                  <td className="p-2 text-muted-foreground">{item.email}</td>
                  <td className="p-2 text-right tabular-nums">{item.mailCount}</td>
                  <td className="p-2">{item.action === 'create' ? '新建客户' : `挂到已有客户${item.reason ? `（${item.reason}）` : ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {mailPlan && (mailPlan.totals.skipSupplier || mailPlan.totals.skipSystem || mailPlan.totals.skipProspect) ? (
        <p className="text-xs text-muted-foreground">
          跳过：供应商/账务 {mailPlan.totals.skipSupplier} 封、平台通知 {mailPlan.totals.skipSystem} 封、已在线索池 {mailPlan.totals.skipProspect} 封
        </p>
      ) : null}
    </ConfirmDialog>
    <ConfirmDialog open={!!resolve} onOpenChange={v => { if (!v) setResolve(null); }} title="确认投递核实结果" description={resolve === 'sent' ? '请仅在邮箱或服务器记录已确认投递成功后操作。此操作会将任务标记为已发送。' : '请仅在邮箱或服务器记录已确认未投递后操作。此操作解除待核实状态，之后可以手动重新发送。'} loading={busy}
      onConfirm={() => action(async () => { await apiPost(`/mail/${detail?.mail.id}/resolve`, { outcome: resolve }); setResolve(null); })} />
  </div>;
}
