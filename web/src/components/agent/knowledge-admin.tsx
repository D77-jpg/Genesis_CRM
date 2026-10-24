import * as React from 'react';
import {Upload,Plus,FileText,CheckCircle2,AlertCircle,Loader2,RefreshCw,Pencil,ChevronDown,Eye,Power,Trash2} from 'lucide-react';
import {apiDelete,apiGet,apiPost,toErrorMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Dialog,DialogContent,DialogHeader,DialogBody,DialogFooter,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {ConfirmDialog} from '@/components/common/confirm-dialog';
import {AgentMessageContent} from './agent-message-content';
import {KnowledgeEntryForm} from './knowledge-entry-form';
import {validateKnowledgeFiles} from '@/lib/knowledge-upload';
import {knowledgeCategories,type KnowledgeCategory,type ProjectKnowledge} from '@/types/knowledge';

type Parsing={id:string;revision:number;state:string;stage:string;done:number;total:number;warnings:string[];error?:{code:string;message:string}};
type Source={id:string;originalName:string;source:string;bytes:number;category:string;createdAt:string;parsing:Parsing|null;reviewState?:string};
type Status={ready:boolean;status:string;effectivePublications:number;storageIssue?:string};
type Preview={title:string;category:KnowledgeCategory;source:string;sourceName:string;notes?:string[];parts:{chars:number;content:string}[]};
const parsingLabels:Record<string,string>={queued:'排队中',running:'正在读取',succeeded:'读取完成',partial:'读取完成',failed:'读取失败',cancelled:'已取消'};
const fileSize=(bytes:number)=>bytes<1024?bytes+' B':bytes<1024*1024?Math.round(bytes/1024)+' KB':(bytes/1024/1024).toFixed(1)+' MB';
// Parser advisories are terse system sentences. Keep only what a reviewer can
// act on; the 128-token notice is an internal indexing limit, not lost text.
const noteText=(warning:string)=>{
 if(/128 tokens/.test(warning))return null;
 if(/疑似指令/.test(warning))return '文件里有类似“忽略指令”的文字，只当资料，不会执行。';
 if(/OCR|扫描/.test(warning))return '扫描件由本地 OCR 识别，数字和条件请对照原图核对。';
 if(/未识别到正文/.test(warning))return '有页面没有识别到文字，收录后请核对。';
 if(/表格|表头|合并|公式/.test(warning))return '表格按原样保留；表头、合并单元格和单位请在收录后核对。';
 if(/PDF 整页/.test(warning))return 'PDF 按页保留原文；跨页表格和脚注请核对。';
 return warning;
};
const fileNotes=(warnings?:string[])=>[...new Set((warnings??[]).map(noteText).filter((note):note is string=>!!note))];
const seriousNote=(note:string)=>/OCR|扫描|没有识别|忽略指令/.test(note);
const nativeSelect='min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function KnowledgeAdmin({initialKnowledgeId,initialDocumentId}:{initialKnowledgeId?:string;initialDocumentId?:string}){
 const [entries,setEntries]=React.useState<ProjectKnowledge[]>([]);
 const [files,setFiles]=React.useState<Source[]>([]);
 const [status,setStatus]=React.useState<Status|null>(null);
 const [tab,setTab]=React.useState<'pending'|'published'|'files'>('pending');
 const [loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
 const [openEntry,setOpenEntry]=React.useState(initialKnowledgeId??'');
 const [editing,setEditing]=React.useState<ProjectKnowledge|null|'new'>(null);
 const [collect,setCollect]=React.useState<{file:Source;preview?:Preview;title:string;category:KnowledgeCategory;source:string;expanded:boolean;loading:boolean;readonly:boolean}|null>(null);
 const [pendingDoc,setPendingDoc]=React.useState(initialDocumentId??'');
 const [uploading,setUploading]=React.useState<{name:string;status:string}[]>([]);
 const [confirm,setConfirm]=React.useState<{kind:'entry'|'file';id:string;name:string}|null>(null);
 const fileInput=React.useRef<HTMLInputElement>(null);

 const loadEntries=React.useCallback(async()=>{setEntries(await apiGet<ProjectKnowledge[]>('/agent/knowledge'));},[]);
 const loadFiles=React.useCallback(async()=>{setFiles((await apiGet<{documents:Source[];next:string|null}>('/knowledge-documents')).documents);},[]);
 const loadStatus=React.useCallback(async()=>{try{setStatus(await apiGet<Status>('/knowledge-index'));}catch{setStatus(null);}},[]);
 const loadAll=React.useCallback(async()=>{setLoading(true);try{await Promise.all([loadEntries(),loadFiles(),loadStatus()]);}catch(e){setError(toErrorMessage(e,'资料暂时未能加载'));}finally{setLoading(false);}},[]);
 React.useEffect(()=>{void loadAll();},[loadAll]);

 // Files still being read: poll until the parser finishes, then open the review sheet.
 React.useEffect(()=>{
  if(!files.some(file=>['queued','running'].includes(file.parsing?.state??'')))return;
  const timer=setInterval(()=>{void loadFiles().catch(()=>undefined);},3000);
  return()=>clearInterval(timer);
 },[files,loadFiles]);
 React.useEffect(()=>{
  if(!status||status.ready||!['updating','stale'].includes(status.status))return;
  const timer=setInterval(()=>{void loadStatus();},5000);
  return()=>clearInterval(timer);
 },[status,loadStatus]);
 React.useEffect(()=>{
  if(!pendingDoc)return;
  const file=files.find(f=>f.id===pendingDoc);
  if(!file)return;
  if(['succeeded','partial'].includes(file.parsing?.state??'')){setPendingDoc('');void openCollect(file);}
 },[pendingDoc,files]);

 const pending=entries.filter(entry=>!entry.archived&&entry.approvedVersion===0);
 const published=entries.filter(entry=>!entry.archived&&entry.approvedVersion>0);
 const disabled=entries.filter(entry=>entry.archived);

 async function upload(list:File[]){
  if(!list.length||busy)return;
  setBusy(true);setError('');setNotice('');
  const problem=validateKnowledgeFiles(list);if(problem){setError(problem);setBusy(false);return;}
  setUploading(list.map(file=>({name:file.name,status:'等待上传'})));
  const mark=(index:number,text:string)=>setUploading(rows=>rows.map((row,i)=>i===index?{...row,status:text}:row));
  let first='';
  for(let index=0;index<list.length;index++){
   try{
    mark(index,'正在上传');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('文件读取失败'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(list[index]);});
    const result=await apiPost<{id:string;duplicate:boolean;count?:number}>('/knowledge-documents',{fileName:list[index].name,data});
    mark(index,result.duplicate?'这个文件之前上传过':(result.count??0)>1?`文件较长，已自动拆成 ${result.count} 份，分别读取中`:'已上传，正在读取内容');
    if(!first)first=result.id;
   }catch(e){mark(index,toErrorMessage(e,'上传失败'));}
  }
  await loadFiles().catch(()=>undefined);
  setBusy(false);
  if(first)setPendingDoc(first);
  if(fileInput.current)fileInput.current.value='';
 }

 async function openCollect(file:Source){
  const readonly=!!file.reviewState&&file.reviewState!=='unreviewed';
  setUploading([]);
  setCollect({file,title:'',category:'reference',source:'',expanded:readonly,loading:true,readonly});
  try{
   const preview=await apiGet<Preview>('/knowledge-documents/'+file.id+'/collection');
   setCollect({file,preview,title:preview.title,category:preview.category,source:preview.source,expanded:readonly,loading:false,readonly});
  }catch(e){setCollect(null);setError(toErrorMessage(e,'暂时无法读取文件内容'));}
 }

 async function submitCollect(publish:boolean){
  if(!collect)return;
  setBusy(true);setError('');
  try{
   const result=await apiPost<{ids:string[];count:number}>('/knowledge-documents/'+collect.file.id+'/collection',{title:collect.title.trim(),category:collect.category,source:collect.source.trim()||undefined,publish});
   setCollect(null);setOpenEntry(result.ids[0]??'');
   setNotice(publish?'已发布 '+result.count+' 篇资料，助手可以立即使用。':'已存为草稿，确认后再发布。');
   setTab(publish?'published':'pending');
   await Promise.all([loadEntries(),loadFiles()]);
   window.setTimeout(()=>void loadStatus(),1500);
  }catch(e){setError(toErrorMessage(e,'收录失败，请稍后重试'));}finally{setBusy(false);}
 }

 async function publishEntry(entry:ProjectKnowledge){
  const version=entry.revisions.at(-1);if(!version)return;
  setBusy(true);setError('');
  try{
   await apiPost('/agent/knowledge/'+entry.id+'/revisions',{accessScope:version.accessScope??'project',expectedVersion:entry.version,title:version.title,category:version.category??'reference',content:version.content,source:version.source,approved:true,
    tags:version.tags??[],products:version.products??[],applicability:version.applicability??'',validFrom:version.validFrom??new Date().toISOString(),...(version.validUntil?{validUntil:version.validUntil}:{}),terms:version.terms??[]});
   setNotice('已发布：'+version.title+'。助手可以立即使用。');
   await loadEntries();window.setTimeout(()=>void loadStatus(),1500);
  }catch(e){setError(toErrorMessage(e,'发布失败，请检查内容与生效时间'));}finally{setBusy(false);}
 }

 async function stopEntry(entry:ProjectKnowledge){
  setBusy(true);setError('');
  try{await apiPost('/agent/knowledge/'+entry.id+'/archive',{version:entry.version});setNotice('已停用：'+entry.revisions.at(-1)?.title);await loadEntries();window.setTimeout(()=>void loadStatus(),1500);}
  catch(e){setError(toErrorMessage(e,'停用失败'));}finally{setBusy(false);}
 }

 async function removeConfirmed(){
  if(!confirm)return;
  setBusy(true);setError('');
  try{
   if(confirm.kind==='file'){
    await apiDelete('/knowledge-documents/'+confirm.id);
    setNotice('已删除文件：'+confirm.name);
    await Promise.all([loadFiles(),loadEntries()]);
   }else{
    await apiDelete('/agent/knowledge/'+confirm.id);
    setNotice('已删除：'+confirm.name);
    await loadEntries();
   }
   setConfirm(null);
   window.setTimeout(()=>void loadStatus(),1500);
  }catch(e){setError(toErrorMessage(e,'删除失败'));}finally{setBusy(false);}
 }

 async function retryParse(file:Source){  if(!file.parsing)return;setBusy(true);setError('');
  try{await apiPost('/knowledge-documents/parsing/'+file.parsing.id+'/retry',{});await loadFiles();}
  catch(e){setError(toErrorMessage(e,'重新读取失败'));}finally{setBusy(false);}
 }

 async function rebuild(){
  setBusy(true);setError('');
  try{await apiPost('/knowledge-index/rebuild',{requestKey:crypto.randomUUID()});setNotice('正在整理资料，通常几秒就好。');await loadStatus();}
  catch(e){setError(toErrorMessage(e,'整理失败，请稍后再试'));}finally{setBusy(false);}
 }

 if(editing!==null)return <div className="p-4 sm:p-6 lg:p-7"><KnowledgeEntryForm key={editing==='new'?'new':editing.id} entry={editing==='new'?null:editing}
   onCancel={()=>setEditing(null)} onSaved={()=>{setEditing(null);setNotice('资料已保存。');void loadEntries();window.setTimeout(()=>void loadStatus(),1500);}}/></div>;

 const indexLabel=status?status.ready?'已就绪 · '+status.effectivePublications+' 篇':status.status==='updating'?'正在更新…':status.effectivePublications?'需要更新':'暂无资料':'—';
 const collectNotes=collect?.preview?fileNotes(collect.preview.notes):[];
 const tabs:[string,string,number][]=[['pending','待确认',pending.length],['published','已发布',published.length],['files','原始文件',files.length]];
 return <div className="p-4 sm:p-6 lg:p-7">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div><h1 className="text-xl font-semibold tracking-tight">资料管理</h1><p className="mt-1 text-sm leading-6 text-muted-foreground">上传文件，看一眼，发布给助手用。一个文件是一篇资料，不用逐段审。</p></div>
   <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy} onClick={()=>fileInput.current?.click()}><Upload className="h-4 w-4" aria-hidden/>{busy?'处理中…':'上传文件'}</Button><Button variant="outline" className="min-h-11" onClick={()=>setEditing('new')}><Plus className="h-4 w-4" aria-hidden/>手动新增</Button></div>
  </header>
  <input ref={fileInput} type="file" multiple className="sr-only" aria-label="选择要上传的资料" accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg" disabled={busy} onChange={e=>void upload(Array.from(e.target.files??[]))}/>

  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
   <div className="rounded-lg border px-3 py-2"><p className="text-xs text-muted-foreground">待确认</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{pending.length}</p></div>
   <div className="rounded-lg border px-3 py-2"><p className="text-xs text-muted-foreground">已发布</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{published.length}</p></div>
   <div className="rounded-lg border px-3 py-2"><p className="text-xs text-muted-foreground">原始文件</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{files.length}</p></div>
   <div className="rounded-lg border px-3 py-2"><p className="text-xs text-muted-foreground">AI 能搜到</p><p className="mt-0.5 flex items-center gap-1 text-sm font-semibold">{status?.ready?<CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden/>:status&&status.status!=='updating'?<AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden/>:null}<span className="truncate">{indexLabel}</span></p></div>
  </div>

  {error&&<div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{error}<Button variant="ghost" className="ml-2 min-h-11 px-2" onClick={()=>void loadAll()}>重新加载</Button></div>}
  {notice&&<p role="status" className="mt-4 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm leading-6">{notice}</p>}

  {uploading.length>0&&<ul className="mt-4 divide-y rounded-lg border px-3 text-sm" aria-live="polite">{uploading.map((row,i)=><li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span className="break-all">{row.name}</span><span className="text-muted-foreground">{row.status}</span></li>)}</ul>}

  <div className="mt-5 flex flex-wrap items-center gap-1 border-b pb-2" role="tablist" aria-label="资料视图">
   {tabs.map(([id,label,count])=><button key={id} type="button" role="tab" aria-selected={tab===id} className={'min-h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '+(tab===id?'bg-primary/10 text-primary':'text-muted-foreground hover:bg-muted hover:text-foreground')} onClick={()=>setTab(id as 'pending'|'published'|'files')}>{label}<span className="ml-1.5 text-xs tabular-nums">{count}</span></button>)}
   <span className="ml-auto hidden text-xs text-muted-foreground sm:block">发布后助手才能使用</span>
  </div>

  {loading?<p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden/>正在读取资料…</p>:tab==='pending'?<section aria-label="待确认资料" className="divide-y">
   {!pending.length?<p className="py-10 text-sm leading-6 text-muted-foreground">没有待确认的资料。上传文件后，看一眼就能发布。</p>:pending.map(entry=>{const version=entry.revisions.at(-1)!;const open=openEntry===entry.id;return <article key={entry.id} className="py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
     <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setOpenEntry(open?'':entry.id)}>
      <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold leading-6">{version.title}</span><Badge variant="outline">待确认</Badge></span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{knowledgeCategories[version.category??'reference']} · 来源：{version.source} · {new Date(entry.updatedAt).toLocaleDateString()}</span>
     </button>
     <div className="flex flex-wrap gap-1">
      <Button variant="ghost" className="min-h-11" onClick={()=>setOpenEntry(open?'':entry.id)}><Eye className="h-4 w-4" aria-hidden/>{open?'收起':'看全文'}</Button>
      <Button variant="ghost" className="min-h-11" onClick={()=>setEditing(entry)}><Pencil className="h-4 w-4" aria-hidden/>编辑</Button>
      <Button className="min-h-11" disabled={busy} onClick={()=>void publishEntry(entry)}>发布给助手</Button>
      <Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy} onClick={()=>setConfirm({kind:'entry',id:entry.id,name:version.title})}><Trash2 className="h-4 w-4" aria-hidden/>删除</Button>
     </div>
    </div>
    {open&&<div className="mt-3 max-h-[28rem] overflow-y-auto rounded-lg bg-muted/30 p-4"><AgentMessageContent content={version.content}/></div>}
   </article>;})}
  </section>:tab==='published'?<section aria-label="已发布资料" className="divide-y">
   {!published.length?<p className="py-10 text-sm leading-6 text-muted-foreground">还没有已发布的资料，助手现在用不到任何资料。</p>:published.map(entry=>{const version=entry.revisions.at(-1)!;const open=openEntry===entry.id;return <article key={entry.id} className="py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
     <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setOpenEntry(open?'':entry.id)}>
      <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold leading-6">{version.title}</span><Badge variant={entry.effective?'developed':'muted'}>{entry.effective?'已发布':'已发布 · 当前不可用'}</Badge>{entry.hasDraft&&<Badge variant="outline">有未发布修改</Badge>}</span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{knowledgeCategories[version.category??'reference']} · 来源：{version.source} · 第 {entry.approvedVersion} 版</span>
     </button>
     <div className="flex flex-wrap gap-1">
      <Button variant="ghost" className="min-h-11" onClick={()=>setOpenEntry(open?'':entry.id)}><Eye className="h-4 w-4" aria-hidden/>{open?'收起':'看全文'}</Button>
      <Button variant="ghost" className="min-h-11" onClick={()=>setEditing(entry)}><Pencil className="h-4 w-4" aria-hidden/>编辑</Button>
      <Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy} onClick={()=>void stopEntry(entry)}><Power className="h-4 w-4" aria-hidden/>停用</Button>
      <Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy} onClick={()=>setConfirm({kind:'entry',id:entry.id,name:version.title})}><Trash2 className="h-4 w-4" aria-hidden/>删除</Button>
     </div>
    </div>
    {open&&<div className="mt-3 max-h-[28rem] overflow-y-auto rounded-lg bg-muted/30 p-4"><AgentMessageContent content={version.content}/></div>}
   </article>;})}
   {disabled.length>0&&<details className="py-3 text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">已停用（{disabled.length}）</summary><ul className="space-y-2 py-2">{disabled.map(entry=><li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground"><span className="break-words">{entry.revisions.at(-1)?.title}</span><span className="flex items-center gap-2"><span className="text-xs">助手不再使用</span><Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy} onClick={()=>setConfirm({kind:'entry',id:entry.id,name:entry.revisions.at(-1)?.title??'这篇资料'})}><Trash2 className="h-4 w-4" aria-hidden/>删除</Button></span></li>)}</ul></details>}
  </section>:<section aria-label="原始文件" className="divide-y">
   {!files.length?<p className="py-10 text-sm leading-6 text-muted-foreground">还没有上传文件。支持 TXT、Markdown、PDF、Word、Excel、CSV 和图片；每次最多 10 份，每份 15MB。</p>:files.map(file=>{const state=file.parsing?.state??'';const collected=!!file.reviewState&&file.reviewState!=='unreviewed';const notes=fileNotes(file.parsing?.warnings);const status=state==='failed'?'读取失败':state==='cancelled'?'已取消':!state?'等待处理':['queued','running'].includes(state)?(parsingLabels[state]??'读取中'):notes.length?'读取完成 · '+notes.length+' 条提示':'读取完成';return <article key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
    <div className="flex min-w-0 flex-1 items-start gap-3"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden/>
     <div className="min-w-0"><p className="break-words text-sm font-medium">{file.originalName}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{fileSize(file.bytes)} · {new Date(file.createdAt).toLocaleDateString()} · {status}{collected?' · 已收录':''}</p>
      {state==='failed'&&file.parsing?.error?.message&&<p className="mt-1 text-xs leading-5 text-destructive">{file.parsing.error.message}</p>}
      {notes.length>0&&<details className="mt-1 text-xs leading-5"><summary className={'min-h-6 cursor-pointer '+(notes.some(seriousNote)?'text-amber-700 dark:text-amber-400':'text-muted-foreground')}>查看 {notes.length} 条提示</summary><ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{notes.map((note,index)=><li key={index}>{note}</li>)}</ul></details>}
     </div>
    </div>
    <div className="flex flex-wrap gap-1">
     {['succeeded','partial'].includes(state)&&<Button className="min-h-11" disabled={busy} onClick={()=>void openCollect(file)}>{collected?'看原文':'整理成资料'}</Button>}
     {state==='failed'&&file.parsing&&<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void retryParse(file)}><RefreshCw className="h-4 w-4" aria-hidden/>重新读取</Button>}
     {['queued','running'].includes(state)&&<span className="flex items-center gap-2 px-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden/>读取中…</span>}
     <Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy} onClick={()=>setConfirm({kind:'file',id:file.id,name:file.originalName})}><Trash2 className="h-4 w-4" aria-hidden/>删除</Button>
    </div>
   </article>;})}
  </section>}

  {status&&!status.ready&&!!status.effectivePublications&&<div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><p className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden/>{status.status==='updating'?'正在为助手准备检索，发布后会立即生效。':status.status==='stale'?'助手还在用上一次的资料，最新发布尚未生效。':'助手还没有可用的检索，更新后即可使用。'}</p>{status.status!=='updating'&&<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void rebuild()}>立即更新</Button>}</div>}

  <details className="mt-6 border-t pt-3 text-sm"><summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2 text-muted-foreground"><ChevronDown className="h-4 w-4" aria-hidden/>技术信息（一般不用看）</summary>
   <div className="space-y-2 py-2 text-xs leading-6 text-muted-foreground"><p>当前状态：{status?.status??'—'} · 可用资料 {status?.effectivePublications??0} 篇{status?.storageIssue?' · '+status.storageIssue:''}</p><p>发布、修订、停用后会自动更新检索；失败时可以在这里手动重试。</p><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void rebuild()}>重建检索</Button></div>
  </details>

  {collect&&<Dialog open onOpenChange={open=>{if(!open&&!busy)setCollect(null);}}><DialogContent className="max-w-2xl">
   <DialogHeader><DialogTitle>{collect.readonly?'原文：'+collect.file.originalName:'把「'+collect.file.originalName+'」收成资料'}</DialogTitle><DialogDescription>{collect.readonly?'这份文件已经收录，下面是系统读到的全文。':'助手会读整篇内容。你只需要看一眼标题和内容，确认没有不该给客户看的东西。'}</DialogDescription></DialogHeader>
   <DialogBody className="space-y-4">
    {collect.loading?<p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden/>正在整理全文…</p>:collect.preview&&<>
     {!collect.readonly&&<><div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-sm"><span className="block font-medium">标题</span><Input className="min-h-11" value={collect.title} maxLength={160} onChange={e=>setCollect({...collect,title:e.target.value})}/></label>
      <label className="space-y-1.5 text-sm"><span className="block font-medium">分类</span><select className={nativeSelect} value={collect.category} onChange={e=>setCollect({...collect,category:e.target.value as KnowledgeCategory})}>{Object.entries(knowledgeCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     </div>
     <label className="space-y-1.5 text-sm"><span className="block font-medium">来源</span><Input className="min-h-11" value={collect.source} maxLength={500} onChange={e=>setCollect({...collect,source:e.target.value})}/></label></>}
     <div className="overflow-hidden rounded-lg border bg-background">
       {collectNotes.length>0&&<div className="border-b bg-muted/20 px-4 py-2 text-xs leading-5"><p className="font-medium text-foreground">收录前留意</p><ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{collectNotes.map((note,index)=><li key={index}>{note}</li>)}</ul></div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground"><span>全文 {collect.preview.parts.reduce((sum,part)=>sum+part.chars,0).toLocaleString()} 字{collect.preview.parts.length>1?' · 会分成 '+collect.preview.parts.length+' 篇':''}</span><button type="button" className="min-h-11 px-2 font-medium text-primary underline-offset-4 hover:underline" onClick={()=>setCollect({...collect,expanded:!collect.expanded})}>{collect.expanded?'收起':'展开全文'}</button></div>
      <div className={'overflow-y-auto px-4 py-3 '+(collect.expanded?'max-h-[46vh]':'max-h-44')}>
       {collect.preview.parts.map((part,index)=><React.Fragment key={index}>
        {index>0&&<div className="my-5 flex items-center gap-3 text-xs text-muted-foreground" role="separator"><span className="h-px flex-1 bg-border"/><span className="shrink-0">第 {index+1} 篇从这里开始</span><span className="h-px flex-1 bg-border"/></div>}
        <AgentMessageContent content={part.content}/>
       </React.Fragment>)}
      </div>
     </div>
     {!collect.readonly&&<p className="text-xs leading-6 text-muted-foreground">含报价、交期、认证等要对外承诺的内容，请另建“交易政策”并填写条件；这份资料只当作背景参考。</p>}    </>}
   </DialogBody>
   {collect.readonly?<DialogFooter><Button className="min-h-11" onClick={()=>setCollect(null)}>关闭</Button></DialogFooter>:<DialogFooter><Button variant="ghost" className="min-h-11" disabled={busy} onClick={()=>setCollect(null)}>取消</Button><Button variant="outline" className="min-h-11" disabled={busy||collect.loading||!collect.title.trim()} onClick={()=>void submitCollect(false)}>只存草稿</Button><Button className="min-h-11" disabled={busy||collect.loading||!collect.title.trim()} onClick={()=>void submitCollect(true)}>收录，助手可用</Button></DialogFooter>}
  </DialogContent></Dialog>}
  <ConfirmDialog open={!!confirm} onOpenChange={open=>{if(!open&&!busy)setConfirm(null);}} variant="destructive" loading={busy}
   title={confirm?.kind==='file'?'删除这份文件？':'删除这篇资料？'} description="删除后无法恢复，助手会立即停止使用。"
   confirmText="删除" cancelText="取消" onConfirm={removeConfirmed}>
   <p className="break-words font-medium text-foreground">{confirm?.name}</p>
   <p className="mt-1 leading-5">{confirm?.kind==='file'?'文件、解析记录，以及从这份文件收录的资料都会删除。':'这篇资料的全部版本都会从资料库和助手中删除。'}</p>
  </ConfirmDialog>
 </div>;
}
