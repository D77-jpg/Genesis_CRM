import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,RefreshCw,AlertCircle,Search} from 'lucide-react';
import {apiGet,apiPost,toErrorMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
type Generation={id:string;state:string;done:number;total:number;publications:number;attempts:number;embedded:number;reused:number;
 error?:{code:string;message:string};createdAt:string;identity:{model:string;revision:string;dimension:number};metrics?:{elapsedMs:number;rssMiB:number}};
type Status={storageIssue?:string;status:string;ready:boolean;effectivePublications:number;activeGeneration?:string;identity:{model:string;revision:string;dimension:number};generations:Generation[]};
const labels:Record<string,string>={queued:'等待处理',running:'正在准备',ready:'已完成',failed:'需要处理',superseded:'已被新任务替代',deleting:'清理中',deleted:'已清理'};
export function KnowledgeIndex(){
 const [value,setValue]=useState<Status|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(true);
 const load=useCallback(async()=>{const result=await apiGet<Status>('/knowledge-index');if(mounted.current)setValue(result);},[]);
 useEffect(()=>{mounted.current=true;void load().catch(e=>setError(toErrorMessage(e)));const timer=setInterval(()=>{void load().catch(e=>{if(mounted.current)setError(toErrorMessage(e));});},4000);
  return()=>{mounted.current=false;clearInterval(timer);};},[load]);
 async function act(path:string,body:unknown={}){setBusy(true);setError('');setNotice('');try{const result=await apiPost<{removed?:number}>(path,body);if(!mounted.current)return;
  setNotice(path.endsWith('cleanup')?`已清理 ${result.removed??0} 个旧任务。`:'操作已保存，处理进度会自动更新。');await load();
 }catch(e){if(mounted.current)setError(toErrorMessage(e));}finally{if(mounted.current)setBusy(false);}}
 return <div className="p-4 sm:p-6 space-y-6">
  <header className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><h1 className="text-xl font-semibold flex items-center gap-2"><Search className="h-5 w-5" aria-hidden="true"/>知识检索准备</h1><p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">将已发布、当前有效的资料准备好，供销售助手按含义查找。草稿与未审核的原文不会参与检索。</p></div>
   <Button disabled={busy||!value} onClick={()=>void act('/knowledge-index/rebuild',{requestKey:crypto.randomUUID()})}><RefreshCw className="h-4 w-4 mr-2" aria-hidden="true"/>更新检索资料</Button></header>
  {error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}<Button variant="outline" className="ml-3" onClick={()=>void load().then(()=>setError('')).catch(e=>setError(toErrorMessage(e)))}>重新加载</Button></div>}
  {notice&&<p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  {!value?<p role="status" className="text-sm text-muted-foreground">正在读取准备状态…</p>:<>
   <section className="rounded-lg border p-4 space-y-2" aria-label="当前可用情况"><h2 className="font-medium flex items-center gap-2">{value.ready?<CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true"/>:<AlertCircle className="h-5 w-5 text-amber-600" aria-hidden="true"/>}{value.ready?'资料已就绪':'资料尚未就绪'}</h2>
    <p className="text-sm leading-relaxed text-muted-foreground">{value.storageIssue&&<span className="block text-destructive mb-2">{value.storageIssue}</span>}当前有 {value.effectivePublications} 条有效发布资料。{value.ready?'助手可以检索这些资料；后续变更会重新核对。':'请更新检索资料。准备完成前，助手会明确提示缺少可用检索依据。'}</p>
    <p className="text-sm text-muted-foreground">长段落若超出模型上限，请保持条件完整，拆成较短知识条目后重新发布。</p></section>
   <section aria-label="准备记录"><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 className="font-medium">准备记录</h2><Button variant="ghost" disabled={busy} onClick={()=>void act('/knowledge-index/cleanup')}>清理一天前的旧代次</Button></div>
    {!value.generations.length?<p className="text-sm text-muted-foreground border-t py-6">还没有准备记录。先审核并发布知识，再点击“更新检索资料”。</p>:<ul className="divide-y border-y">{value.generations.map(g=><li key={g.id} className="py-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-sm">{labels[g.state]??g.state}{g.id===value.activeGeneration?' · 当前使用':''}</p><p className="text-sm text-muted-foreground mt-1">{new Date(g.createdAt).toLocaleString()} · {g.publications} 条知识 · {g.done}/{g.total} 个片段</p></div><div className="flex flex-wrap gap-2">
     {g.state==='failed'&&<Button disabled={busy} variant="outline" onClick={()=>void act(`/knowledge-index/${g.id}/retry`)}>重试此任务</Button>}
     {['queued','running'].includes(g.state)&&<Button disabled={busy} variant="outline" onClick={()=>void act(`/knowledge-index/${g.id}/cancel`)}>停止准备</Button>}
     {g.state==='ready'&&g.id!==value.activeGeneration&&<Button disabled={busy} variant="outline" onClick={()=>void act(`/knowledge-index/${g.id}/rollback`)}>校验并切换</Button>}
    </div></div>{g.state==='running'&&<progress aria-label="资料准备进度" className="w-full h-2" max={Math.max(g.total,1)} value={g.done}/>}
    {g.error&&<p className="text-sm text-destructive leading-relaxed" role="status">{g.error.message}</p>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer min-h-6">技术信息</summary><p className="break-all leading-relaxed mt-2">代次 {g.id} · {g.identity.model} · {g.identity.dimension} 维 · 模型版本 {g.identity.revision}<br/>本次生成 {g.embedded}，复用 {g.reused}；尝试 {g.attempts} 次。{g.metrics?`最近批次 ${Math.round(g.metrics.elapsedMs)} ms，进程常驻内存 ${g.metrics.rssMiB} MiB。`:''}</p></details></li>)}</ul>}
   </section></>}
 </div>;
}
