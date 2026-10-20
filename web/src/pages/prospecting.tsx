import * as React from 'react';
import {
  AtSign, Check, ExternalLink, Instagram, Linkedin, Loader2, Play, RefreshCw, Settings2, Sparkles, Target, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { usePageTitle } from '@/hooks/use-ui';
import { apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { Prospect, ProspectingReport, ProspectingToday } from '@/types';

const STATUS_LABEL: Record<Prospect['status'], string> = {
  ready: '可发送', needs_contact: '待补联系方式', low: '评分不足', rejected: '已跳过', converted: '已转客户',
};

function scoreClass(score: number) {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (score >= 60) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-muted text-muted-foreground';
}

function ProspectCard({ prospect, today, busy, onApprove, onReject }: {
  prospect: Prospect; today: string; busy: boolean;
  onApprove: (id: string) => void; onReject: (id: string) => void;
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
        {prospect.instagram ? <a href={`https://instagram.com/${prospect.instagram}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><Instagram className="h-3.5 w-3.5" aria-hidden />@{prospect.instagram}</a> : null}
        {prospect.emailSource === 'hunter' ? <Badge variant="outline" className="font-normal">Hunter{prospect.emailConfidence ? ` ${prospect.emailConfidence}%` : ''}</Badge> : null}
        {prospect.linkedin ? <a href={`https://linkedin.com/company/${prospect.linkedin}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><Linkedin className="h-3.5 w-3.5" aria-hidden />LinkedIn</a> : null}
        <a href={prospect.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><ExternalLink className="h-3.5 w-3.5" aria-hidden />来源</a>
        {converted && prospect.outcome ? (
          <span className="text-xs text-muted-foreground">已发 {prospect.outcome.sent} · 回复 {prospect.outcome.replied} · 退信 {prospect.outcome.bounced}</span>
        ) : null}
      </div>
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
  const [runOpen, setRunOpen] = React.useState(false);
  const [configOpen, setConfigOpen] = React.useState(false);
  const [queries, setQueries] = React.useState('');
  const [enrichLimit, setEnrichLimit] = React.useState(20);
  const [hunterLimit, setHunterLimit] = React.useState(15);
  const [minScore, setMinScore] = React.useState(60);
  const [autoEnabled, setAutoEnabled] = React.useState(false);
  const [llmScoring, setLlmScoring] = React.useState(true);
  const [profileTitle, setProfileTitle] = React.useState<string | null>(null);

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

  const openRun = async () => {
    try {
      const config = await apiGet<{ queries: string[]; enrichLimit: number }>('/prospecting/config');
      setQueries(config.queries.join('\n'));
      setEnrichLimit(config.enrichLimit);
    } catch { /* 用当前表单值 */ }
    setRunOpen(true);
  };

  const startRun = async () => {
    setBusy('run');
    try {
      const list = queries.split('\n').map((item) => item.trim()).filter(Boolean);
      await apiPost('/prospecting/run', { queries: list.length ? list : undefined, enrichLimit });
      toast.success('已开始生成今日候选', { description: '搜索与补全需要 1–3 分钟，页面会自动刷新' });
      setRunOpen(false);
      await load();
    } catch (error) {
      toast.error('启动失败', { description: toErrorMessage(error, '请稍后重试') });
    } finally { setBusy(null); }
  };

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

  const saveConfig = async () => {
    setBusy('config');
    try {
      await apiPut('/prospecting/config', {
        enabled: autoEnabled,
        queries: queries.split('\n').map((item) => item.trim()).filter(Boolean),
        enrichLimit, hunterLimit, minScore, llmScoring,
      });
      toast.success('配置已保存');
      setConfigOpen(false);
    } catch (error) {
      toast.error('保存失败', { description: toErrorMessage(error, '请稍后重试') });
    } finally { setBusy(null); }
  };

  const openConfig = async () => {
    try {
      const config = await apiGet<{ queries: string[]; enrichLimit: number; hunterLimit: number; minScore: number; enabled: boolean; llmScoring: boolean; profileTitle: string | null }>('/prospecting/config');
      setQueries(config.queries.join('\n'));
      setEnrichLimit(config.enrichLimit);
      setHunterLimit(config.hunterLimit);
      setMinScore(config.minScore);
      setAutoEnabled(config.enabled);
      setLlmScoring(config.llmScoring);
      setProfileTitle(config.profileTitle);
      setConfigOpen(true);
    } catch (error) {
      toast.error('读取配置失败', { description: toErrorMessage(error, '请稍后重试') });
    }
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
        description="按客户画像搜索候选品牌、补全联系方式；审核后转为正式客户，再写开发信。定时自动生成在下一步接入。"
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
          <span>本轮：搜索到 {run.imported} 个域名，去重后 {run.deduped} 个，补全 {run.enriched} 个，Hunter 补到 {run.hunterFound} 个邮箱，入选 {run.selected} 个</span>
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
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">{group.title}</h2>
            <Badge variant="muted">{group.items.length}</Badge>
          </div>
          <div className="space-y-2">
            {group.items.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} today={data?.day ?? ''} busy={busy === prospect.id}
                onApprove={(id) => void approve(id)} onReject={(id) => void reject(id)} />
            ))}
          </div>
        </section>
      ))}

      {converted.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">今天已转客户</h2>
          <div className="space-y-2">
            {converted.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} today={data?.day ?? ''} busy={false} onApprove={() => undefined} onReject={() => undefined} />
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

      <Dialog open={runOpen} onOpenChange={(next) => !busy && setRunOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>生成今日候选</DialogTitle>
            <DialogDescription>默认使用“搜索设置”里的关键词；也可以这次临时换一组，每行一个。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div>
              <Label htmlFor="prospect-queries">搜索词（可留空）</Label>
              <Textarea id="prospect-queries" className="mt-1.5 min-h-28" value={queries} onChange={(event) => setQueries(event.target.value)}
                placeholder={'independent jewelry brand "made in usa" shop -site:etsy.com\nhandmade candle brand usa online store'} />
            </div>
            <div>
              <Label htmlFor="prospect-enrich">补全数量</Label>
              <Input id="prospect-enrich" type="number" min={1} max={80} className="mt-1.5 w-32" value={enrichLimit}
                onChange={(event) => setEnrichLimit(Number(event.target.value) || 20)} />
              <p className="mt-1 text-xs text-muted-foreground">每个候选会抓官网首页和联系页，越多越慢、消耗的 Firecrawl 额度越多。</p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy === 'run'} onClick={() => setRunOpen(false)}>取消</Button>
            <Button type="button" loading={busy === 'run'} onClick={() => void startRun()}>开始生成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={configOpen} onOpenChange={(next) => !busy && setConfigOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>搜索设置</DialogTitle>
            <DialogDescription>搜索词决定候选质量；建议每个品类 2–3 条，带国家/风格限定，排除平台站。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">每天自动生成</p>
                <p className="mt-0.5 text-xs text-muted-foreground">开启后每天 06:30（项目时区）自动跑一轮；服务重启后 3 小时内也会补跑一次。</p>
              </div>
              <Switch checked={autoEnabled} onCheckedChange={setAutoEnabled} aria-label="每天自动生成" />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">客户画像评分</p>
                <p className="mt-0.5 text-xs text-muted-foreground">按资料库里已发布的《客户画像》打分；找不到时用内置规则。</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span>{profileTitle ? `当前来源：资料库《${profileTitle}》` : '当前来源：内置规则（资料库未找到《客户画像》）'}</span>
                  {profileTitle ? null : (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => { window.location.assign('/knowledge?view=manage'); }}>
                      去资料库上传
                    </Button>
                  )}
                </div>
              </div>
              <Switch checked={llmScoring} onCheckedChange={setLlmScoring} aria-label="AI 画像评分" />
            </div>            <div>
              <Label htmlFor="config-queries">默认搜索词（每行一个）</Label>
              <Textarea id="config-queries" className="mt-1.5 min-h-32" value={queries} onChange={(event) => setQueries(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div><Label htmlFor="config-enrich">每天补全数量</Label><Input id="config-enrich" type="number" min={1} max={80} className="mt-1.5" value={enrichLimit} onChange={(event) => setEnrichLimit(Number(event.target.value) || 20)} /></div>
              <div><Label htmlFor="config-hunter">Hunter 查询上限</Label><Input id="config-hunter" type="number" min={0} max={50} className="mt-1.5" value={hunterLimit} onChange={(event) => setHunterLimit(Number(event.target.value) || 0)} /></div>
              <div><Label htmlFor="config-min">入选分数</Label><Input id="config-min" type="number" min={0} max={100} className="mt-1.5" value={minScore} onChange={(event) => setMinScore(Number(event.target.value) || 60)} /></div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy === 'config'} onClick={() => setConfigOpen(false)}>取消</Button>
            <Button type="button" loading={busy === 'config'} onClick={() => void saveConfig()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
