import * as React from 'react';
import {ProspectingSettingsDialog,ProspectingRunDialog} from '@/components/prospecting/search-profile-dialogs';
import {
  AtSign, Check, ExternalLink, FileSpreadsheet, Instagram, Linkedin, Loader2, Play, RefreshCw, Settings2, Sparkles, Target, Wand2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { CountryFlag } from '@/components/common/country-flag';
import { countryInfo } from '@/lib/country';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ImportDialog } from '@/components/customers/import-dialog';
import { EnrichDialog } from '@/components/prospecting/enrich-dialog';
import { usePageTitle } from '@/hooks/use-ui';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { Prospect, ProspectingReport, ProspectingToday } from '@/types';

const STATUS_LABEL: Record<Prospect['status'], string> = {
  ready: '可发送', needs_contact: '待补联系方式', low: '评分不足', rejected: '已跳过', converted: '已转客户',
};

function socialHref(value:string,host:string,prefix=''){
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.hostname.replace(/^www\./,'')===host?url.href:undefined;}
 catch{return /^[\w.%-]{1,100}$/.test(value)?'https://'+host+'/'+prefix+encodeURIComponent(value):undefined;}
}
function scoreClass(score: number) {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (score >= 60) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-muted text-muted-foreground';
}

function ProspectCard({ prospect, today, busy, onApprove, onReject,onSync,onRefresh,selectable,selected,onToggle }: {
  prospect: Prospect; today: string; busy: boolean;
  onApprove: (id: string) => void; onReject: (id: string) => void;onSync?:(id:string)=>void;onRefresh?:(id:string)=>void;
  /** 可批量转换的候选才显示勾选框 */
  selectable?: boolean; selected?: boolean; onToggle?: (id: string) => void;
}) {
  const converted = prospect.status === 'converted';
  return (
    <div className={cn('rounded-2xl border border-border/80 bg-card shadow-card p-4', selected && 'border-primary/50 ring-1 ring-primary/20')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {selectable ? (
            <Checkbox
              checked={Boolean(selected)}
              disabled={busy}
              onCheckedChange={() => onToggle?.(prospect.id)}
              aria-label={`选择 ${prospect.name || prospect.company || prospect.domain}`}
              className="mt-3"
            />
          ) : null}
          <span className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold', scoreClass(prospect.score))} title="系统打分：按资料完整度和匹配度算的">
            {prospect.score}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {prospect.website ? (
                <a href={prospect.website} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
                  {prospect.name || prospect.company || prospect.domain}
                </a>
              ) : (
                <span className="truncate font-medium">{prospect.name || prospect.company || prospect.domain}</span>
              )}
              {prospect.source === 'excel' ? <Badge variant="muted" title="从 Excel 导入，没有抓取到的网站资料">Excel 导入</Badge> : null}
              <Badge variant={converted ? 'developed' : prospect.status === 'ready' ? 'default' : 'outline'}>{STATUS_LABEL[prospect.status]}</Badge>
              {prospect.aiScore !== undefined ? <Badge variant="outline" title="AI 按客户画像评分">AI {prospect.aiScore}</Badge> : null}
              {prospect.outcome && prospect.outcome.replied > 0 ? <Badge variant="developed">已回复</Badge> : null}
              {prospect.day !== today ? <Badge variant="muted" title="之前没处理完的候选">{prospect.day.slice(5)}</Badge> : null}
              {prospect.country ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CountryFlag value={prospect.country} />
                  {countryInfo(prospect.country)?.name ?? prospect.country}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{prospect.domain}{prospect.snippet ? ` · ${prospect.snippet}` : ''}</p>
            {prospect.contactName || prospect.contactTitle ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{prospect.contactName}{prospect.contactName && prospect.contactTitle ? ' · ' : ''}{prospect.contactTitle}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {converted && prospect.customerId ? (
            <>
              <Button size="sm" variant="outline" onClick={() => { window.location.assign(`/customers/${prospect.customerId}`); }}>
                <ExternalLink className="h-4 w-4" aria-hidden />查看客户
              </Button>
              {prospect.draftTaskId ? (
                <Button size="sm" onClick={() => { window.location.assign(`/customers/${prospect.customerId}?outreachTask=${prospect.draftTaskId}`); }}>
                  <Sparkles className="h-4 w-4" aria-hidden />查看草稿
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy || !prospect.emails.length} title={prospect.emails.length ? '' : '没有邮箱，先补联系方式'} onClick={() => onApprove(prospect.id)}>
                <Check className="h-4 w-4" aria-hidden />转为客户
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(prospect.id)}>
                <X className="h-4 w-4" aria-hidden />跳过
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {prospect.emails.map((email) => (
          <a key={email} href={`mailto:${email}`} className="inline-flex items-center gap-1 text-primary hover:underline"><AtSign className="h-3.5 w-3.5" aria-hidden />{email}</a>
        ))}
        {prospect.instagram ? <a href={socialHref(prospect.instagram,'instagram.com')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><Instagram className="h-3.5 w-3.5" aria-hidden />Instagram</a> : null}
        {prospect.emailSource === 'hunter' ? <Badge variant="outline" className="font-normal">Hunter{prospect.emailConfidence ? ` ${prospect.emailConfidence}%` : ''}</Badge> : null}
        {prospect.linkedin ? <a href={socialHref(prospect.linkedin,'linkedin.com','company/')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><Linkedin className="h-3.5 w-3.5" aria-hidden />LinkedIn</a> : null}
        {prospect.sourceUrl ? <a href={prospect.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><ExternalLink className="h-3.5 w-3.5" aria-hidden />来源</a> : null}
        {converted && prospect.outcome ? (
          <span className="text-xs text-muted-foreground">已发 {prospect.outcome.sent} · 回复 {prospect.outcome.replied} · 退信 {prospect.outcome.bounced}</span>
        ) : null}
      </div>
      {converted&&onSync&&<Button type="button" variant="outline" className="mt-3 min-h-11" disabled={busy} onClick={()=>onSync(prospect.id)}>补齐已获取资料</Button>}
      {onRefresh&&<div className="mt-2 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={()=>onRefresh(prospect.id)}>{busy?'正在处理…':converted?'重新采集并补齐空白项':'重新采集官网资料'}</Button><span className="text-xs text-muted-foreground">最多读取 3 个官网页面，消耗 Firecrawl 额度；保留客户已有内容。</span></div>}
      <details className="mt-3 rounded-md border bg-muted/20 p-3 text-sm"><summary className="min-h-11 cursor-pointer font-medium">查看将导入客户的资料</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2">{[
 ['公司',prospect.company],['联系人',prospect.contactName],['职位',prospect.contactTitle],['电话',prospect.phone],['国家 / 地区',prospect.country],['行业',prospect.industry],['地址',prospect.address],['Instagram',prospect.instagram],['LinkedIn',prospect.linkedin],['Facebook',prospect.facebook],['WhatsApp',prospect.whatsapp],
 ].map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value||'暂时没有'}</dd></div>)}</dl><p className="mt-3 text-xs leading-6 text-muted-foreground">抓到的资料和官网简介会一起存进客户档案；查不到的保持空白，也不会拿网站卖的东西去猜采购需求。</p></details>
      {prospect.notes ? (
        <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{prospect.notes}</p>
      ) : prospect.excerpt ? (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{prospect.excerpt}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {prospect.reasons.map((reason) => <Badge key={reason} variant="outline" className="font-normal text-muted-foreground">{reason}</Badge>)}
      </div>
    </div>
  );
}

export function ProspectingPage(): React.JSX.Element {
  usePageTitle('今日开发');
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const [data, setData] = React.useState<ProspectingToday | null>(null);
  const [report, setReport] = React.useState<ProspectingReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  /** 一键转换进度；null 表示没在批量转换 */
  const [batch, setBatch] = React.useState<{ total: number; done: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [runOpen, setRunOpen] = React.useState(false);
  const [configOpen, setConfigOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [enrichOpen, setEnrichOpen] = React.useState(false);
  /** 线索池筛选：池子上千条时不可能一次全渲染 */
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'ready' | 'needs_contact' | 'low'>('all');
  const load = React.useCallback(
    async (options: { offset?: number; append?: boolean } = {}) => {
      try {
        const offset = options.offset ?? 0;
        const query = `/prospecting/today?status=${statusFilter}${offset > 0 ? `&offset=${offset}` : ''}`;
        const [today, summary] = await Promise.all([
          apiGet<ProspectingToday>(query),
          apiGet<ProspectingReport>('/prospecting/report?days=14').catch(() => null),
        ]);
        setData((previous) =>
          options.append && previous
            ? { ...today, prospects: [...previous.prospects, ...today.prospects] }
            : today,
        );
        if (summary) setReport(summary);
      } catch (error) {
        toast.error('加载失败', { description: toErrorMessage(error, '请稍后重试') });
      } finally {
        setLoading(false);
      }
    },
    [statusFilter],
  );

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (data?.run?.status !== 'running') return;
    const timer = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [data?.run?.status, load]);

  const openRun = () => setRunOpen(true);

  const approve = async (id: string) => {
    setBusy(id);
    try {
      const result = await apiPost<{ customer: { id: string; name: string }; draftTaskId?: string; draftError?: string; duplicates?: { id: string; name: string; reason: string }[] }>(`/prospecting/${id}/approve`, {});
      toast.success('已转为正式客户', {
        description: result.draftError
          ? `草稿任务未创建：${result.draftError}`
          : result.draftTaskId ? '首封草稿正在后台生成，完成后在“查看草稿”里审核' : (result.customer?.name ?? '可在客户管理里继续写开发信'),
      });
      // 库里已有同公司名 / 同电话的客户：提醒核对，避免一条线索变两条记录
      if (result.duplicates?.length) {
        toast.warning('客户库里可能有重复', {
          description: `${result.duplicates.map((item) => `${item.name}（${item.reason}）`).join('；')}，请到客户管理核对是否同一家。`,
          duration: 12000,
        });
      }
      await load();
    } catch (error) {
      toast.error('转换失败', { description: toErrorMessage(error, '请稍后重试') });
    } finally { setBusy(null); }
  };

  const reject = async (id: string) => {
    setBusy(id);
    try {
      await apiPost(`/prospecting/${id}/reject`, { reason: '人工跳过' });
      await load();
    } catch (error) {
      toast.error('操作失败', { description: toErrorMessage(error, '请稍后重试') });
    } finally { setBusy(null); }
  };

  const sync = async(id:string)=>{setBusy(id);try{const result=await apiPost<{filledFields:string[]}>('/prospecting/'+id+'/sync-customer',{});toast.success(result.filledFields.length?'已补齐 '+result.filledFields.length+' 个空字段':'资料已核对',{description:'只补空白项，已有内容不动；来源和简介也能在候选资料里看到。'});await load();}catch(error){toast.error('补齐失败',{description:toErrorMessage(error)});}finally{setBusy(null);}};
  const refreshContact=async(id:string)=>{setBusy(id);try{const result=await apiPost<{filledFields:string[]}>('/prospecting/'+id+'/refresh-contact',{},{timeout:600000});toast.success('官网资料已更新',{description:result.filledFields.length?'已补齐客户 '+result.filledFields.length+' 个空字段':'已保留可读取资料，客户已有内容未覆盖。'});await load();}catch(error){toast.error('重新采集失败',{description:toErrorMessage(error)});}finally{setBusy(null);}};
  const openConfig = () => setConfigOpen(true);

  /** 勾中的候选 id（只对可转换的候选生效） */
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  /** 本次确认框要转换的候选 */
  const [pendingTargets, setPendingTargets] = React.useState<Prospect[]>([]);

  const isConvertible = React.useCallback(
    (item: Prospect) => item.status !== 'converted' && item.emails.length > 0,
    [],
  );

  const toggleSelected = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const convertSelectedOrGroup = (targets: Prospect[], groupItems: Prospect[]) => {
    const picked = groupItems.filter((item) => selected.has(item.id) && isConvertible(item));
    const chosen = picked.length ? picked : targets;
    if (!chosen.length) return;
    setPendingTargets(chosen);
    setConfirmOpen(true);
  };

  /**
   * 批量转客户：逐个调用单条 approve，失败的跳过并继续，最后汇总。
   * 单条接口本身是幂等的（并发/重试都只建一次客户），所以这里按顺序跑，进度可见。
   */
  const approveAll = async () => {
    const targets = pendingTargets;
    setConfirmOpen(false);
    if (!targets.length) return;
    setBatch({ total: targets.length, done: 0 });
    let ok = 0;
    let failed = 0;
    let draftErrors = 0;
    // 失败原因（含查重拦下的重复线索）逐条记下来，最后一起提示
    const failedReasons: string[] = [];
    for (const prospect of targets) {
      try {
        const result = await apiPost<{ customer?: { id: string; name: string }; draftTaskId?: string; draftError?: string }>(`/prospecting/${prospect.id}/approve`, {});
        ok += 1;
        if (result?.draftError) draftErrors += 1;
      } catch (error) {
        failed += 1;
        const label = prospect.contactName || prospect.company || prospect.domain;
        failedReasons.push(`${label}：${toErrorMessage(error, '转换失败')}`);
      }
      setBatch((prev) => (prev ? { total: prev.total, done: prev.done + 1 } : prev));
    }
    setBatch(null);
    setSelected(new Set());
    setPendingTargets([]);
    await load();
    toast.success(`已转换 ${ok} 个客户`, {
      description: [
        failed ? `${failed} 个没转成：${failedReasons.slice(0, 3).join('；')}${failedReasons.length > 3 ? '…' : ''}` : '',
        draftErrors ? `${draftErrors} 个首封草稿未创建` : '首封草稿在后台生成，完成后在“查看草稿”里审核',
      ].filter(Boolean).join('；'),
    });
  };

  const run = data?.run;
  const counts = data?.counts;
  const groups: { key: Prospect['status']; title: string; items: Prospect[] }[] = [
    { key: 'ready', title: '可以发送', items: data?.prospects.filter((item) => item.status === 'ready') ?? [] },
    { key: 'needs_contact', title: '需要补联系方式', items: data?.prospects.filter((item) => item.status === 'needs_contact') ?? [] },
    { key: 'low', title: '评分不足', items: data?.prospects.filter((item) => item.status === 'low') ?? [] },
    { key: 'rejected', title: '已跳过', items: data?.prospects.filter((item) => item.status === 'rejected') ?? [] },
  ];
  const converted = data?.prospects.filter((item) => item.status === 'converted') ?? [];

  return (
    <div className="workspace-page">
      <PageHeader
        title="今日开发"
        description="按客户画像搜索候选品牌，也可以导入自己的 Excel 名单；补全联系方式、审核后转为正式客户，再写开发信。"
        actions={isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="h-4 w-4" aria-hidden />导入线索</Button>
            <Button type="button" variant="outline" onClick={() => setEnrichOpen(true)}><Wand2 className="h-4 w-4" aria-hidden />批量补全</Button>
            <Button type="button" variant="outline" onClick={() => void openConfig()}><Settings2 className="h-4 w-4" aria-hidden />搜索设置</Button>
            <Button type="button" onClick={() => void openRun()} disabled={run?.status === 'running'}>
              {run?.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {run?.status === 'running' ? '生成中…' : '立即生成今日候选'}
            </Button>
          </div>
        ) : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '待处理候选', value: counts?.total ?? 0, icon: Target },
          { label: '可以发送', value: counts?.ready ?? 0, icon: Check },
          { label: '待补联系方式', value: counts?.needsContact ?? 0, icon: AtSign },
          { label: '已转客户', value: counts?.converted ?? 0, icon: Sparkles },
        ].map((item) => (
          <Card key={item.label}><CardContent className="flex items-center justify-between p-4">
            <div><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 text-2xl font-semibold">{item.value}</p></div>
            <item.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
          </CardContent></Card>
        ))}
      </div>

      {counts?.carriedFromEarlier ? (
        <p className="text-xs text-muted-foreground">其中 {counts.carriedFromEarlier} 个是之前没处理完的候选，会一直保留到转客户或跳过。</p>
      ) : null}

      {run ? (
        <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 text-sm',
          run.status === 'failed' ? 'border-destructive/30 bg-destructive/5 text-destructive' : run.status === 'running' ? 'border-amber-300/60 bg-amber-50 text-amber-900' : 'bg-muted/30')}>
          {run.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          <span>本轮{run.profileName?'（'+run.profileName+'）':''}：搜索到 {run.imported} 个域名，去重后 {run.deduped} 个，补全 {run.enriched} 个，Hunter 补到 {run.hunterFound} 个邮箱，入选 {run.selected} 个</span>
          {run.failed.length ? <span className="text-xs text-muted-foreground">{run.failed.length} 条失败</span> : null}
          {run.error ? <span>{run.error}</span> : null}
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" aria-hidden />刷新</Button>
        </div>
      ) : null}

      {(() => {
        const totalOpen = (data?.counts.ready ?? 0) + (data?.counts.needsContact ?? 0) + (data?.counts.low ?? 0);
        const tabs: { key: typeof statusFilter; label: string; count: number }[] = [
          { key: 'all', label: '全部待处理', count: totalOpen },
          { key: 'ready', label: '可以发送', count: data?.counts.ready ?? 0 },
          { key: 'needs_contact', label: '待补联系方式', count: data?.counts.needsContact ?? 0 },
        ];
        if ((data?.counts.low ?? 0) > 0) tabs.push({ key: 'low', label: '低优先', count: data?.counts.low ?? 0 });
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={statusFilter === tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  statusFilter === tab.key
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                <span className="ml-1 tabular-nums">{tab.count}</span>
              </button>
            ))}
            {data?.hasMore ? (
              <span className="ml-auto text-xs text-muted-foreground">
                共 {data.openTotal ?? 0} 条，已显示 {data.prospects.length} 条
              </span>
            ) : null}
          </div>
        );
      })()}

      {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {!loading && !data?.prospects.length ? (
        <div className="rounded-2xl border border-border/80 bg-card shadow-card p-8 text-center">
          <Target className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">今天还没有候选</p>
          <p className="mt-1 text-sm text-muted-foreground">{isAdmin ? '点右上角「立即生成今日候选」按客户画像跑一轮，或者「导入线索」把手里已有的名单导进来。' : '管理员生成或导入了新线索后，候选会出现在这里等待审核。'}</p>
        </div>
      ) : null}

      {groups.filter((group) => group.items.length).map((group) => {
        // 只对「可以发送 / 需要补联系方式」提供批量转换：评分不足和已跳过不应该被一键转走
        const supportsBulk = group.key === 'ready' || group.key === 'needs_contact';
        const convertible = supportsBulk ? group.items.filter(isConvertible) : [];
        const chosen = convertible.filter((item) => selected.has(item.id));
        const allChosen = convertible.length > 0 && chosen.length === convertible.length;
        return (
        <section key={group.key} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{group.title}</h2>
            <Badge variant="muted">{group.items.length}</Badge>
            {convertible.length ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(batch)}
                  onClick={() => setSelected((prev) => {
                    const next = new Set(prev);
                    if (allChosen) convertible.forEach((item) => next.delete(item.id));
                    else convertible.forEach((item) => next.add(item.id));
                    return next;
                  })}
                >
                  {allChosen ? '取消全选' : `全选（${convertible.length}）`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={Boolean(batch) || !convertible.length}
                  title={chosen.length
                    ? `只转换勾选的 ${chosen.length} 个候选`
                    : `把本组 ${convertible.length} 个已有邮箱的候选一次转为正式客户，并各自创建首封开发信草稿（不发送）`}
                  onClick={() => convertSelectedOrGroup(convertible, group.items)}
                >
                  {batch ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                  {batch
                    ? `转换中 ${batch.done}/${batch.total}`
                    : chosen.length ? `转换选中（${chosen.length}）` : `一键转为客户（${convertible.length}）`}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            {group.items.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} today={data?.day ?? ''} busy={busy === prospect.id || Boolean(batch)}
                selectable={supportsBulk && isConvertible(prospect)} selected={selected.has(prospect.id)} onToggle={toggleSelected}
                onRefresh={isAdmin?id=>void refreshContact(id):undefined} onApprove={(id) => void approve(id)} onReject={(id) => void reject(id)} />
            ))}
          </div>
        </section>
        );
      })}

      {converted.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">今天已转客户</h2>
          <div className="space-y-2">
            {converted.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} today={data?.day ?? ''} busy={busy===prospect.id} onSync={id=>void sync(id)} onRefresh={isAdmin?id=>void refreshContact(id):undefined} onApprove={() => undefined} onReject={() => undefined} />
            ))}
          </div>
        </section>
      ) : null}

      {data?.hasMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const openLoaded = data.prospects.filter((item) => ['ready', 'needs_contact', 'low'].includes(item.status)).length;
              void load({ offset: (data.offset ?? 0) + openLoaded, append: true });
            }}
          >
            加载更多（还有 {(data.openTotal ?? 0) - data.prospects.length} 条）
          </Button>
        </div>
      ) : null}

      {report && report.runs.length ? (
        <section className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">近 {report.days} 天运行记录</h2>
              <p className="text-xs text-muted-foreground">{report.sinceDay} 至 {report.today}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['候选', report.totals.candidates], ['可发', report.totals.ready], ['已转', report.totals.converted],
                ['发出', report.totals.sent], ['回复', report.totals.replies], ['退信', report.totals.bounced],
              ].map(([label, value]) => <Badge key={String(label)} variant="outline">{label} {value}</Badge>)}
            </div>
          </div>
          {report.warning ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{report.warning.message}</div>
          ) : null}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {['日期', '状态', '搜索', '去重', '补全', 'Hunter', '入选', '失败'].map((title) => (
                    <th key={title} className="px-3 py-2 text-left font-medium">{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.runs.slice(0, 10).map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-3 py-2">{entry.day.slice(5)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={entry.status === 'failed' ? 'outline' : entry.status === 'running' ? 'muted' : 'developed'}>
                        {entry.status === 'completed' ? '完成' : entry.status === 'partial' ? '部分完成' : entry.status === 'running' ? '运行中' : '失败'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{entry.imported}</td>
                    <td className="px-3 py-2">{entry.deduped}</td>
                    <td className="px-3 py-2">{entry.enriched}</td>
                    <td className="px-3 py-2">{entry.hunterFound}</td>
                    <td className="px-3 py-2">{entry.selected}</td>
                    <td className="px-3 py-2">{entry.failed.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        entry="prospecting"
        onImported={() => void load()}
      />

      <EnrichDialog open={enrichOpen} onOpenChange={setEnrichOpen} onCompleted={() => void load()} />

      <ProspectingRunDialog open={runOpen} onOpenChange={setRunOpen} onCompleted={()=>void load()}/>
      <ProspectingSettingsDialog open={configOpen} onOpenChange={setConfigOpen} onCompleted={()=>{toast.success('搜索方案已保存');void load();}}/>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>一键转为客户？</AlertDialogTitle>
            <AlertDialogDescription>
              将把 {pendingTargets.length} 个候选转为正式客户，并各自创建首封开发信草稿（不会发送邮件）。
              没有邮箱的候选会自动跳过；转换过程中失败的会单独汇总，可稍后重试。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void approveAll()}>开始转换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
