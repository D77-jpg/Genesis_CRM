import * as React from 'react';
import {apiGet,apiPut,toErrorMessage} from '@/lib/api';import {Button} from '@/components/ui/button';import {Input} from '@/components/ui/input';import {Label} from '@/components/ui/label';import {formatDateTime} from '@/lib/format';
interface Rule {version:number;enabled:boolean;inbound:boolean;due:boolean;sent:boolean;dailyLimit:number;tokenBudget:number}
interface Event {id:string;customerName?:string;kind:'inbound'|'due'|'sent';status:string;reason?:string;taskId?:string;sourceId:string;createdAt:string}
const names={inbound:'新来信',due:'跟进到期',sent:'邮件已发送'};const statusNames:Record<string,string>={pending:'待处理',waiting_budget:'等待可用额度',waiting_customer:'等待客户关联',task_created:'已转为任务',blocked:'已停止联系',completed:'已处理',ignored:'不再适用'};
export function AgentEventInbox({onTask}:{onTask:(id:string)=>void}){
 const [rule,setRule]=React.useState<Rule|null>(null);const [events,setEvents]=React.useState<Event[]>([]);const [error,setError]=React.useState('');const [busy,setBusy]=React.useState(false);const [dirty,setDirty]=React.useState(false);
 React.useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;void apiGet<Rule>('/agent/automation-rule').then(r=>{if(active)setRule(r);}).catch(e=>setError(toErrorMessage(e)));const poll=async()=>{try{const rows=await apiGet<Event[]>('/agent/inbox');if(active)setEvents(rows);}catch(e){if(active)setError(toErrorMessage(e));}if(active)timer=setTimeout(()=>void poll(),2500);};void poll();return()=>{active=false;clearTimeout(timer);};},[]);
 function patch(value:Partial<Rule>){setRule(r=>r?{...r,...value}:r);setDirty(true);}
 async function save(){if(!rule)return;setBusy(true);setError('');try{const result=await apiPut<Rule>('/agent/automation-rule',{expectedVersion:rule.version,enabled:rule.enabled,inbound:rule.inbound,due:rule.due,sent:rule.sent,dailyLimit:rule.dailyLimit,tokenBudget:rule.tokenBudget});setRule(result);setDirty(false);}catch(e){setError(toErrorMessage(e,'事件规则保存失败'));}finally{setBusy(false);}}
 return (
  <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
   <header className="space-y-2"><h3 className="text-base font-semibold leading-6">来信与跟进提醒</h3><p className="text-sm leading-6 text-muted-foreground">集中查看客户新来信与到期跟进。已准备的草稿可以从待办打开审核。</p></header>
   {error&&<p role="alert" className="my-4 text-sm leading-6 text-destructive">{error}</p>}
   {rule&&<details className="my-5 rounded-lg border p-3"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium"><span>自动准备设置</span><span className="text-xs font-normal text-muted-foreground">{dirty?'有未保存修改':rule.enabled?'已开启 · 点击管理':'未开启 · 点击设置'}</span></summary><section className="mt-4 space-y-5 border-t pt-4">
    <div className="space-y-2"><h4 className="text-sm font-semibold">我的自动准备规则</h4><label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
     <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={rule.enabled} onChange={e=>patch({enabled:e.target.checked})}/>
     <span>开启自动准备<span className="mt-1 block text-xs leading-5 text-muted-foreground">{dirty?'有修改尚未保存':rule.enabled?'已开启':'当前已关闭'}</span></span>
    </label></div>
    <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">处理哪些事项</legend>
     {(['inbound','due','sent'] as const).map(key=><label key={key} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={rule[key]} onChange={e=>patch({[key]:e.target.checked})}/>
      <span>{({inbound:'新来信：整理需求并起草回复',due:'跟进到期：准备下一封跟进邮件',sent:'邮件发送成功后：自动记录跟进'} as const)[key]}</span>
     </label>)}
    </fieldset>
    <div className="space-y-2"><Label htmlFor="event-daily-limit">每天最多准备的任务数</Label><Input id="event-daily-limit" type="number" min={1} max={20} value={rule.dailyLimit} onChange={e=>patch({dailyLimit:Number(e.target.value)})}/><p className="text-xs leading-5 text-muted-foreground">每天最多 20 项，超出的事项保留到后续处理。</p></div>
    <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer leading-6">高级设置</summary><div className="mt-4 space-y-2"><Label htmlFor="event-token-budget">每项任务的 AI 用量上限</Label><Input id="event-token-budget" type="number" min={10000} max={60000} step={1000} value={rule.tokenBudget} onChange={e=>patch({tokenBudget:Number(e.target.value)})}/><p className="text-xs leading-5 text-muted-foreground">按用量计算，范围 10,000–60,000。重试会沿用同一个任务的额度。</p></div></details>
    <p className="text-sm leading-6 text-muted-foreground">仅处理当前账号收到的邮件及本人负责客户的事项。开启前的历史邮件不会重复处理；未关联客户的来信需先由管理员确认。关闭或修改规则会停止未完成的自动任务，已有草稿保留。</p>
    <div className="flex flex-wrap items-center gap-3"><Button className="min-h-11" disabled={busy||!dirty||rule.dailyLimit<1||rule.dailyLimit>20||rule.tokenBudget<10000||rule.tokenBudget>60000} onClick={()=>void save()}>{busy?'正在保存…':'保存规则'}</Button>{dirty&&<span className="text-xs leading-5 text-muted-foreground">保存后生效</span>}</div>
   </section></details>}
   <h4 className="mb-3 text-sm font-semibold">最近事项</h4>
   {!events.length&&<p className="py-5 text-sm leading-6 text-muted-foreground">暂无新事项。开启规则后，新来信和到期跟进会显示在这里。</p>}
   <ol className="divide-y">{events.map(e=><li key={e.id} className="space-y-3 py-4">
    <div className="flex flex-wrap justify-between gap-2 text-sm leading-6"><div className="min-w-0 flex-1 basis-36">{e.customerName&&<p className="break-words font-semibold">{e.customerName}</p>}<p className="text-muted-foreground">{names[e.kind]}</p></div><span className="text-xs leading-5 text-muted-foreground">{statusNames[e.status]??'待处理'}</span></div>
    <p className="text-xs leading-5 text-muted-foreground">{formatDateTime(e.createdAt)}</p>
    {e.reason&&<p className="text-sm leading-6">{e.reason}</p>}
    {e.taskId&&<Button variant="outline" className="min-h-11" onClick={()=>onTask(e.taskId!)}>查看任务</Button>}
   </li>)}</ol>
  </div>
 );
}
