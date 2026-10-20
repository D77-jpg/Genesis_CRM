import * as React from 'react';
import {useNavigate} from 'react-router-dom';
import {Search,ArrowRight,FileCheck2,Loader2,RefreshCw,Mail,ChevronLeft,ChevronRight,ChevronUp,ChevronDown} from 'lucide-react';
import {apiGet,toErrorMessage} from '@/lib/api';
import {salesKnowledge,matchesSalesKnowledge,salesTitle,salesMatchExcerpt,knowledgeEmailPrompt,salesTermState,salesTermDetails,type SalesKnowledge} from '@/lib/knowledge-sales';
import {knowledgeCategories,policyTopics,type ProjectKnowledge} from '@/types/knowledge';
import type {Customer} from '@/types/models';
import type {Paginated} from '@/types/api';
import {useProjectStore} from '@/store/project.store';
import {useAuthStore} from '@/store/auth.store';
import {useUiStore} from '@/store/ui.store';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogBody} from '@/components/ui/dialog';
import {AgentMessageContent} from './agent-message-content';

const categories={reference:'参考资料',company:'公司与品牌',product:'产品与定制',trade:'起订量与交易条件',compliance:'质量与认证',sales_rules:'销售注意事项',faq:'常见问题'};

function Highlighted({text,query}:{text:string;query:string}){
 const terms=[...new Set(query.trim().split(/\s+/).filter(Boolean))];
 if(!terms.length||!text)return <>{text}</>;
 const pattern=new RegExp('('+terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi');
 return <>{text.split(pattern).map((part,index)=>terms.some(term=>part.toLocaleLowerCase()===term.toLocaleLowerCase())
  ?<mark key={index} className="rounded-sm bg-amber-200/80 px-0.5 text-foreground dark:bg-amber-400/30">{part}</mark>
  :<React.Fragment key={index}>{part}</React.Fragment>)}</>;
}

type HighlightRegistry={set:(name:string,value:unknown)=>void;delete:(name:string)=>void};
const highlightRegistry=()=>(CSS as unknown as {highlights?:HighlightRegistry}).highlights;
const HighlightCtor=()=>(globalThis as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight;

// CSS Custom Highlight API: paint matches without touching the rendered DOM, so
// React and the markdown renderer stay in control of the article.
function paintHits(ranges:Range[],active:number){
 const registry=highlightRegistry(),Ctor=HighlightCtor();
 if(!registry||!Ctor)return;
 registry.delete('kb-hit');registry.delete('kb-hit-active');
 if(ranges.length)registry.set('kb-hit',new Ctor(...ranges));
 if(active>=0&&ranges[active])registry.set('kb-hit-active',new Ctor(ranges[active]));
}

function collectHits(root:HTMLElement,query:string){
 const terms=[...new Set(query.trim().split(/\s+/).filter(Boolean))];
 if(!terms.length)return [];
 const pattern=new RegExp('('+terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi');
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>{
  const parent=node.parentElement;
  if(!parent||/^(SCRIPT|STYLE)$/.test(parent.tagName))return NodeFilter.FILTER_REJECT;
  return node.nodeValue&&node.nodeValue.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
 }});
 const ranges:Range[]=[];
 let node:Node|null;
 while((node=walker.nextNode())){
  const text=node.nodeValue??'';
  pattern.lastIndex=0;
  let match:RegExpExecArray|null;
  while((match=pattern.exec(text))){
   const range=document.createRange();
   range.setStart(node,match.index);
   range.setEnd(node,match.index+match[0].length);
   ranges.push(range);
   if(match.index===pattern.lastIndex)pattern.lastIndex++;
  }
 }
 return ranges;
}

function revealHit(range:Range){
 const node=range.startContainer;
 const element=node.nodeType===Node.TEXT_NODE?node.parentElement:node as HTMLElement|null;
 element?.scrollIntoView({block:'center',behavior:'smooth'});
}

export function KnowledgeSalesLibrary({admin,initialId,onManage,onImport}:{admin:boolean;initialId?:string;onManage:(id?:string)=>void;onImport:()=>void}){
 const project=useProjectStore(s=>s.activeProject),user=useAuthStore(s=>s.user);
 const [rows,setRows]=React.useState<ProjectKnowledge[]>([]),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('');
 const [query,setQuery]=React.useState(''),[category,setCategory]=React.useState('all'),[selectedId,setSelectedId]=React.useState(initialId??'');
 const [mobileDetail,setMobileDetail]=React.useState(!!initialId),[picker,setPicker]=React.useState<SalesKnowledge|null>(null),[refresh,setRefresh]=React.useState(0);
 React.useEffect(()=>{let active=true;setLoading(true);setError('');void apiGet<ProjectKnowledge[]>('/agent/knowledge').then(value=>{if(active)setRows(value);}).catch(e=>{if(active)setError(toErrorMessage(e,'资料暂时未能加载'));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[refresh]);
 const entries=salesKnowledge(rows);
 const found=entries.filter(item=>matchesSalesKnowledge(item,query,category));
 const needle=query.trim().toLocaleLowerCase();
 // Title hits first, then body hits; both are real matches, this is only ordering.
 const matches=needle?[...found].sort((a,b)=>Number(b.revision.title.toLocaleLowerCase().includes(needle))-Number(a.revision.title.toLocaleLowerCase().includes(needle))):found;
 const selected=matches.find(item=>item.id===selectedId)??matches[0];
 const pending=rows.filter(r=>!r.archived&&r.hasDraft).length;
 const choose=(item:SalesKnowledge)=>{setSelectedId(item.id);setMobileDetail(true);};
 const search=(text:string)=>{setQuery(text);setMobileDetail(false);};
 const contentRef=React.useRef<HTMLDivElement>(null);
 const rangesRef=React.useRef<Range[]>([]);
 const [hitCount,setHitCount]=React.useState(0),[hitIndex,setHitIndex]=React.useState(0);
 React.useEffect(()=>{
  const root=contentRef.current,text=query.trim();
  if(!root||!text){rangesRef.current=[];setHitCount(0);setHitIndex(0);paintHits([],-1);return;}
  const ranges=collectHits(root,text);
  rangesRef.current=ranges;setHitCount(ranges.length);setHitIndex(0);paintHits(ranges,ranges.length?0:-1);
  if(ranges.length)revealHit(ranges[0]);
  return()=>paintHits([],-1);
 },[query,selected?.id]);
 const goHit=(delta:number)=>{const ranges=rangesRef.current;if(!ranges.length)return;const next=(hitIndex+delta+ranges.length)%ranges.length;setHitIndex(next);paintHits(ranges,next);revealHit(ranges[next]);};
 return <div className="p-4 sm:p-6 lg:p-7 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
  <header className="flex flex-wrap items-start justify-between gap-4 xl:hidden">
   <div className="max-w-2xl space-y-2"><p className="text-sm font-medium text-muted-foreground">{project?.name} · 本项目资料</p><h1 className="text-2xl font-semibold tracking-tight">销售资料库</h1><p className="text-sm leading-6 text-muted-foreground">找产品卖点、确认交易条件，再交给销售助手准备邮件。</p></div>
   <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" className="min-h-11" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw className="h-4 w-4" aria-hidden/>刷新资料</Button>{admin&&<Button variant="outline" className="min-h-11" onClick={()=>onManage()}>管理资料<ArrowRight className="h-4 w-4" aria-hidden/></Button>}</div>
  </header>
  <ol aria-label="使用这份资料的三个步骤" className="my-6 flex flex-wrap gap-x-6 gap-y-2 border-y py-3 text-sm leading-6 text-muted-foreground xl:hidden"><li><span className="mr-2 font-semibold text-primary">1</span>查找产品或政策</li><li><span className="mr-2 font-semibold text-primary">2</span>核对适用条件</li><li><span className="mr-2 font-semibold text-primary">3</span>选客户，让助手写草稿</li></ol>
  {error&&<div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6 xl:shrink-0"><p>{error}</p><Button variant="outline" className="mt-3 min-h-11" onClick={()=>setRefresh(n=>n+1)}>重新加载</Button></div>}
  {loading?<p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden/>正在加载当前项目资料…</p>:!error&&<>
   {entries.length===0?<section aria-label="资料待准备" className="rounded-xl border bg-muted/25 px-5 py-8 sm:px-8">
    <FileCheck2 className="mb-4 h-7 w-7 text-primary" aria-hidden/><h2 className="text-lg font-semibold">还没有审核通过的销售资料</h2>
    <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{admin&&pending?'当前有 '+pending+' 份资料待审核。导入后只是草稿，需要核对产品、交易条件和来源，再逐条发布。':'请联系项目管理员录入公司、产品和交易政策，并完成审核发布。'}审核前，助手不能把这些资料用于客户邮件。</p>
    {admin?<div className="mt-5 flex flex-wrap gap-3"><Button className="min-h-11" onClick={onImport}>上传文件<ArrowRight className="h-4 w-4" aria-hidden/></Button>{!!pending&&<Button variant="outline" className="min-h-11" onClick={()=>onManage()}>去审核资料（{pending}）</Button>}</div>:<p className="mt-4 text-sm leading-6">你仍可在客户页使用销售助手；缺少的业务依据会列为待确认。</p>}
    <p className="mt-5 text-xs leading-6 text-muted-foreground">发布不代表所有条件都适用于每位客户。使用时仍要核对产品、数量、有效期和例外。</p>
   </section>:<>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 xl:mb-3 xl:shrink-0"><div className="w-full max-w-xl space-y-2 xl:max-w-md"><label htmlFor="sales-knowledge-query" className="text-sm font-medium">找什么资料？</label><div className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden/><Input id="sales-knowledge-query" className="min-h-11 pl-10" value={query} onChange={e=>search(e.target.value)} placeholder="输入产品、工艺、MOQ 或政策关键词"/></div></div><p role="status" className="text-sm text-muted-foreground">{query.trim()?'找到 '+matches.length+' 份含「'+query.trim()+'」的资料':matches.length+' 份已发布资料'}{admin&&pending>0&&<> · <button type="button" className="min-h-11 text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>onManage()}>另有 {pending} 份待审核</button></>}</p><div className="ml-auto hidden flex-wrap items-center gap-2 xl:flex"><Button variant="ghost" className="min-h-11" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw className="h-4 w-4" aria-hidden/>刷新资料</Button>{admin&&<Button variant="outline" className="min-h-11" onClick={()=>onManage()}>管理资料<ArrowRight className="h-4 w-4" aria-hidden/></Button>}</div></div>
    <nav aria-label="销售资料分类" className="mb-5 flex flex-wrap gap-2 xl:shrink-0">{[['all','全部资料'],...Object.entries(categories)].map(([key,label])=><button key={key} type="button" aria-pressed={category===key} onClick={()=>{setCategory(key);setMobileDetail(false);}} className={'min-h-11 rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '+(category===key?'bg-primary text-primary-foreground':'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground')}>{label}<span className="ml-2 text-xs tabular-nums">{key==='all'?entries.length:entries.filter(e=>e.revision.category===key).length}</span></button>)}</nav>
    {!matches.length?<div className="border-y py-12 text-center"><h2 className="font-medium">没有找到匹配的已发布资料</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">试试产品名称或更短的关键词，也可以切换分类。</p><Button variant="outline" className="mt-4 min-h-11" onClick={()=>{setQuery('');setCategory('all');}}>清除筛选</Button></div>:<div className="grid rounded-xl border xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)]">
     <section aria-label="已发布资料列表" className={(mobileDetail?'hidden xl:block':'block')+' min-w-0 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden xl:border-r'}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3 text-sm font-medium"><span>选择资料</span><span className="text-xs font-normal text-muted-foreground">{matches.length} 篇</span></div>
      <ul className="divide-y xl:min-h-0 xl:flex-1 xl:overflow-y-auto">{matches.map(item=>{const excerpt=query.trim()?salesMatchExcerpt(item,query):'';return <li key={item.id}><button type="button" aria-current={selected?.id===item.id?'true':undefined} onClick={()=>choose(item)} className={'w-full min-w-0 border-l-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring '+(selected?.id===item.id?'border-primary bg-primary/5':'border-transparent hover:bg-muted/60')}><span className="flex flex-wrap items-center gap-2 text-[11px] leading-4 text-muted-foreground"><span>{knowledgeCategories[item.revision.category??'product']}</span><span>第 {item.revision.version} 版</span>{item.revision.accessScope==='admins'&&<Badge variant="outline">仅管理员</Badge>}</span><span className="mt-1 block break-words text-sm font-medium leading-5"><Highlighted text={salesTitle(item.revision.title)} query={query}/></span>{excerpt?<span className="mt-1 block text-[11px] leading-4 text-muted-foreground line-clamp-2"><Highlighted text={excerpt} query={query}/></span>:!!item.revision.products?.length&&<span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">{item.revision.products.join('、')}</span>}</button></li>;})}</ul>
     </section>
     {selected&&<article aria-label="销售资料详情" className={(mobileDetail?'block':'hidden xl:block')+' min-w-0 xl:flex xl:min-h-0 xl:flex-col'}>
      <div className="flex shrink-0 items-center px-4 pt-3 sm:px-6 xl:hidden">
       <Button variant="ghost" className="min-h-11 px-0" onClick={()=>setMobileDetail(false)}><ChevronLeft className="h-4 w-4" aria-hidden/>返回资料列表</Button>
      </div>
      {!!query.trim()&&<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2 text-xs sm:px-6">
       <span className="text-muted-foreground">「{query.trim()}」{hitCount?'第 '+String(hitIndex+1)+' / '+hitCount+' 处':'本文没有直接命中'}</span>
       {hitCount>0&&<span className="flex items-center gap-1"><Button variant="outline" className="min-h-9" onClick={()=>goHit(-1)}><ChevronUp className="h-4 w-4" aria-hidden/>上一处</Button><Button variant="outline" className="min-h-9" onClick={()=>goHit(1)}>下一处<ChevronDown className="h-4 w-4" aria-hidden/></Button></span>}
      </div>}
      <div className="min-h-0 xl:flex-1 xl:overflow-y-auto">
       <div ref={contentRef} className="mx-auto w-full max-w-3xl p-4 sm:p-6">
       <div className="mb-4 flex flex-wrap items-center gap-2"><Badge variant="developed">已发布</Badge><span className="text-xs text-muted-foreground">{knowledgeCategories[selected.revision.category??'product']} · 第 {selected.revision.version} 版</span></div>
       <h2 className="break-words text-xl font-semibold leading-8">{salesTitle(selected.revision.title)}</h2>
       <div className="my-5 rounded-lg border-l-4 border-primary bg-primary/5 p-4"><h3 className="text-sm font-semibold">先看适用范围</h3><p className="mt-2 break-words text-sm leading-7">{selected.revision.applicability||'具体适用条件需进一步核对'}</p><p className="mt-2 break-words text-xs leading-6 text-muted-foreground">产品：{selected.revision.products?.join('、')||'项目通用'}{selected.revision.validUntil?' · 有效至 '+new Date(selected.revision.validUntil).toLocaleDateString():''}</p></div>
       {(selected.revision.terms??[]).length>0&&<section aria-label="交易条件" className="mb-6 space-y-3"><h3 className="text-sm font-semibold">交易条件，需完整使用</h3>{selected.revision.terms!.map((term,i)=><div key={i} className="border-b pb-3 text-sm leading-7"><div className="flex flex-wrap items-center gap-2"><strong>{policyTopics[term.topic]}：{[term.currency,term.value,term.unit].filter(Boolean).join(' ')}</strong><Badge variant="outline">{salesTermState(term)}</Badge></div><p className="mt-1 break-words text-muted-foreground">{term.conditions}</p>{salesTermDetails(term).map((line,n)=><p key={n} className="break-words text-muted-foreground">{line}</p>)}</div>)}</section>}
       <div className="break-words"><AgentMessageContent content={selected.revision.content}/></div>
       <div className="mt-6 border-t pt-5"><Button className="min-h-11 max-w-full whitespace-normal text-left leading-6" onClick={()=>setPicker(selected)}><Mail className="h-4 w-4 shrink-0" aria-hidden/>用这份资料准备开发信<ArrowRight className="h-4 w-4 shrink-0" aria-hidden/></Button><p className="mt-2 text-xs leading-6 text-muted-foreground">先选客户，再在助手里确认写信要求。助手会重新核对依据，邮件由你审核发送。</p></div>
       <details className="mt-5 border-t pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground">查看来源与版本</summary><dl className="space-y-3 pb-3 text-xs leading-6"><div><dt className="font-medium">资料来源</dt><dd className="break-words text-muted-foreground">{selected.revision.source}</dd></div><div><dt className="font-medium">生效时间</dt><dd className="text-muted-foreground">{new Date(selected.revision.validFrom!).toLocaleString()}</dd></div></dl>{admin&&<Button variant="outline" className="mb-3 min-h-11" onClick={()=>onManage(selected.id)}>修订这份资料</Button>}</details>
      </div>
      </div>
     </article>}
    </div>}
   </>}
   {rows.length>=500&&<p role="status" className="mt-4 text-xs leading-6 text-muted-foreground">当前展示最近500条可访问记录中的有效资料；本页筛选不代表全库搜索。</p>}
  </>}
  {picker&&project&&user&&<KnowledgeCustomerPicker key={picker.id} item={picker} projectId={project.id} userId={user.id} onClose={()=>setPicker(null)}/>}
 </div>;
}

function KnowledgeCustomerPicker({item,projectId,userId,onClose}:{item:SalesKnowledge;projectId:string;userId:string;onClose:()=>void}){
 const navigate=useNavigate(),prepare=useUiStore(s=>s.prepareKnowledgeEmail);
 const [query,setQuery]=React.useState(''),[page,setPage]=React.useState(1),[customers,setCustomers]=React.useState<Paginated<Customer>|null>(null),[loading,setLoading]=React.useState(true),[error,setError]=React.useState(''),[retry,setRetry]=React.useState(0);
 React.useEffect(()=>{let active=true;const abort=new AbortController();setLoading(true);setCustomers(null);setError('');const timer=setTimeout(()=>{void apiGet<Paginated<Customer>>('/customers',{params:{search:query.trim(),page,limit:10},signal:abort.signal}).then(value=>{if(active)setCustomers(value);}).catch(e=>{if(active)setError(toErrorMessage(e,'客户列表暂时未能加载'));}).finally(()=>{if(active)setLoading(false);});},250);return()=>{active=false;clearTimeout(timer);abort.abort();};},[query,page,retry]);
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>为哪位客户准备开发信？</DialogTitle><DialogDescription>参考资料：{salesTitle(item.revision.title)}。选中后会打开客户页和助手，不会立即生成或发送邮件。</DialogDescription></DialogHeader><DialogBody><div className="space-y-2"><label htmlFor="knowledge-customer-search" className="text-sm font-medium">搜索当前项目的客户</label><Input id="knowledge-customer-search" className="min-h-11" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="客户姓名、公司或邮箱"/></div>{error&&<div role="alert" className="my-4 text-sm leading-6 text-destructive">{error}<Button variant="outline" className="ml-2 min-h-11" onClick={()=>setRetry(n=>n+1)}>重试</Button></div>}{loading&&<p role="status" className="py-6 text-sm text-muted-foreground">正在加载可访问客户…</p>}{!loading&&customers&&<><ul className="mt-4 divide-y border-y">{customers.items.map(c=><li key={c.id}><button type="button" className="flex min-h-16 w-full items-center justify-between gap-3 py-3 text-left hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>{prepare({projectId,userId,customerId:c.id,prompt:knowledgeEmailPrompt(item)});onClose();navigate('/customers/'+c.id);}}><span className="min-w-0"><span className="block break-words text-sm font-medium">{c.name}</span><span className="mt-1 block break-words text-xs leading-6 text-muted-foreground">{c.company||'未填写公司'} · {c.email||'未填写邮箱，发送前需补充'}</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden/></button></li>)}</ul>{!customers.items.length&&<p className="py-6 text-sm leading-6 text-muted-foreground">没有匹配的可访问客户，请换个关键词，或先在客户管理中新增客户。</p>}<div className="mt-4 flex items-center justify-between gap-3"><Button variant="outline" className="min-h-11" aria-label="客户上一页" disabled={!customers.hasPrev} onClick={()=>setPage(n=>n-1)}><ChevronLeft className="h-4 w-4" aria-hidden/>上一页</Button><span className="text-xs text-muted-foreground">第 {customers.page} / {Math.max(customers.totalPages,1)} 页</span><Button variant="outline" className="min-h-11" aria-label="客户下一页" disabled={!customers.hasNext} onClick={()=>setPage(n=>n+1)}>下一页<ChevronRight className="h-4 w-4" aria-hidden/></Button></div></>}</DialogBody></DialogContent></Dialog>;
}
