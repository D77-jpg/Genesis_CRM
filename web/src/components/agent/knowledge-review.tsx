import * as React from 'react';
import {FileSearch,Loader2,RefreshCw,ChevronRight,TriangleAlert} from 'lucide-react';
import {apiGet,apiPost,toErrorMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import type {KnowledgeReview,KnowledgeFreshness} from '@/types/knowledge';
interface EvidenceResult {knowledgeReview?:KnowledgeReview;knowledgeFreshness?:KnowledgeFreshness;reviewBodyChanged?:boolean}
export function KnowledgeReviewPanel({review,freshness,letterId,analysisId}:{review?:KnowledgeReview;freshness?:KnowledgeFreshness;letterId?:string;analysisId?:string}){
 const [loaded,setLoaded]=React.useState<EvidenceResult>({});const [error,setError]=React.useState('');const [busy,setBusy]=React.useState(false);
 const [next,setNext]=React.useState<{letterId:string;customerId:string}|null>(null);
 const requestKey=React.useRef(crypto.randomUUID());
 React.useEffect(()=>{setLoaded({});setNext(null);setError('');requestKey.current=crypto.randomUUID();if(!letterId&&!analysisId)return;let active=true;
  void apiGet<EvidenceResult>(letterId?'/letters/'+letterId:'/agent/customer-analyses/'+analysisId).then(data=>{if(active)setLoaded(data);}).catch(e=>{if(active)setError(toErrorMessage(e,'无法读取草稿依据，请稍后重试'));});
  return()=>{active=false;};
 },[letterId,analysisId]);
 const value=loaded.knowledgeReview??review;const current=loaded.knowledgeFreshness??freshness;
 async function regenerate(){if(!letterId)return;setBusy(true);setError('');try{setNext(await apiPost('/agent/knowledge-drafts/'+letterId+'/regenerate',{requestKey:requestKey.current}));}catch(e){setError(toErrorMessage(e,'重新生成尚未完成，原草稿仍保留'));}finally{setBusy(false);}}
 if(!value&&!error)return null;
 const sourceLabel=(id:string)=>{const source=value?.sources.find(s=>s.sourceId===id);return source?source.title+' · v'+source.version:'未确认来源';};
 const stateLabels:Record<string,string>={index_not_ready:'检索资料尚未就绪',index_stale:'检索资料需要更新',ready:'已检索有效知识',no_match:'没有匹配的有效知识',expired:'相关知识已过期',conflict:'存在来源冲突',retrieval_failed:'检索暂时失败'};
 return <section className="my-4 space-y-3" aria-label="草稿知识依据">
  {(current?.changed.length||current?.failed)&&<div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm leading-6"><p className="flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden/>{current.failed?'暂时无法核对依据状态':'草稿使用的依据已发生变化'}</p><p className="mt-1 text-muted-foreground">原草稿保留生成时的内容与依据，发送前请重新核对。</p>{current.changed.map(item=><p key={item.sourceId} className="mt-1">{item.title}：{item.reason}</p>)}</div>}
  {loaded.reviewBodyChanged&&<p className="text-xs leading-5 text-amber-700 dark:text-amber-400">正文已修改，以下依据对应原生成版本，请核对修改后的承诺。</p>}
  {error&&<p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}
  {value&&<details className="rounded-lg border bg-muted/20 p-3">
   <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-medium"><FileSearch className="h-4 w-4 shrink-0" aria-hidden/>内部审核信息<Badge variant={value.completeness==='partial'?'outline':'developed'}>{value.completeness==='partial'?'不完整草稿 · 待确认':'依据已核对'}</Badge><ChevronRight className="ml-auto h-4 w-4 shrink-0" aria-hidden/></summary>
   <div className="mt-3 space-y-5 border-t pt-4 text-sm leading-6">
    <p className="text-xs leading-5 text-muted-foreground">{stateLabels[value.status]??'待核对'} · {new Date(value.generatedAt).toLocaleString()}<span className="block">仅供内部审核，不会自动写入客户邮件。</span></p>
    <section><h4 className="font-semibold">使用的知识与版本</h4>{!value.sources.length&&<p className="mt-2 text-muted-foreground">尚无可用依据，请补充资料后重新生成。</p>}<ul className="mt-2 space-y-3">{value.sources.map(source=><li key={source.sourceId} className="rounded-md border bg-background p-3"><p className="font-medium">{source.title} · v{source.version}</p><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{source.source}</p><p className="mt-2 break-words">适用：{source.applicability}</p><details className="mt-2"><summary className="min-h-11 cursor-pointer text-xs text-primary">查看生成时的相关片段</summary><p className="whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{source.content}</p>{source.index&&<div className="mt-3 space-y-2 border-t pt-3 text-xs text-muted-foreground"><p className="break-all">本地索引 · {source.index.selection==='explicit'?'指定知识':'语义匹配'} · {source.index.dimension} 维 · 代次 {source.index.generation}</p><p className="break-all">{source.index.modelName} · {source.index.revision}</p><ul className="space-y-2">{source.index.chunks.map(chunk=><li key={chunk.id} className="break-all">发布片段 {chunk.id.slice(0,12)} · {JSON.stringify(chunk.location)}{chunk.sourceRefs.map((ref,i)=><span key={i} className="block">原文关联：{String(ref.documentId??'')} · {JSON.stringify(ref.location??{})}</span>)}</li>)}</ul></div>}</details></li>)}</ul></section>
    <section><h4 className="font-semibold">关键承诺与依据</h4>{!value.claims.length&&<p className="mt-2 text-muted-foreground">未加入数值型交易承诺。</p>}<ul className="mt-2 space-y-3">{value.claims.map((claim,i)=><li key={i}><p className="break-words">{claim.text}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{claim.sourceIds.map(sourceLabel).join('；')}</p></li>)}</ul></section>
    <section><h4 className="font-semibold">客户问题</h4>{!value.questions.length&&<p className="mt-2 text-muted-foreground">本次没有提取到具体政策问题。</p>}<ul className="mt-2 space-y-2">{value.questions.map((q,i)=><li key={i} className="break-words"><span className={q.status==='answered'?'text-emerald-700 dark:text-emerald-400':'text-amber-700 dark:text-amber-400'}>{q.status==='answered'?'已回答':'待确认'} · </span>{q.question}</li>)}</ul></section>
    {value.issues.length>0&&<section><h4 className="font-semibold">缺口、过期与冲突</h4><ul className="mt-2 list-disc space-y-2 pl-4">{value.issues.map((issue,i)=><li key={i} className="break-words text-muted-foreground">{issue.message}</li>)}</ul></section>}
   </div>
  </details>}
  {letterId&&value&&<div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" className="min-h-11" disabled={busy||!!next} onClick={()=>void regenerate()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<RefreshCw className="h-4 w-4"/>}按最新依据重新生成</Button>{!next&&<p className="text-xs leading-5 text-muted-foreground">生成新草稿，保留当前版本。</p>}{next&&<Button asChild className="min-h-11"><a href={'/customers/'+next.customerId+'?knowledgeDraft='+next.letterId}>打开新草稿审核</a></Button>}</div>}
 </section>;
}
