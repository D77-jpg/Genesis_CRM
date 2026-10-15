import * as React from 'react';
import { Check, Loader2, Pause, Play, X, FilePenLine, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
export interface AgentTask {
 kind?:'first_outreach'|'inquiry_reply'|'followup_review';sourceMailId?:string;mailAnalysisId?:string;automatic?:boolean;
 id:string; sessionId:string; goal:string; version:number;
 status:'queued'|'running'|'waiting_input'|'paused'|'awaiting_review'|'completed'|'failed'|'cancelled';
 parentBatchId?:string; contextSummary?:string; tokenBudget?:number; budgetCharged?:number;
 customerId?:string; draftId?:string; analysisId?:string; currentStep?:string; completedSteps:string[];
 candidates:{id:string;name:string;company?:string}[]; error?:{message:string;retryable:boolean}; attempts:number;
 events:{at:string;message:string;step?:string}[];
}
const labels:Record<AgentTask['status'],string>={queued:'待执行',running:'正在执行',waiting_input:'需要补充信息',paused:'已暂停',awaiting_review:'草稿待审核',completed:'邮件已发送',failed:'本步失败',cancelled:'已取消'};
const steps=[['locate_customer','定位客户'],['analyze_customer','分析与起草'],['save_draft','保存草稿'],['verify_draft','核对结果']];
export function AgentTasks({autoOpenTaskId,onOpenDraft,onMailAnalysis,focusTaskId}: {autoOpenTaskId:string|null;onOpenDraft:(task:AgentTask)=>void;onMailAnalysis?:(task:AgentTask)=>void;focusTaskId?:string|null}) {
 const [tasks,setTasks]=React.useState<AgentTask[]>([]); const [error,setError]=React.useState(''); const [busy,setBusy]=React.useState('');
 const [queries,setQueries]=React.useState<Record<string,string>>({}); const [expanded,setExpanded]=React.useState<Record<string,boolean>>({});
 const opened=React.useRef(new Set<string>()); const openRef=React.useRef(onOpenDraft); openRef.current=onOpenDraft;
 React.useEffect(()=>{
  let active=true; let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try { const items=await apiGet<AgentTask[]>('/agent/tasks'); if(!active)return; setTasks(items); setError('');
    const ready=items.find(t=>t.id===autoOpenTaskId && t.status==='awaiting_review' && t.draftId && t.customerId);
    if(ready && !opened.current.has(ready.id)){opened.current.add(ready.id);openRef.current(ready);}
   }catch(reason){if(active)setError(toErrorMessage(reason,'任务加载失败'));}
   if(active)timer=setTimeout(()=>void poll(),2000);
  }; void poll(); return()=>{active=false;clearTimeout(timer);};
 },[autoOpenTaskId]);
 async function control(task:AgentTask,action:string,extra:Record<string,unknown>={}) {
  setBusy(task.id);setError('');
  try {const updated=await apiPost<AgentTask>(`/agent/tasks/${task.id}/${action}`,{version:task.version,...extra});setTasks(rows=>rows.map(t=>t.id===updated.id?updated:t));}
  catch(reason){setError(toErrorMessage(reason,'操作失败，请刷新任务状态后重试'));}finally{setBusy('');}
 }
 return <div className="min-h-0 flex-1 overflow-y-auto p-4">
  <div className="mb-5 border-b pb-3"><h3 className="flex items-center gap-2 font-semibold"><ListChecks className="h-4 w-4"/>任务进度</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">进度保存在服务器。关闭面板后仍可继续；草稿与真实发送分别记录。</p></div>
  {error && <p role="alert" className="mb-3 rounded border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
  {!tasks.length && <p className="py-8 text-sm text-muted-foreground">还没有任务。在对话中说“帮我给这个客户写第一封开发信”，或指定客户公司名称。</p>}
  <div className="divide-y">{[...tasks].sort((a,b)=>a.id===focusTaskId?-1:b.id===focusTaskId?1:0).map(task=><section key={task.id} className="py-4 first:pt-0">
   <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-sm font-medium leading-relaxed">{task.automatic&&<span className="mb-1 block text-xs font-normal text-muted-foreground">事件任务 · {task.kind==='inquiry_reply'?'询盘处理':'跟进到期'}</span>}{task.goal}</p><Badge variant={task.status==='failed'?'destructive':'outline'} className="shrink-0">{labels[task.status]}</Badge></div>
   <ol className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="任务步骤">{steps.map(([key,label])=>{
    const done=task.completedSteps.includes(key); const running=task.status==='running'&&task.currentStep===key;
    return <li key={key} className={`flex items-center gap-1.5 text-xs ${done?'text-emerald-600':running?'text-primary':'text-muted-foreground'}`}>
     {done?<Check className="h-3.5 w-3.5"/>:running?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<span className="h-3 w-3 rounded-full border"/>}{label}</li>;
   })}</ol>
   {task.contextSummary&&<details className="my-2"><summary className="cursor-pointer text-xs text-muted-foreground">查看本任务资料摘要</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{task.contextSummary}</p></details>}
   <p role="status" className="text-sm leading-relaxed">{task.error?.message || task.events.at(-1)?.message}</p>
   {task.status==='waiting_input' && <div className="mt-3 space-y-2">
    {task.candidates.map(c=><Button key={c.id} variant="outline" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" disabled={busy===task.id} onClick={()=>void control(task,'resume',{customerId:c.id})}>{c.name}{c.company?` · ${c.company}`:''}</Button>)}
    {!task.completedSteps.includes('locate_customer') && <div className="flex gap-2"><Input aria-label="客户或公司名称" placeholder="补充客户或公司名称" value={queries[task.id]??''} onChange={e=>setQueries(q=>({...q,[task.id]:e.target.value}))}/><Button variant="outline" disabled={busy===task.id||!queries[task.id]?.trim()} onClick={()=>void control(task,'resume',{query:queries[task.id].trim()})}>检索</Button></div>}
   </div>}
   <div className="mt-3 flex flex-wrap items-center gap-2">
    {task.mailAnalysisId&&onMailAnalysis&&<Button variant="outline" className="min-h-11" onClick={()=>onMailAnalysis(task)}>查看询盘摘要与回复</Button>}
    {task.sourceMailId&&task.status==='waiting_input'&&<Button asChild variant="outline" className="min-h-11"><a href={`/mail?id=${task.sourceMailId}&direction=inbound`}>打开原来信 / 关联客户</a></Button>}
    {task.status==='waiting_input'&&task.customerId&&<Button asChild variant="outline" className="min-h-11"><a href={`/customers/${task.customerId}`}>打开客户档案</a></Button>}
    {task.status==='awaiting_review'&&task.draftId&&<Button className="min-h-11" onClick={()=>onOpenDraft(task)}><FilePenLine className="mr-1.5 h-4 w-4"/>打开草稿审核</Button>}
    {['queued','running'].includes(task.status)&&<Button variant="outline" className="min-h-11" disabled={busy===task.id} onClick={()=>void control(task,'pause')}><Pause className="mr-1 h-3.5 w-3.5"/>暂停</Button>}
    {(task.status==='paused'||(task.status==='waiting_input'&&(task.customerId||task.sourceMailId))||(task.status==='failed'&&task.error?.retryable&&task.attempts<5))&&<Button variant="outline" className="min-h-11" disabled={busy===task.id} onClick={()=>void control(task,'resume')}><Play className="mr-1 h-3.5 w-3.5"/>{task.status==='failed'?'重试此步':'继续'}</Button>}
    {!['completed','cancelled'].includes(task.status)&&<Button variant="ghost" className="min-h-11" disabled={busy===task.id} onClick={()=>void control(task,'cancel')}><X className="mr-1 h-3.5 w-3.5"/>取消任务</Button>}
    <Button variant="ghost" className="min-h-11 text-muted-foreground" aria-expanded={Boolean(expanded[task.id])} onClick={()=>setExpanded(v=>({...v,[task.id]:!v[task.id]}))}>{expanded[task.id]?'收起过程':'查看过程'}</Button>
   </div>
   {expanded[task.id]&&<ol className="mt-3 space-y-2 border-l pl-3 text-xs text-muted-foreground">{task.events.map((event,i)=><li key={i}><time>{formatDateTime(event.at)}</time><p className="mt-0.5 leading-relaxed">{event.message}</p></li>)}</ol>}
  </section>)}</div>
 </div>;
}
