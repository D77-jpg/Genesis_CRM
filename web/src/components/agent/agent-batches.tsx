import * as React from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {apiGet,apiPost,toErrorMessage} from '@/lib/api';
import type {AgentTask} from './agent-tasks';
interface Batch {id:string;goal:string;status:'proposed'|'active'|'paused'|'cancelled';version:number;totalTokenBudget:number;budgetCharged:number;ready:number;failed:number;rows:{customerId:string;name:string;company?:string;taskId?:string;status:string;draftId?:string;error?:string;summary?:string}[]}
const statusNames:Record<string,string>={queued:'待执行',running:'处理中',waiting_input:'需补资料',awaiting_review:'草稿待审核',completed:'已发送',failed:'失败',cancelled:'已取消',paused:'已暂停',unavailable:'无权访问'};
export function AgentBatches({selectedIds,onClearSelection,onTask,onDraft}:{selectedIds:string[];onClearSelection:()=>void;onTask:(id:string)=>void;onDraft:(task:AgentTask)=>void}){
 const [rows,setRows]=React.useState<Batch[]>([]);const [error,setError]=React.useState('');const [busy,setBusy]=React.useState('');const [goal,setGoal]=React.useState('为每位客户准备一封简洁的英文开发信，结合客户需求介绍合适产品；不确定的价格与交期先询问确认，保存草稿供我审核。');
 const [query,setQuery]=React.useState('');const [count,setCount]=React.useState(5);const [high,setHigh]=React.useState(false);const [details,setDetails]=React.useState<Record<string,boolean>>({});
 const [knowledge,setKnowledge]=React.useState<{id:string;approvedVersion:number;archived:boolean;revisions:{version:number;title:string}[]}[]>([]);const [knowledgeIds,setKnowledgeIds]=React.useState<string[]>([]);
 React.useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const result=await apiGet<Batch[]>('/agent/batches');if(active)setRows(result);}catch(reason){if(active)setError(toErrorMessage(reason,'批量任务加载失败'));}if(active)timer=setTimeout(()=>void poll(),2500);};void poll();void apiGet<typeof knowledge>('/agent/knowledge').then(k=>{if(active)setKnowledge(k.filter(x=>x.approvedVersion&&!x.archived));}).catch(()=>undefined);return()=>{active=false;clearTimeout(timer);};},[]);
 async function preview(){setBusy('new');setError('');try{const session=await apiPost<{id:string}>('/agent/sessions',{context:{type:'global'}});const batch=await apiPost<Batch>('/agent/batches',{sessionId:session.id,requestKey:crypto.randomUUID(),goal,...(selectedIds.length?{customerIds:selectedIds}:{query,limit:count,status:'pending',...(high?{priority:'high'}:{})}),knowledgeIds});setRows(list=>[batch,...list]);onClearSelection();}catch(reason){setError(toErrorMessage(reason,'名单预览失败'));}finally{setBusy('');}}
 async function control(batch:Batch,action:string){setBusy(batch.id);setError('');try{const result=await apiPost<Batch>(`/agent/batches/${batch.id}/${action}`,{version:batch.version});setRows(list=>list.map(b=>b.id===result.id?result:b));}catch(reason){setError(toErrorMessage(reason,'批量操作失败'));}finally{setBusy('');}}
 return (
  <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
   <header className="space-y-2">
    <h3 className="text-base font-semibold leading-6">批量准备开发信</h3>
    <p className="text-sm leading-6 text-muted-foreground">先确认客户名单，再逐一生成专属草稿。每批最多 20 位，发送前由你审核。</p>
   </header>
   <div className="my-5 space-y-5 border-y py-5">
    {selectedIds.length ? (
     <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p>已选择 <strong>{selectedIds.length}</strong> 位客户</p>
      <Button variant="ghost" className="min-h-11" onClick={onClearSelection}>重新选择</Button>
     </div>
    ) : (
     <>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-4">
       <div className="min-w-0 space-y-2"><Label htmlFor="batch-query">客户关键词</Label><Input id="batch-query" value={query} onChange={e=>setQuery(e.target.value)} placeholder="客户、行业或产品"/></div>
       <div className="min-w-0 space-y-2"><Label htmlFor="batch-count">客户数量</Label><Input id="batch-count" type="number" min={1} max={20} value={count} onChange={e=>setCount(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
       <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={high} onChange={e=>setHigh(e.target.checked)}/>
       <span>仅选择高优先级客户<span className="mt-1 block text-xs leading-5 text-muted-foreground">仅筛选待开发且有邮箱的客户。</span></span>
      </label>
     </>
    )}
    <div className="space-y-2"><Label htmlFor="batch-goal">写信要求</Label><Textarea id="batch-goal" rows={4} className="min-h-28 leading-6" value={goal} onChange={e=>setGoal(e.target.value)} maxLength={8000}/></div>
    {knowledge.length>0&&<fieldset className="space-y-2">
     <legend className="mb-2 text-sm font-medium leading-5">参考产品资料<span className="ml-2 font-normal text-muted-foreground">可选，最多 5 项</span></legend>
     {knowledge.map(k=><label key={k.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={knowledgeIds.includes(k.id)} disabled={!knowledgeIds.includes(k.id)&&knowledgeIds.length>=5} onChange={e=>setKnowledgeIds(ids=>e.target.checked?[...ids,k.id]:ids.filter(id=>id!==k.id))}/>
      <span className="min-w-0 break-words">{k.revisions.find(v=>v.version===k.approvedVersion)?.title}<span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">第 {k.approvedVersion} 版</span></span>
     </label>)}
    </fieldset>}
    <Button className="min-h-11" disabled={Boolean(busy)||!goal.trim()||selectedIds.length>20} onClick={()=>void preview()}>{busy==='new'?'正在整理名单…':'预览客户名单'}</Button>
   </div>
   {error&&<p role="alert" className="mb-4 text-sm leading-6 text-destructive">{error}</p>}
   <div className="divide-y">{rows.map(batch=><section key={batch.id} className="space-y-4 py-5">
    <p className="break-words text-sm font-medium leading-6">{batch.goal}</p>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm leading-5">
     <span>{batch.status==='proposed'?'等待确认名单':batch.status==='paused'?'批次已暂停':batch.status==='cancelled'?'批次已取消':'草稿就绪 '+batch.ready+' / '+batch.rows.length}</span>
     {batch.failed>0&&<span className="text-destructive">{batch.failed} 位客户需要处理</span>}
    </div>
    <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer py-1 leading-5">查看 AI 用量</summary><p className="mt-2 leading-5">本批用量上限 {batch.totalTokenBudget.toLocaleString()} tokens，已预留 {batch.budgetCharged.toLocaleString()}。预留包含每次调用的输入与最大输出。</p></details>
    <div className="divide-y rounded-lg border">{batch.rows.map(row=><div key={row.customerId} className="space-y-3 p-4">
     <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 basis-36"><p className="break-words text-sm font-semibold leading-6">{row.name}</p>{row.company&&<p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{row.company}</p>}</div>
      <span className="rounded bg-muted px-2 py-1 text-xs leading-5">{batch.status==='proposed'?'待确认':statusNames[row.status]??'待处理'}</span>
     </div>
     {row.error&&<p className="text-sm leading-6 text-destructive">{row.error}</p>}
     <div className="flex flex-wrap gap-2">
      {row.taskId&&<Button variant="ghost" className="min-h-11" onClick={()=>onTask(row.taskId!)}>查看任务</Button>}
      {row.draftId&&row.status==='awaiting_review'&&<Button variant="outline" className="min-h-11" onClick={()=>onDraft({id:row.taskId!,customerId:row.customerId,draftId:row.draftId} as AgentTask)}>审核草稿</Button>}
      {row.summary&&<Button variant="ghost" className="min-h-11" aria-expanded={Boolean(details[row.customerId])} onClick={()=>setDetails(d=>({...d,[row.customerId]:!d[row.customerId]}))}>客户摘要</Button>}
     </div>
     {details[row.customerId]&&<ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">{row.summary?.split('；').filter(Boolean).map((fact,i)=><li key={i}>{fact}</li>)}</ul>}
    </div>)}</div>
    <div className="flex flex-wrap gap-2">
     {batch.status==='proposed'&&<Button className="h-auto min-h-11 whitespace-normal leading-5" disabled={Boolean(busy)} onClick={()=>void control(batch,'confirm')}>确认为这 {batch.rows.length} 位客户起草</Button>}
     {batch.status==='active'&&<Button variant="outline" className="min-h-11" disabled={Boolean(busy)} onClick={()=>void control(batch,'pause')}>暂停批次</Button>}
     {batch.status==='paused'&&<Button variant="outline" className="min-h-11" disabled={Boolean(busy)} onClick={()=>void control(batch,'resume')}>继续批次</Button>}
     {batch.status!=='cancelled'&&<Button variant="ghost" className="min-h-11" disabled={Boolean(busy)} onClick={()=>void control(batch,'cancel')}>取消未完成任务</Button>}
    </div>
   </section>)}</div>
  </div>
 );
}
