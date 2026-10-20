import * as React from 'react';
import { Check, Loader2, Pause, Play, X, FilePenLine, ListChecks, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiPost, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { taskCounts, visibleTasks, type TaskFilter } from '@/lib/agent-workflow';
export interface AgentTask {
 kind?:'first_outreach'|'inquiry_reply'|'followup_review'|'quotation_explanation'|'sample_reply';sourceMailId?:string;mailAnalysisId?:string;automatic?:boolean;
 needsRefresh?:boolean;workflowEpoch?:number;workflowCalls?:number;workflow?:{key:string;label:string;epoch:number;state:'running'|'completed'|'failed';durationMs?:number;partial?:boolean;reused:number;tool?:string}[];previousArtifacts?:{draftId?:string;at:string}[];
 id:string; sessionId:string; goal:string; version:number;
 status:'queued'|'running'|'waiting_input'|'paused'|'awaiting_review'|'completed'|'failed'|'cancelled';
 parentBatchId?:string; contextSummary?:string; tokenBudget?:number; budgetCharged?:number;
 customerId?:string; customerName?:string; draftId?:string; staleDraftId?:string; analysisId?:string; currentStep?:string; completedSteps:string[];
 candidates:{id:string;name:string;company?:string}[]; error?:{message:string;retryable:boolean}; attempts:number;
 events:{at:string;message:string;step?:string}[];
}

const labels: Record<AgentTask['status'], string> = {
  queued: '排队中', running: '准备中', waiting_input: '待补充', paused: '已暂停',
  awaiting_review: '待你审核', completed: '已发送', failed: '需要处理', cancelled: '已取消',
};
const kinds = { first_outreach: '首封开发信', inquiry_reply: '询盘回复', followup_review: '跟进邮件',quotation_explanation:'报价说明',sample_reply:'样品回复' };
const steps = [['locate_customer','定位客户'],['research_customer','分析客户背景'],['analyze_customer','分析与起草'],['save_draft','保存草稿'],['verify_draft','核对结果']];
const descriptions: Record<AgentTask['status'], string> = {
  queued: '已排队，助手会继续准备。', running: '正在整理资料并起草…',
  waiting_input: '补充资料后即可继续。', paused: '已完成的内容保留，随时可以继续。',
  awaiting_review: '核对内容后，在写信页面发送。', completed: '邮件已发送，跟进记录已保存。',
  failed: '暂未完成，请查看原因后重试。', cancelled: '任务已停止，已保存的结果保留。',
};
interface Props {
  tasks: AgentTask[]; loaded: boolean; loadError: string;
  onTaskUpdated: (task: AgentTask) => void;
  autoOpenTaskId: string | null;
  onOpenDraft: (task: AgentTask) => void;
  onMailAnalysis?: (task: AgentTask) => void;
  focusTaskId?: string | null;
}
export function AgentTasks({ tasks, loaded, loadError, onTaskUpdated, autoOpenTaskId, onOpenDraft, onMailAnalysis, focusTaskId }: Props) {
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [filter, setFilter] = React.useState<TaskFilter>('pending');
  const [queries, setQueries] = React.useState<Record<string, string>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const opened = React.useRef(new Set<string>());
  const focusRef = React.useRef<HTMLElement | null>(null);
  const [pinnedId, setPinnedId] = React.useState(focusTaskId);
  const counts = taskCounts(tasks);
  const rows = visibleTasks(tasks, filter, pinnedId);
  function chooseFilter(value: TaskFilter) { setPinnedId(null); setFilter(value); }
  React.useEffect(() => { setPinnedId(focusTaskId); }, [focusTaskId]);
  React.useEffect(() => {
    const ready = tasks.find(task => task.id === autoOpenTaskId && task.status === 'awaiting_review' && task.draftId && task.customerId);
    if (ready && !opened.current.has(ready.id)) { opened.current.add(ready.id); onOpenDraft(ready); }
  }, [tasks, autoOpenTaskId, onOpenDraft]);
  React.useEffect(() => {
    if (focusTaskId) focusRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusTaskId, loaded]);
  async function control(task: AgentTask, action: string, extra: Record<string, unknown> = {}) {
    setBusy(task.id); setError('');
    try {
      const updated = await apiPost<AgentTask>('/agent/tasks/' + task.id + '/' + action, { version: task.version, ...extra });
      onTaskUpdated(updated);
    } catch (reason) { setError(toErrorMessage(reason, '操作未完成，请刷新后重试')); }
    finally { setBusy(''); }
  }
  return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
    <header className="mb-4">
      <h3 className="text-base font-semibold">待你推进的工作</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">先审核草稿，再处理需要补充的资料。关闭助手后，准备中的任务仍会继续。</p>
    </header>
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="筛选待办">
      {([
        ['pending', '未完成', counts.review + counts.attention + counts.active],
        ['review', '待审核', counts.review],
        ['attention', '需处理', counts.attention],
      ] as const).map(([key, label, count]) => <Button key={key} variant={filter === key ? 'secondary' : 'ghost'} className="min-h-11 px-3" aria-pressed={filter === key} onClick={() => chooseFilter(key)}>{label}{loaded && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}</Button>)}
    </div>
    <div className="mb-4 flex items-center justify-between gap-3 border-b pb-3">
      <span className="text-xs leading-5 text-muted-foreground">显示最近 30 项任务</span>
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><span className="sr-only">其他任务范围</span>
        <select aria-label="其他任务范围" className="min-h-11 max-w-40 rounded-md border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={filter} onChange={event => chooseFilter(event.target.value as TaskFilter)}>
          <option value="pending">全部未完成</option><option value="review">待审核</option><option value="attention">需处理</option><option value="active">正在准备</option><option value="history">已结束</option><option value="all">全部记录</option>
        </select>
      </label>
    </div>
    {(error || loadError) && <p role="alert" className="mb-4 rounded-md border border-destructive/30 p-3 text-sm leading-6 text-destructive">{error || loadError}</p>}
    {!loaded && !loadError && <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />正在更新待办…</p>}
    {loaded && rows.length === 0 && <div className="py-8">
      <ListChecks className="mb-3 h-7 w-7 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{tasks.length ? '这个范围内暂无任务' : '暂时没有待办'}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{tasks.length ? '可以切换范围，查看准备中的任务和已结束记录。' : '在客户页面告诉助手“帮我写第一封开发信”，草稿准备好后会出现在这里。'}</p>
    </div>}
    <div className="divide-y">{rows.map(task => <section key={task.id} ref={task.id === pinnedId ? focusRef : undefined} className={'py-5 first:pt-1 ' + (task.id === pinnedId ? 'rounded-lg bg-primary/5 px-3' : '')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold leading-6">{task.customerName || '等待确认客户'}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{kinds[task.kind ?? 'first_outreach']}{task.automatic ? ' · 自动准备' : ''}</p>
        </div>
        <Badge variant={task.status === 'failed' ? 'destructive' : task.status === 'awaiting_review' ? 'developed' : 'muted'} className="shrink-0">{labels[task.status]}</Badge>
      </div>
      <p role="status" className={'mt-3 break-words text-sm leading-6 ' + (task.error?.message ? 'text-destructive' : 'text-muted-foreground')}>{task.error?.message || (task.needsRefresh?'资料或依据已变化，请重新核对后准备新稿；原稿仍保留。':descriptions[task.status])}</p>
      {task.status === 'waiting_input' && <div className="mt-3 space-y-2">
        {task.candidates.map(candidate => <Button key={candidate.id} variant="outline" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" disabled={busy === task.id} onClick={() => void control(task, 'resume', { customerId: candidate.id })}>{candidate.name}{candidate.company ? ' · ' + candidate.company : ''}</Button>)}
        {!task.completedSteps.includes('locate_customer') && <div className="flex gap-2"><Input className="min-h-11" aria-label="客户或公司名称" placeholder="补充客户或公司名称" value={queries[task.id] ?? ''} onChange={event => setQueries(values => ({ ...values, [task.id]: event.target.value }))} /><Button variant="outline" className="min-h-11" disabled={busy === task.id || !queries[task.id]?.trim()} onClick={() => void control(task, 'resume', { query: queries[task.id].trim() })}>检索</Button></div>}
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(task.draftId||task.staleDraftId)&&task.status === 'awaiting_review' && <Button className="min-h-11" variant={task.draftId?'default':'outline'} onClick={() => onOpenDraft(task)}><FilePenLine className="h-4 w-4" aria-hidden />{task.draftId?'审核并去写信':'查看原稿（依据已变化）'}</Button>}
        {['queued','running'].includes(task.status) && <Button variant="outline" className="min-h-11" disabled={busy === task.id} onClick={() => void control(task, 'pause')}><Pause className="h-4 w-4" aria-hidden />暂停</Button>}
        {((task.needsRefresh&&task.status==='awaiting_review') || task.status === 'paused' || (task.status === 'waiting_input' && (task.customerId || task.sourceMailId)) || (task.status === 'failed' && task.attempts < 5)) && <Button variant="outline" className="min-h-11" disabled={busy === task.id} onClick={() => void control(task, 'resume')}><Play className="h-4 w-4" aria-hidden />{task.status === 'failed'||task.needsRefresh ? '重新准备' : '继续准备'}</Button>}
        {task.sourceMailId && task.status === 'waiting_input' && <Button asChild variant="outline" className="min-h-11"><a href={'/mail?id=' + task.sourceMailId + '&direction=inbound'}>查看来信并关联客户</a></Button>}
        {task.status === 'waiting_input' && task.customerId && <Button asChild variant="outline" className="min-h-11"><a href={'/customers/' + task.customerId}>补充客户资料</a></Button>}
        <Button variant="ghost" className="min-h-11 px-2 text-muted-foreground" aria-expanded={Boolean(expanded[task.id])} aria-controls={'task-details-' + task.id} onClick={() => setExpanded(values => ({ ...values, [task.id]: !values[task.id] }))}>{expanded[task.id] ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}处理详情</Button>
      </div>
      {expanded[task.id] && <div id={'task-details-' + task.id} className="mt-4 space-y-4 border-l-2 pl-3">
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{task.goal}</p>
        <ol className="grid grid-cols-2 gap-3" aria-label="任务步骤">{steps.map(([key, label]) => {
          const done = task.completedSteps.includes(key); const running = task.status === 'running' && task.currentStep === key;
          return <li key={key} className={'flex items-center gap-1.5 text-xs leading-5 ' + (done ? 'text-emerald-600 dark:text-emerald-400' : running ? 'text-primary' : 'text-muted-foreground')}>{done ? <Check className="h-3.5 w-3.5" aria-hidden /> : running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <span className="h-3 w-3 rounded-full border" aria-hidden />}{label}</li>;
        })}</ol>
        {task.workflow && task.workflow.length>0 && <section aria-label="证据准备过程" className="space-y-3"><h4 className="text-sm font-medium">依据如何用于这封邮件</h4><p className="text-xs leading-5 text-muted-foreground">每一步保留结果。继续时会重新核对权限和资料版本，发送仍由你确认。</p><ol className="space-y-3">{task.workflow.filter(s=>s.epoch===(task.workflowEpoch??0)).map(s=><li key={s.key} className="flex items-start gap-2 text-sm leading-6">{s.state==='completed'?<Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-hidden/>:s.state==='running'&&task.status==='running'?<Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden/>:<span className="mt-2 h-3 w-3 shrink-0 rounded-full border" aria-hidden/>}<div className="min-w-0"><p>{s.label}</p><p className="text-xs leading-5 text-muted-foreground">{s.state==='completed'?(s.partial!==false&&s.key==='audit_claims'?'已整理 · 仍需人工确认':'已完成'):s.state==='running'?'等待继续':'未完成，请查看上方处理原因'}{s.durationMs!==undefined?' · '+(s.durationMs<100?'不足0.1秒':(s.durationMs/1000).toFixed(1)+'秒'):''}{s.reused>0?' · 已复用保存结果':''}</p></div></li>)}</ol>{(task.workflowEpoch??0)>0&&<p className="text-xs leading-5 text-amber-700 dark:text-amber-400">资料发生过变化，当前显示重新核对后的处理过程；旧草稿仍保留。</p>}</section>}
        {task.previousArtifacts?.some(a=>a.draftId)&&<details><summary className="min-h-11 cursor-pointer text-sm">查看此前保留的草稿</summary><div className="space-y-2">{task.previousArtifacts.filter(a=>a.draftId).map(a=><Button key={a.draftId} variant="outline" className="min-h-11" asChild><a href={'/customers/'+task.customerId+'?knowledgeDraft='+a.draftId}>旧草稿 · {formatDateTime(a.at)}</a></Button>)}</div></details>}
        {task.contextSummary && <div><h4 className="text-xs font-medium">客户资料摘要</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{task.contextSummary}</p></div>}
        {task.mailAnalysisId && onMailAnalysis && <Button variant="outline" className="min-h-11" onClick={() => onMailAnalysis(task)}>查看询盘摘要与回复</Button>}
        <ol className="space-y-3 text-xs text-muted-foreground">{task.events.map((event, index) => <li key={index}><time>{formatDateTime(event.at)}</time><p className="mt-1 break-words leading-5">{event.message}</p></li>)}</ol>
        {!['completed','cancelled'].includes(task.status) && <Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy === task.id} onClick={() => void control(task, 'cancel')}><X className="h-4 w-4" aria-hidden />取消任务</Button>}
      </div>}
    </section>)}</div>
  </div>;
}
