import * as React from 'react';
import {BrainCircuit, Loader2, RefreshCw, ShieldCheck, Sparkles} from 'lucide-react';
import {apiGet, apiPost, toErrorMessage} from '@/lib/api';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {formatDateTime} from '@/lib/format';

type Recent = {
  id: string;
  taskType: string;
  decision: 'approved' | 'rejected';
  edited: boolean;
  editRatio: number;
  sourceCount: number;
  queryPreview: string;
  aiPreview: string;
  finalPreview: string;
  createdAt: string;
};

type Overview = {
  enabled: boolean;
  total: number;
  approved: number;
  rejected: number;
  edited: number;
  eligible: number;
  validation: number;
  topSources: {knowledgeId: string; title: string; approvals: number}[];
  recent: Recent[];
  limits: {maxBoost: number; minSamples: number; sampleLimit: number; onlyApproved: true};
};

const taskNames: Record<string, string> = {
  first_outreach: '首封开发信',
  inquiry_reply: '询盘回复',
  followup_review: '跟进邮件',
  quotation_explanation: '报价说明',
  sample_reply: '样品回复',
  retrieval_inspection: '检索检查',
};

/**
 * 审核与自动训练。
 *
 * 这里只展示可审计的聚合结果和样本摘要，不回显 AI 原稿或客户正文。
 * 自动校准只重排已授权、已通过阈值的来源，不新增证据，也不替代人工审核。
 */
export function KnowledgeTraining() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setError('');
    try {
      setData(await apiGet<Overview>('/agent/knowledge-training/overview'));
    } catch (reason) {
      setError(toErrorMessage(reason, '暂时无法读取审核训练概况'));
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  async function toggle() {
    if (!data || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<{enabled: boolean}>('/agent/knowledge-training/toggle', {enabled: !data.enabled});
      setData(current => current ? {...current, enabled: result.enabled} : current);
    } catch (reason) {
      setError(toErrorMessage(reason, '切换自动校准失败'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return <div className="p-6 text-sm text-destructive" role="alert">{error}<Button variant="outline" className="ml-3 min-h-11" onClick={() => void load()}>重试</Button></div>;
  }
  if (!data) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden/>正在读取审核训练概况…</div>;
  }

  const editRate = data.total ? Math.round((data.edited / data.total) * 100) : 0;
  return <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><BrainCircuit className="h-5 w-5 text-primary" aria-hidden/>审核与自动训练</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">业务员每次审核草稿后，系统自动保存“AI 原稿 → 人工最终稿”的差异。通过稿中采用的已发布来源，会在管理员启用后参与相似问题的排序校准；只改顺序，不新增依据。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}><RefreshCw className={'h-4 w-4 '+(busy?'animate-spin':'')} aria-hidden/>刷新</Button>
        <Button className="min-h-11" disabled={busy} onClick={() => void toggle()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden/> : <Sparkles className="h-4 w-4" aria-hidden/>}{data.enabled ? '暂停自动校准' : '启用自动校准'}</Button>
      </div>
    </header>

    {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}

    <section className={data.enabled ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4' : 'rounded-lg border bg-muted/20 p-4'}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className={'h-4 w-4 '+(data.enabled?'text-emerald-600':'text-muted-foreground')} aria-hidden/>
        <p className="font-medium">{data.enabled ? '自动校准已启用' : '自动校准未启用'}</p>
        <Badge variant={data.enabled ? 'developed' : 'muted'}>{data.enabled ? '只影响排序' : '样本仍在收集'}</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{data.enabled
        ? '相似请求会获得最多 ' + (data.limits.maxBoost * 100).toFixed(0) + '% 的来源排序加权；未通过人工审核、未发布、已过期或跨项目的来源不会进入。'
        : '已收集 ' + data.eligible + ' 条可用样本，达到 ' + data.limits.minSamples + ' 条后可启用。启用前不会改变任何检索结果。'}</p>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['已收集样本', data.total, '通过 + 不通过'],
        ['审核通过', data.approved, '可用于来源校准'],
        ['人工修改后通过', data.edited, '真实修改率 ' + editRate + '%'],
        ['可校准样本', data.eligible, '含问题词项和来源'],
      ].map(([label, value, note]) => <div key={String(label)} className="rounded-lg border p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </div>)}
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
      <section aria-label="已采用来源" className="rounded-lg border">
        <div className="border-b px-4 py-3"><h3 className="font-medium">通过稿中反复采用的来源</h3><p className="mt-1 text-xs text-muted-foreground">只统计本项目审核通过的草稿；用于解释排序先验，不构成事实确认。</p></div>
        {data.topSources.length ? <ol className="divide-y">{data.topSources.map((item, index) => <li key={item.knowledgeId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="min-w-0"><span className="mr-2 text-xs text-muted-foreground tabular-nums">{index + 1}</span><span className="break-words">{item.title}</span></span>
          <Badge variant="muted" className="shrink-0">{item.approvals} 次</Badge>
        </li>)}</ol> : <p className="p-4 text-sm leading-6 text-muted-foreground">还没有审核通过且带项目知识来源的草稿。普通人工撰写或没有来源的草稿不会进入统计。</p>}
      </section>

      <section aria-label="最近审核样本" className="rounded-lg border">
        <div className="border-b px-4 py-3"><h3 className="font-medium">最近审核样本</h3><p className="mt-1 text-xs text-muted-foreground">最多显示 12 条摘要；不显示客户正文。</p></div>
        {data.recent.length ? <ul className="divide-y">{data.recent.map(item => <li key={item.id} className="space-y-1 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={item.decision === 'approved' ? 'developed' : 'failed'}>{item.decision === 'approved' ? '通过' : '不通过'}</Badge>
            <span className="font-medium">{taskNames[item.taskType] ?? item.taskType}</span>
            <span className="text-xs text-muted-foreground">{item.sourceCount} 个来源 · {formatDateTime(item.createdAt)}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={item.queryPreview}>{item.queryPreview || '没有记录业务请求'}</p>
          {item.edited && <p className="text-xs text-amber-700 dark:text-amber-300">人工修改幅度约 {Math.round(item.editRatio * 100)}%，保留为修正样本</p>}
          <details className="rounded-md border bg-muted/15 px-3 py-2 text-xs">
            <summary className="min-h-8 cursor-pointer text-muted-foreground">查看 AI 原稿与最终稿摘要</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><p className="font-medium">AI 原稿</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{item.aiPreview || '（无原稿摘要）'}</p></div>
              <div><p className="font-medium">人工最终稿</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{item.finalPreview || '（无最终稿摘要）'}</p></div>
            </div>
          </details>
        </li>)}</ul> : <p className="p-4 text-sm leading-6 text-muted-foreground">还没有审核样本。业务员审核一封带知识依据的草稿后，这里会自动出现摘要。</p>}
      </section>
    </div>

    <section className="rounded-lg border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
      <p className="font-medium text-foreground">安全边界</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>只从本项目“审核通过”的草稿学习；不通过样本只用于统计，不参与加权。</li>
        <li>最多 {data.limits.sampleLimit} 条最近样本、最多 {(data.limits.maxBoost * 100).toFixed(0)}% 排序加权，且只重排已通过准入门槛的来源。</li>
        <li>不会新增证据、不会放宽产品/项目/角色/版本边界，也不会自动发送邮件。</li>
        <li>训练样本和统计只对管理员开放；业务员仍只看到自己的审核页。</li>
      </ul>
    </section>
  </div>;
}
