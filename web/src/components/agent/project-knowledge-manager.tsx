import {ConditionalScopeEditor} from './conditional-scope-editor';
import * as React from 'react';
import {BookOpen,Plus,Upload,ArrowLeft,Loader2} from 'lucide-react';
import {apiGet,apiPost,toErrorMessage,ApiClientError} from '@/lib/api';
import {useProjectStore} from '@/store/project.store';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {Badge} from '@/components/ui/badge';
import {AgentMessageContent} from './agent-message-content';
import {knowledgeCategories,policyTopics,type KnowledgeCategory,type KnowledgeTerm,type ProjectKnowledge,type KnowledgeRevision} from '@/types/knowledge';

const localDate=(value?:string)=>{const d=value?new Date(value):new Date();return Number.isNaN(d.getTime())?'':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const knowledgeError=(error:unknown,fallback?:string)=>error instanceof ApiClientError&&error.details.length?error.details.slice(0,5).map(detail=>detail.message).join('；'):toErrorMessage(error,fallback);
const newForm=()=>({accessScope:'project' as 'project'|'admins',title:'',category:'company' as KnowledgeCategory,tags:'',content:'',source:'',applicability:'',products:'',validFrom:localDate(),validUntil:'',terms:[] as KnowledgeTerm[]});
const nativeSelect='min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export function ProjectKnowledgeManager({admin,customerId,initialKnowledgeId}:{admin:boolean;customerId?:string;initialKnowledgeId?:string}){
 const openedKnowledge=React.useRef('');
 const project=useProjectStore(s=>s.activeProject);
 const [rows,setRows]=React.useState<ProjectKnowledge[]>([]);
 const [loading,setLoading]=React.useState(true);const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState('');
 const [query,setQuery]=React.useState('');const [category,setCategory]=React.useState('all');const [status,setStatus]=React.useState('all');
 const [form,setForm]=React.useState(newForm);const [editing,setEditing]=React.useState<ProjectKnowledge|null>(null);const [formOpen,setFormOpen]=React.useState(false);
 const [selected,setSelected]=React.useState<ProjectKnowledge|null>(null);const [history,setHistory]=React.useState<KnowledgeRevision[]>([]);
 const [importOpen,setImportOpen]=React.useState(false);const [importSource,setImportSource]=React.useState('');const [importCategory,setImportCategory]=React.useState<KnowledgeCategory>('company');
 const [preview,setPreview]=React.useState<{entries:Record<string,unknown>[];warnings:string[]}|null>(null);
 const [fileName,setFileName]=React.useState('');const [importResult,setImportResult]=React.useState('');const fileRef=React.useRef<HTMLInputElement>(null);
 const [attachments,setAttachments]=React.useState<{id:string;originalName:string}[]>([]);
 const [attachmentText,setAttachmentText]=React.useState<{name:string;text:string;reason?:string}|null>(null);
 const load=React.useCallback(async()=>{setLoading(true);try{setRows(await apiGet<ProjectKnowledge[]>('/agent/knowledge'));}finally{setLoading(false);}},[]);
 React.useEffect(()=>{void load().catch(e=>setError(knowledgeError(e)));},[load]);
 React.useEffect(()=>{setAttachments([]);setAttachmentText(null);if(customerId)void apiGet<typeof attachments>('/customers/'+customerId+'/attachments').then(setAttachments).catch(e=>setError(knowledgeError(e)));},[customerId]);
 React.useEffect(()=>{if(initialKnowledgeId&&openedKnowledge.current!==initialKnowledgeId){const row=rows.find(r=>r.id===initialKnowledgeId);if(row){openedKnowledge.current=initialKnowledgeId;if(admin)edit(row);else setSelected(row);}}},[initialKnowledgeId,rows,admin]);
 function edit(row?:ProjectKnowledge){const v=row?.revisions.at(-1);setEditing(row??null);setSelected(null);setForm(v?{accessScope:v.accessScope??'project',title:v.title,category:v.category??'product',tags:v.tags.join(', '),content:v.content,source:v.source,applicability:v.applicability??'',products:(v.products??[]).join(', '),validFrom:localDate(v.validFrom),validUntil:v.validUntil?localDate(v.validUntil):'',terms:v.terms??[]}:newForm());setFormOpen(true);}
 function patchTerm(index:number,patch:Partial<KnowledgeTerm>){setForm(f=>({...f,terms:f.terms.map((term,i)=>i===index?{...term,...patch,...(!patch.scope&&term.scope?{scope:{...term.scope,reviewed:false}}:{})}:term)}));}
 async function save(approved:boolean){
  setBusy(true);setError('');
  try{await apiPost('/agent/knowledge'+(editing?'/'+editing.id+'/revisions':''),{accessScope:form.accessScope,expectedVersion:editing?.version??0,title:form.title,category:form.category,content:form.content,source:form.source,approved,
    tags:form.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean),products:form.products.split(/[,，]/).map(s=>s.trim()).filter(Boolean),applicability:form.applicability,
    validFrom:new Date(form.validFrom).toISOString(),...(form.validUntil?{validUntil:new Date(form.validUntil).toISOString()}:{}),terms:form.terms});
   setFormOpen(false);setEditing(null);await load();
  }catch(e){setError(knowledgeError(e,'知识尚未保存，请检查字段与版本'));}finally{setBusy(false);}
 }
 async function importPreview(file:File){
  setBusy(true);setError('');setPreview(null);setImportResult('');
  try{if(!/\.(txt|md|markdown)$/i.test(file.name)||file.size>512000)throw new Error('请选择 500KB 内的 TXT 或 Markdown 文件');
   const content=await file.text();if(content.includes('\uFFFD'))throw new Error('资料编码无法识别，请另存为 UTF-8');
   setPreview(await apiPost('/agent/knowledge/import-preview',{fileName:file.name,content,category:importCategory,source:importSource}));setFileName(file.name);
  }catch(e){setError(knowledgeError(e));}finally{setBusy(false);if(fileRef.current)fileRef.current.value='';}
 }
 async function commitImport(){
  if(!preview)return;setBusy(true);setError('');
  try{const result=await apiPost<{created:number;skipped:number}>('/agent/knowledge/import',{entries:preview.entries});setImportResult('已保存 '+result.created+' 条草稿，跳过 '+result.skipped+' 条重复资料。请逐条核对后发布。');setPreview(null);await load();}
  catch(e){setError(knowledgeError(e));}finally{setBusy(false);}
 }
 const matches=rows.filter(row=>{const v=row.revisions.at(-1);return v&&(category==='all'||(v.category??'product')===category)&&(status==='all'||row.status===status)&&[v.title,v.content,v.tags.join(' ')].join(' ').toLowerCase().includes(query.toLowerCase());});
 const inputField=(id:string,label:string,value:string,onChange:(v:string)=>void,type='text')=><div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={e=>onChange(e.target.value)} className="min-h-11"/></div>;
 return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
  <header className="mb-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-semibold"><BookOpen className="h-5 w-5" aria-hidden/>项目知识库</h2>{admin&&!formOpen&&<div className="flex flex-wrap gap-2"><Button className="min-h-11" onClick={()=>edit()}><Plus className="h-4 w-4" aria-hidden/>新增知识</Button><Button variant="outline" className="min-h-11" onClick={()=>{setImportOpen(v=>!v);setSelected(null);}}><Upload className="h-4 w-4" aria-hidden/>导入文本</Button></div>}</div>
   <p className="text-sm leading-6 text-muted-foreground">{project?.name} 的公司、产品和交易依据。助手仅检索当前有效的已发布版本；模板中的示例不作为交易政策。</p>
  </header>
  {error&&<p role="alert" className="my-4 rounded-lg border border-destructive/30 p-3 text-sm leading-6 text-destructive">{error}</p>}
  {importOpen&&admin&&!formOpen&&<section className="mb-6 space-y-4 rounded-lg border p-4">
   <h3 className="font-semibold">TXT / Markdown 导入</h3><p className="text-sm leading-6 text-muted-foreground">选择分类和来源，预览按标题拆分的条目，再保存为草稿。不会自动发布。</p>
   <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm"><span className="block font-medium">导入分类</span><select className={nativeSelect} value={importCategory} onChange={e=>{setImportCategory(e.target.value as KnowledgeCategory);setPreview(null);}}>{Object.entries(knowledgeCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   {inputField('knowledge-import-source','资料来源',importSource,v=>{setImportSource(v);setPreview(null);})}</div>
   <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="sr-only" aria-label="选择知识文件" onChange={e=>{const file=e.target.files?.[0];if(file)void importPreview(file);}}/>
   <Button variant="outline" className="min-h-11" disabled={busy||!importSource.trim()} onClick={()=>fileRef.current?.click()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Upload className="h-4 w-4"/>}选择文本文件并预览</Button>
   {!importSource.trim()&&<p className="text-xs text-muted-foreground">先填写文档名称、内部确认记录或来源地址。</p>}
   {preview&&<div className="space-y-3"><p className="text-sm font-medium">{fileName} · 共 {preview.entries.length} 条</p>{preview.warnings.map(w=><p key={w} className="text-sm leading-6 text-amber-700 dark:text-amber-400">{w}</p>)}<ol className="max-h-64 overflow-y-auto divide-y">{preview.entries.map((entry,i)=><li key={i} className="py-3 text-sm"><p className="font-medium">{String(entry.title)}</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap leading-6 text-muted-foreground">{String(entry.content)}</p></li>)}</ol><Button className="min-h-11" disabled={busy} onClick={()=>void commitImport()}>确认导入为草稿</Button><Button variant="ghost" className="ml-2 min-h-11" onClick={()=>setPreview(null)}>取消预览</Button></div>}
   {importResult&&<p role="status" className="text-sm leading-6">{importResult}</p>}
  </section>}
  {formOpen&&admin?<section className="space-y-5">
   <Button variant="ghost" className="min-h-11 px-0" onClick={()=>setFormOpen(false)}><ArrowLeft className="h-4 w-4"/>返回资料列表</Button>
   {editing?.revisions.at(-1)?.sourceRefs?.map(ref=><a key={ref.chunkId} className="block min-h-11 py-2 text-sm text-primary underline" target="_blank" rel="noreferrer" href={'/knowledge?view=documents&document='+encodeURIComponent(ref.documentId)+'&revision='+encodeURIComponent(ref.parsingRevisionId)}>打开原始资料核对（新标签页）</a>)}
   <h3 className="font-semibold">{editing?'编辑知识 · 新建第 '+(editing.version+1)+' 版':'新增项目知识'}</h3>
   {inputField('knowledge-title','标题',form.title,v=>setForm(f=>({...f,title:v})))}
   <label className="block space-y-2 text-sm"><span className="block font-medium">知识分类</span><select className={nativeSelect} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value as KnowledgeCategory}))}>{Object.entries(knowledgeCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="block space-y-2 text-sm"><span className="block font-medium">使用范围</span><select className={nativeSelect} value={form.accessScope} onChange={e=>setForm(f=>({...f,accessScope:e.target.value as 'project'|'admins'}))}><option value="project">本项目成员</option><option value="admins">仅管理员</option></select><span className="block text-xs text-muted-foreground">范围随审核发布版本生效；销售助手按当前权限读取。</span></label>
   <div className="space-y-2"><Label htmlFor="knowledge-body">正文（事实、说明或经审核回答）</Label><Textarea id="knowledge-body" rows={9} maxLength={12000} value={form.content} onChange={e=>setForm(f=>({...f,content:e.target.value}))}/></div>
   {inputField('knowledge-keywords','关键词（逗号分隔，可含中英文别名）',form.tags,v=>setForm(f=>({...f,tags:v})))}
   {inputField('knowledge-products','适用产品（逗号分隔；留空表示项目通用）',form.products,v=>setForm(f=>({...f,products:v})))}
   {inputField('knowledge-conditions','适用条件与边界',form.applicability,v=>setForm(f=>({...f,applicability:v})))}
   {inputField('knowledge-source','来源或确认依据',form.source,v=>setForm(f=>({...f,source:v})))}
   <div className="grid gap-4 sm:grid-cols-2">{inputField('knowledge-from','生效时间',form.validFrom,v=>setForm(f=>({...f,validFrom:v})),'datetime-local')}{inputField('knowledge-until','失效时间（可选；认证资料必填）',form.validUntil,v=>setForm(f=>({...f,validUntil:v})),'datetime-local')}</div>
   <section className="space-y-4 border-y py-4"><h4 className="font-semibold">条件记录</h4><p className="text-sm leading-6 text-muted-foreground">MOQ、交期、费用、认证等承诺在这里逐项记录。填写适用条件；参考价只能标为参考，未确认信息标为“待确认”。为英文邮件填写清楚的英文值与条件。</p>
    {form.terms.map((term,index)=><fieldset key={index} className="space-y-4 rounded-lg border p-3"><legend className="px-1 text-sm">条件 {index+1}</legend>
     <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm"><span className="block font-medium">内容类型</span><select className={nativeSelect} value={term.topic} onChange={e=>patchTerm(index,{topic:e.target.value as KnowledgeTerm['topic']})}>{Object.entries(policyTopics).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     <label className="space-y-2 text-sm"><span className="block font-medium">确认程度</span><select className={nativeSelect} value={term.mode} onChange={e=>patchTerm(index,{mode:e.target.value as KnowledgeTerm['mode']})}><option value="needs_confirmation">待确认，不对外承诺</option><option value="reference">参考，非正式报价</option><option value="confirmed">已确认，按条件使用</option></select></label></div>
     {inputField('term-value-'+index,'值或明确政策说明',term.value,v=>patchTerm(index,{value:v}))}
     <div className="grid gap-4 sm:grid-cols-2">{inputField('term-unit-'+index,'单位（如 pcs / working days）',term.unit??'',v=>patchTerm(index,{unit:v}))}{inputField('term-currency-'+index,'币种（价格需填，如 USD）',term.currency??'',v=>patchTerm(index,{currency:v.trim()?v.toUpperCase():undefined}))}</div>
     <div className="grid gap-4 sm:grid-cols-2">{inputField('term-min-'+index,'区间下限（可选）',term.min===undefined?'':String(term.min),v=>patchTerm(index,{min:v===''?undefined:Number(v)}),'number')}{inputField('term-max-'+index,'区间上限（可选）',term.max===undefined?'':String(term.max),v=>patchTerm(index,{max:v===''?undefined:Number(v)}),'number')}</div>
     {inputField('term-condition-'+index,'适用条件（产品、数量、费用边界等）',term.conditions,v=>patchTerm(index,{conditions:v}))}
     <ConditionalScopeEditor term={term} products={form.products.split(/[,，]/).map(x=>x.trim()).filter(Boolean)} onChange={scope=>patchTerm(index,{scope})}/>
     <Button variant="ghost" className="min-h-11 text-muted-foreground" onClick={()=>setForm(f=>({...f,terms:f.terms.filter((_,i)=>i!==index)}))}>移除此条件</Button>
    </fieldset>)}
    <Button variant="outline" className="min-h-11" disabled={form.terms.length>=25} onClick={()=>setForm(f=>({...f,terms:[...f.terms,{topic:'moq',value:'',conditions:'',mode:'needs_confirmation'}]}))}>添加条件记录</Button>
   </section>
   <div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" disabled={busy||!form.title.trim()||!form.content.trim()||!form.source.trim()||!form.applicability.trim()||!form.validFrom} onClick={()=>void save(false)}>保存草稿版本</Button><Button className="min-h-11" disabled={busy||!form.title.trim()||!form.content.trim()||!form.source.trim()||!form.applicability.trim()||!form.validFrom} onClick={()=>void save(true)}>已核对，发布此版本</Button></div>
   <p className="text-xs leading-5 text-muted-foreground">保存草稿不会替换已发布版本。发布后供本项目销售助手使用，历史版本与旧邮件依据均保留。</p>
  </section>:<>
   <div className="mb-4 flex flex-wrap gap-3"><Input className="min-h-11 min-w-0 flex-1 basis-48" aria-label="搜索项目知识" placeholder="搜索标题、关键词或正文" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="筛选知识分类" className={nativeSelect+' sm:w-auto'} value={category} onChange={e=>setCategory(e.target.value)}><option value="all">全部分类</option>{Object.entries(knowledgeCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{admin&&<select aria-label="筛选发布状态" className={nativeSelect+' sm:w-auto'} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="disabled">已停用</option></select>}</div>
   {loading&&<p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>正在读取项目知识…</p>}
   {!loading&&!matches.length&&<p className="py-6 text-sm leading-6 text-muted-foreground">{rows.length?'没有匹配的知识，请调整筛选。':'尚无可用知识。管理员可以录入资料并审核发布；知识不足时助手会标明待确认内容。'}</p>}
   <div className="divide-y">{matches.map(row=>{const v=row.revisions.at(-1)!;return <section key={row.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><button type="button" className="min-h-11 min-w-0 flex-1 text-left text-sm font-semibold leading-6 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>{setSelected(selected?.id===row.id?null:row);setHistory([]);}}>{v.title}</button><Badge variant={row.archived?'muted':row.effective?'developed':'outline'}>{row.archived?'已停用':row.approvedVersion?'已发布 v'+row.approvedVersion+(row.effective?'':' · 当前不可用'):'草稿'}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{knowledgeCategories[v.category??'product']} · {new Date(row.updatedAt).toLocaleString()}{row.hasDraft&&row.approvedVersion?' · 另有未发布修改':''}</p><p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{v.applicability||'历史资料缺少适用条件，需审核'}</p>
    {selected?.id===row.id&&<div className="mt-4 space-y-4 rounded-lg bg-muted/30 p-4">{row.hasDraft&&row.approvedVersion>0&&<p className="text-sm leading-6 text-amber-700 dark:text-amber-400">当前展开的是未发布修改。助手继续使用已发布的第 {row.approvedVersion} 版。</p>}<AgentMessageContent content={v.content}/>{admin&&v.sourceRefs?.map(ref=><a key={ref.chunkId} className="block min-h-11 py-2 text-sm text-primary underline" href={'/knowledge?view=documents&document='+encodeURIComponent(ref.documentId)+'&revision='+encodeURIComponent(ref.parsingRevisionId)}>核对原始资料与解析版本</a>)}<dl className="space-y-2 text-xs leading-5 text-muted-foreground"><div><dt className="font-medium">来源</dt><dd className="break-words">{v.source}</dd></div><div><dt className="font-medium">适用产品 / 生效范围</dt><dd>{v.products?.join('、')||'项目通用'} · {v.validFrom?new Date(v.validFrom).toLocaleString():'未核对'} 至 {v.validUntil?new Date(v.validUntil).toLocaleString():'未设置失效时间'}</dd></div></dl>
     {(v.terms??[]).map((term,i)=><p key={i} className="text-sm leading-6"><strong>{policyTopics[term.topic]}：</strong>{term.value} {term.unit} {term.currency} · {term.mode==='confirmed'?'已确认':term.mode==='reference'?'仅参考':'待确认'}<span className="block text-muted-foreground">条件：{term.conditions}</span></p>)}
     <Button variant="ghost" className="min-h-11" onClick={()=>{void apiGet<{revisions:KnowledgeRevision[]}>('/agent/knowledge/'+row.id).then(result=>setHistory(result.revisions)).catch(e=>setError(knowledgeError(e)));}}>查看历史版本</Button>
     {history.length>0&&<ol className="space-y-3 border-l pl-3">{history.map(revision=><li key={revision.version} className="text-xs leading-5">第 {revision.version} 版 · {revision.approved?'已审核发布':'草稿'}<p className="mt-1 whitespace-pre-wrap text-muted-foreground">{revision.content}</p></li>)}</ol>}
    </div>}
    {admin&&!row.archived&&<div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" onClick={()=>edit(row)}>编辑新版本</Button><Button variant="ghost" className="min-h-11 text-muted-foreground" disabled={busy} onClick={()=>{setBusy(true);void apiPost('/agent/knowledge/'+row.id+'/archive',{version:row.version}).then(load).catch(e=>setError(knowledgeError(e))).finally(()=>setBusy(false));}}>停用</Button></div>}
   </section>;})}</div>
  </>}
  {customerId&&!formOpen&&<section className="mt-5 border-t pt-4"><h3 className="text-sm font-semibold">当前客户附件</h3><p className="my-2 text-xs leading-5 text-muted-foreground">支持 5MB 内的文字 PDF、Word、TXT。附件是客户资料，不等于已确认的我方交易政策。</p>{attachments.map(a=><div key={a.id} className="flex items-center justify-between gap-3 border-b py-3"><span className="min-w-0 break-words text-sm">{a.originalName}</span><Button variant="outline" className="min-h-11 shrink-0" disabled={busy} onClick={()=>{setBusy(true);void apiGet<NonNullable<typeof attachmentText>>('/agent/customers/'+customerId+'/attachments/'+a.id+'/text').then(setAttachmentText).catch(e=>setError(knowledgeError(e))).finally(()=>setBusy(false));}}>读取正文</Button></div>)}{!attachments.length&&<p className="py-3 text-sm text-muted-foreground">该客户暂无附件。</p>}{attachmentText&&<div className="mt-3"><p className="text-sm font-medium">{attachmentText.name}</p><p className="mt-2 text-xs text-muted-foreground">{attachmentText.reason}</p><pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-6">{attachmentText.text||'暂时没有可读取的文字'}</pre></div>}</section>}
 </div>;
}
