import * as React from 'react';
import {ProspectingSettingsDialog,ProspectingRunDialog} from '@/components/prospecting/search-profile-dialogs';
import {
  AtSign, Check, ExternalLink, Instagram, Linkedin, Loader2, Play, RefreshCw, Settings2, Sparkles, Target, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

function ProspectCard({ prospect, today, busy, onApprove, onReject,onSync,onRefresh }: {
  prospect: Prospect; today: string; busy: boolean;
  onApprove: (id: string) => void; onReject: (id: string) => void;onSync?:(id:string)=>void;onRefresh?:(id:string)=>void;
}) {
  const converted = prospect.status === 'converted';
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold', scoreClass(prospect.score))} title="规则评分">
            {prospect.score}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <a href={prospect.website} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
                {prospect.name || prospect.company || prospect.domain}
              </a>
              <Badge variant={converted ? 'developed' : prospect.status === 'ready' ? 'default' : 'outline'}>{STATUS_LABEL[prospect.status]}</Badge>
              {prospect.aiScore !== undefined ? <Badge variant="outline" title="AI 按客户画像评分">AI {prospect.aiScore}</Badge> : null}
              {prospect.outcome && prospect.outcome.replied > 0 ? <Badge variant="developed">已回复</Badge> : null}
              {prospect.day !== today ? <Badge variant="muted" title="之前没处理完的候选">{prospect.day.slice(5)}</Badge> : null}
              {prospect.country ? <span className="text-xs text-muted-foreground">{prospect.country}</span> : null}
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
        <a href={prospect.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><ExternalLink className="h-3.5 w-3.5" aria-hidden />来源</a>
        {converted && prospect.outcome ? (
          <span className="text-xs text-muted-foreground">已发 {prospect.outcome.sent} · 回复 {prospect.outcome.replied} · 退信 {prospect.outcome.bounced}</span>
        ) : null}
      </div>
      {converted&&onSync&&<Button type="button" variant="outline" className="mt-3 min-h-11" disabled={busy} onClick={()=>onSync(prospect.id)}>补齐已获取资料</Button>}
      {onRefresh&&<div className="mt-2 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={()=>onRefresh(prospect.id)}>{busy?'正在处理…':converted?'重新采集并补齐空字段':'重新采集官网资料'}</Button><span className="text-xs text-muted-foreground">最多读取 3 个官网页面，消耗 Firecrawl 额度；保留客户已有内容。</span></div>}
      <details className="mt-3 rounded-md border bg-muted/20 p-3 text-sm"><summary className="min-h-11 cursor-pointer font-medium">查看将导入客户的资料</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2">{[
 ['公司',prospect.company],['联系人',prospect.contactName],['职位',prospect.contactTitle],['电话',prospect.phone],['国家 / 地区',prospect.country],['行业',prospect.industry],['地址',prospect.address],['Instagram',prospect.instagram],['LinkedIn',prospect.linkedin],['Facebook',prospect.facebook],['WhatsApp',prospect.whatsapp],
 ].map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value||'来源未提供'}</dd></div>)}</dl><p className="mt-3 text-xs leading-6 text-muted-foreground">已获取字段和官网简介会随客户保存；未提供的字段保留空白，不从网站售卖产品推断采购需求。</p></details>
      {prospect.excerpt ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{prospect.excerpt}</p> : null}
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
  const load = React.useCallback(async () => {
    try {
      const [today, summary] = await Promise.all([
        apiGet<ProspectingToday>('/prospecting/today'),
        apiGet<ProspectingReport>('/prospecting/report?days=14').catch(() => null),
      ]);
      setData(today);
      if (summary) setReport(summary);
    } catch (error) {
      toast.error('加载失败', { description: toErrorMessage(error, '请稍后重试') });
    } finally {
      setLoading(false);
    }
  }, []);

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
      const result = await apiPost<{ customer: { id: string; name: string }; draftTaskId?: string; draftError?: string }>(`/prospecting/${id}/approve`, {});
      toast.success('已转为正式客户', {
        description: result.draftError
          ? `草稿任务未创建：${result.draftError}`
          : result.draftTaskId ? '首封草稿正在后台生成，完成后在“查看草稿”里审核' : (result.customer?.name ?? '可在客户管理里继续写开发信'),
      });
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

  const sync = async(id:string)=>{setBusy(id);try{const result=await apiPost<{filledFields:string[]}>('/prospecting/'+id+'/sync-customer',{});toast.success(result.filledFields.length?'已补齐 '+result.filledFields.length+' 个空字段':'资料已核对',{description:'只补空字段，保留已有内容；来源与简介也可在候选资料中查看。'});await load();}catch(error){toast.error('补齐失败',{description:toErrorMessage(error)});}finally{setBusy(null);}};
  const refreshContact=async(id:string)=>{setBusy(id);try{const result=await apiPost<{filledFields:string[]}>('/prospecting/'+id+'/refresh-contact',{},{timeout:600000});toast.success('官网资料已更新',{description:result.filledFields.length?'已补齐客户 '+result.filledFields.length+' 个空字段':'已保留可读取资料，客户已有内容未覆盖。'});await load();}catch(error){toast.error('重新采集失败',{description:toErrorMessage(error)});}finally{setBusy(null);}};
  const openConfig = () => setConfigOpen(true);

  /** 可以发送、且已经有邮箱的候选：没有邮箱的转不了客户，批量时自动跳过 */
  const bulkTargets = React.useMemo(
    () => (data?.prospects ?? []).filter((item) => item.status === 'ready' && item.emails.length > 0),
    [data?.prospects],
  );

  /**
   * 一键转客户：逐个调用单条 approve，失败的跳过并继续，最后汇总。
   * 单条接口本身是幂等的（并发/重试都只建一次客户），所以这里按顺序跑，进度可见。
   */
  const approveAll = async () => {
    setConfirmOpen(false);
    if (!bulkTargets.length) return;
    setBatch({ total: bulkTargets.length, done: 0 });
    let ok = 0;
    let failed = 0;
    let draftErrors = 0;
    for (const prospect of bulkTargets) {
      try {
        const result = await apiPost<{ customer?: { id: string; name: string }; draftTaskId?: string; draftError?: string }>(`/prospecting/${prospect.id}/approve`, {});
        ok += 1;
        if (result?.draftError) draftErrors += 1;
      } catch {
        failed += 1;
      }
      setBatch((prev) => (prev ? { total: prev.total, done: prev.done + 1 } : prev));
    }
    setBatch(null);
    await load();
    toast.success(`已转换 ${ok} 个客户`, {
      description: [
        failed ? `${failed} 个失败，可稍后重试` : '',
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
        description="按客户画像搜索候选品牌、补全联系方式；审核后转为正式客户，再写开发信。可保存多套搜索方案，并选择默认自动生成。"
        actions={isAdmin ? (
          <div className="flex flex-wrap gap-2">
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

      {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {!loading && !data?.prospects.length ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Target className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">今天还没有候选</p>
          <p className="mt-1 text-sm text-muted-foreground">{isAdmin ? '点右上角“立即生成今日候选”，按客户画像的搜索词跑一轮。' : '管理员生成后，候选会出现在这里等待审核。'}</p>
        </div>
      ) : null}

      {groups.filter((group) => group.items.length).map((group) => (
        <section key={group.key} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{group.title}</h2>
            <Badge variant="muted">{group.items.length}</Badge>
            {group.key === 'ready' ? (
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                disabled={Boolean(batch) || !bulkTargets.length}
                title={bulkTargets.length
                  ? `把 ${bulkTargets.length} 个已有邮箱的候选一次转为正式客户，并各自创建首封开发信草稿（不发送）`
                  : '没有可转换的候选：需要先有邮箱'}
                onClick={() => setConfirmOpen(true)}
              >
                {batch ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {batch ? `转换中 ${batch.done}/${batch.total}` : `一键转为客户${bulkTargets.length ? `（${bulkTargets.length}）` : ''}`}
              </Button>
            ) : null}
          </div>
          <div className="space-y-2">
            {group.items.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} today={data?.day ?? ''} busy={busy === prospect.id || Boolean(batch)}
                onRefresh={isAdmin?id=>void refreshContact(id):undefined} onApprove={(id) => void approve(id)} onReject={(id) => void reject(id)} />
            ))}
          </div>
        </section>
      ))}

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

      <ProspectingRunDialog open={runOpen} onOpenChange={setRunOpen} onCompleted={()=>void load()}/>
      <ProspectingSettingsDialog open={configOpen} onOpenChange={setConfigOpen} onCompleted={()=>{toast.success('搜索方案已保存');void load();}}/>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>一键转为客户？</AlertDialogTitle>
            <AlertDialogDescription>
              将把 {bulkTargets.length} 个「可以发送」的候选转为正式客户，并各自创建首封开发信草稿（不会发送邮件）。
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
