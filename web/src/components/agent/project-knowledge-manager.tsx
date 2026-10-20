import {useNavigate} from 'react-router-dom';
import {KnowledgeGovernance,KnowledgeVersionDiff} from './knowledge-governance';
import * as React from 'react';
import {BookOpen,Plus,Upload,Loader2} from 'lucide-react';
import {apiGet,apiPost,toErrorMessage,ApiClientError} from '@/lib/api';
import {useProjectStore} from '@/store/project.store';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {AgentMessageContent} from './agent-message-content';
import {KnowledgeEntryForm} from './knowledge-entry-form';
import {knowledgeCategories,policyTopics,type ProjectKnowledge,type KnowledgeRevision} from '@/types/knowledge';

const knowledgeError=(error:unknown,fallback?:string)=>error instanceof ApiClientError&&error.details.length?error.details.slice(0,5).map(detail=>detail.message).join('；'):toErrorMessage(error,fallback);
const nativeSelect='min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ProjectKnowledgeManager({admin,customerId,initialKnowledgeId}:{admin:boolean;customerId?:string;initialKnowledgeId?:string}){
 const navigate=useNavigate();
 const openedKnowledge=React.useRef('');
 const project=useProjectStore(s=>s.activeProject);
 const [rows,setRows]=React.useState<ProjectKnowledge[]>([]);
 const [loading,setLoading]=React.useState(true);const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState('');
 const [product,setProduct]=React.useState('');const [validity,setValidity]=React.useState('all');
 const [query,setQuery]=React.useState('');const [category,setCategory]=React.useState('all');const [status,setStatus]=React.useState('all');
 const [editing,setEditing]=React.useState<ProjectKnowledge|null>(null);const [formOpen,setFormOpen]=React.useState(false);
 const [selected,setSelected]=React.useState<ProjectKnowledge|null>(null);const [history,setHistory]=React.useState<KnowledgeRevision[]>([]);
 const [attachments,setAttachments]=React.useState<{id:string;originalName:string}[]>([]);
 const [attachmentText,setAttachmentText]=React.useState<{name:string;text:string;reason?:string}|null>(null);
 const load=React.useCallback(async()=>{setLoading(true);try{setRows(await apiGet<ProjectKnowledge[]>('/agent/knowledge'));}finally{setLoading(false);}},[]);
 React.useEffect(()=>{void load().catch(e=>setError(knowledgeError(e)));},[load]);
 React.useEffect(()=>{setAttachments([]);setAttachmentText(null);if(customerId)void apiGet<typeof attachments>('/customers/'+customerId+'/attachments').then(setAttachments).catch(e=>setError(knowledgeError(e)));},[customerId]);
 React.useEffect(()=>{if(initialKnowledgeId&&openedKnowledge.current!==initialKnowledgeId){const row=rows.find(r=>r.id===initialKnowledgeId);if(row){openedKnowledge.current=initialKnowledgeId;if(admin)edit(row);else setSelected(row);}}},[initialKnowledgeId,rows,admin]);
 React.useEffect(()=>{if(selected)document.getElementById('knowledge-row-'+selected.id)?.scrollIntoView({block:'nearest'});},[selected]);
 function edit(row?:ProjectKnowledge){setEditing(row??null);setSelected(null);setFormOpen(true);}
 const matches=rows.filter(row=>{const v=row.revisions.at(-1);return v&&(!product||(v.products??[]).some(p=>p.toLowerCase().includes(product.toLowerCase())))&&(validity==='all'||(validity==='active'?row.effective:validity==='expired'?!!v.validUntil&&new Date(v.validUntil)<=new Date():validity==='upcoming'?!!v.validFrom&&new Date(v.validFrom)>new Date():!!v.validUntil&&new Date(v.validUntil)>new Date()&&new Date(v.validUntil)<=new Date(Date.now()+30*86400000)))&&(category==='all'||(v.category??'product')===category)&&(status==='all'||row.status===status)&&[v.title,v.content,v.tags.join(' ')].join(' ').toLowerCase().includes(query.toLowerCase());});
 return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
  <header className="mb-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-semibold"><BookOpen className="h-5 w-5" aria-hidden/>资料审核与维护</h2>{admin&&!formOpen&&<div className="flex flex-wrap gap-2"><Button className="min-h-11" onClick={()=>edit()}><Plus className="h-4 w-4" aria-hidden/>新增资料</Button><Button variant="outline" className="min-h-11" onClick={()=>navigate('/knowledge?view=manage')}><Upload className="h-4 w-4" aria-hidden/>上传文件</Button></div>}</div>
   <p className="text-sm leading-6 text-muted-foreground">{project?.name} 的资料维护区。先核对内容，再发布；发布后才会出现在销售资料中。</p>
  </header>
  {error&&<p role="alert" className="my-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{error}</p>}
  {formOpen&&admin?<KnowledgeEntryForm key={editing?.id??'new'} entry={editing} onCancel={()=>setFormOpen(false)} onSaved={()=>{setFormOpen(false);setEditing(null);void load().catch(e=>setError(knowledgeError(e)));}}/>:<>
   {admin&&<details className="mb-5 rounded-lg border px-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">到期提醒、版本冲突与批量停用</summary><KnowledgeGovernance rows={rows} onReload={load} onSelect={id=>{setQuery('');setProduct('');setValidity('all');setCategory('all');setStatus('all');setSelected(rows.find(r=>r.id===id)??null);setHistory([]);}}/></details>}
   <div className="mb-4 flex flex-wrap gap-3"><Input className="min-h-11 min-w-0 flex-1 basis-48" aria-label="搜索项目知识" placeholder="搜索标题、关键词或正文" value={query} onChange={e=>setQuery(e.target.value)}/><Input aria-label="筛选适用产品" placeholder="适用产品" className="min-h-11 min-w-0 flex-1 basis-40" value={product} onChange={e=>setProduct(e.target.value)}/><select aria-label="筛选有效期" className={nativeSelect+' sm:w-auto'} value={validity} onChange={e=>setValidity(e.target.value)}><option value="all">全部有效期</option><option value="active">当前有效</option><option value="expiring">30天内到期</option><option value="expired">已过期</option><option value="upcoming">尚未生效</option></select><select aria-label="筛选知识分类" className={nativeSelect+' sm:w-auto'} value={category} onChange={e=>setCategory(e.target.value)}><option value="all">全部分类</option>{Object.entries(knowledgeCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{admin&&<select aria-label="筛选发布状态" className={nativeSelect+' sm:w-auto'} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="disabled">已停用</option></select>}</div>
   {loading&&<p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>正在读取项目知识…</p>}
   {!loading&&!matches.length&&<p className="py-6 text-sm leading-6 text-muted-foreground">{rows.length?'没有匹配的知识，请调整筛选。':'尚无可用知识。管理员可以录入资料并审核发布；知识不足时助手会标明待确认内容。'}</p>}
   <div className="divide-y">{matches.map(row=>{const v=row.revisions.at(-1)!;return <section key={row.id} id={'knowledge-row-'+row.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><button type="button" className="min-h-11 min-w-0 flex-1 text-left text-sm font-semibold leading-6 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>{setSelected(selected?.id===row.id?null:row);setHistory([]);}}>{v.title}</button><Badge variant={row.archived?'muted':row.effective?'developed':'outline'}>{row.archived?'已停用':row.approvedVersion?'已发布 v'+row.approvedVersion+(row.effective?'':' · 当前不可用'):'草稿'}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{knowledgeCategories[v.category??'product']} · {new Date(row.updatedAt).toLocaleString()}{row.hasDraft&&row.approvedVersion?' · 另有未发布修改':''}</p><p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{v.applicability||'历史资料缺少适用条件，需审核'}</p>
    {selected?.id===row.id&&<div className="mt-4 space-y-4 rounded-lg bg-muted/30 p-4">{row.hasDraft&&row.approvedVersion>0&&<p className="text-sm leading-6 text-amber-700 dark:text-amber-400">当前展开的是未发布修改。助手继续使用已发布的第 {row.approvedVersion} 版。</p>}<AgentMessageContent content={v.content}/><dl className="space-y-2 text-xs leading-5 text-muted-foreground"><div><dt className="font-medium">来源</dt><dd className="break-words">{v.source}</dd></div><div><dt className="font-medium">适用产品 / 生效范围</dt><dd>{v.products?.join('、')||'项目通用'} · {v.validFrom?new Date(v.validFrom).toLocaleString():'未核对'} 至 {v.validUntil?new Date(v.validUntil).toLocaleString():'未设置失效时间'}</dd></div></dl>
     {(v.terms??[]).map((term,i)=><p key={i} className="text-sm leading-6"><strong>{policyTopics[term.topic]}：</strong>{term.value} {term.unit} {term.currency} · {term.mode==='confirmed'?'已确认':term.mode==='reference'?'仅参考':'待确认'}<span className="block text-muted-foreground">条件：{term.conditions}</span></p>)}
     <Button variant="ghost" className="min-h-11" onClick={()=>{void apiGet<{revisions:KnowledgeRevision[]}>('/agent/knowledge/'+row.id).then(result=>setHistory(result.revisions)).catch(e=>setError(knowledgeError(e)));}}>查看历史版本</Button>
     {admin&&history.length>0&&<KnowledgeVersionDiff key={row.id} id={row.id} versions={history.map(v=>v.version)}/>}
     {history.length>0&&<ol className="space-y-3 border-l pl-3">{history.map(revision=><li key={revision.version} className="text-xs leading-5">第 {revision.version} 版 · {revision.approved?'已审核发布':'草稿'}<p className="mt-1 whitespace-pre-wrap text-muted-foreground">{revision.content}</p></li>)}</ol>}
    </div>}
    {admin&&!row.archived&&<div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" onClick={()=>edit(row)}>编辑资料</Button><Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy} onClick={()=>{setBusy(true);void apiPost('/agent/knowledge/'+row.id+'/archive',{version:row.version}).then(load).catch(e=>setError(knowledgeError(e))).finally(()=>setBusy(false));}}>停用</Button></div>}
   </section>;})}</div>
  </>}
  {customerId&&!formOpen&&<section className="mt-5 border-t pt-4"><h3 className="text-sm font-semibold">当前客户附件</h3><p className="my-2 text-xs leading-5 text-muted-foreground">支持 5MB 内的文字 PDF、Word、TXT。附件是客户资料，不等于已确认的我方交易政策。</p>{attachments.map(a=><div key={a.id} className="flex items-center justify-between gap-3 border-b py-3"><span className="min-w-0 break-words text-sm">{a.originalName}</span><Button variant="outline" className="min-h-11 shrink-0" disabled={busy} onClick={()=>{setBusy(true);void apiGet<NonNullable<typeof attachmentText>>('/agent/customers/'+customerId+'/attachments/'+a.id+'/text').then(setAttachmentText).catch(e=>setError(knowledgeError(e))).finally(()=>setBusy(false));}}>读取正文</Button></div>)}{!attachments.length&&<p className="py-3 text-sm text-muted-foreground">该客户暂无附件。</p>}{attachmentText&&<div className="mt-3"><p className="text-sm font-medium">{attachmentText.name}</p><p className="mt-2 text-xs text-muted-foreground">{attachmentText.reason}</p><pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-6">{attachmentText.text||'暂时没有可读取的文字'}</pre></div>}</section>}
 </div>;
}
