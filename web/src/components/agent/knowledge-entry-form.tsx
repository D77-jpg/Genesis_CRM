import * as React from 'react';
import {ArrowLeft,Loader2} from 'lucide-react';
import {apiPost,toErrorMessage,ApiClientError} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {ConditionalScopeEditor} from './conditional-scope-editor';
import {knowledgeCategories,policyTopics,type KnowledgeCategory,type KnowledgeTerm,type ProjectKnowledge} from '@/types/knowledge';

const localDate=(value?:string)=>{const d=value?new Date(value):new Date();return Number.isNaN(d.getTime())?'':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const knowledgeError=(error:unknown,fallback?:string)=>error instanceof ApiClientError&&error.details.length?error.details.slice(0,5).map(detail=>detail.message).join('；'):toErrorMessage(error,fallback);
const newForm=()=>({accessScope:'project' as 'project'|'admins',title:'',category:'company' as KnowledgeCategory,tags:'',content:'',source:'',applicability:'',products:'',validFrom:localDate(),validUntil:'',terms:[] as KnowledgeTerm[]});
const nativeSelect='min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function initial(entry:ProjectKnowledge|null){
 const v=entry?.revisions.at(-1);
 return v?{accessScope:v.accessScope??'project',title:v.title,category:v.category??'product',tags:v.tags.join(', '),content:v.content,source:v.source,applicability:v.applicability??'',products:(v.products??[]).join(', '),validFrom:localDate(v.validFrom),validUntil:v.validUntil?localDate(v.validUntil):'',terms:v.terms??[]}:newForm();
}

/** 新增或修订一条资料；保存动作由“发布”按钮决定是否立即对助手生效。 */
export function KnowledgeEntryForm({entry,onSaved,onCancel}:{entry?:ProjectKnowledge|null;onSaved:()=>void;onCancel:()=>void}){
 const [form,setForm]=React.useState(()=>initial(entry??null));
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const inputField=(id:string,label:string,value:string,onChange:(v:string)=>void,type='text')=><div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={e=>onChange(e.target.value)} className="min-h-11"/></div>;
 function patchTerm(index:number,patch:Partial<KnowledgeTerm>){setForm(f=>({...f,terms:f.terms.map((term,i)=>i===index?{...term,...patch,...(!patch.scope&&term.scope?{scope:{...term.scope,reviewed:false}}:{})}:term)}));}
 async function save(approved:boolean){
  setBusy(true);setError('');
  try{
   await apiPost('/agent/knowledge'+(entry?'/'+entry.id+'/revisions':''),{accessScope:form.accessScope,expectedVersion:entry?.version??0,title:form.title,category:form.category,content:form.content,source:form.source,approved,
    tags:form.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean),products:form.products.split(/[,，]/).map(s=>s.trim()).filter(Boolean),applicability:form.applicability,
    validFrom:new Date(form.validFrom).toISOString(),...(form.validUntil?{validUntil:new Date(form.validUntil).toISOString()}:{}),terms:form.terms});
   onSaved();
  }catch(e){setError(knowledgeError(e,'资料还没保存，请检查填写的内容和版本'));}finally{setBusy(false);}
 }
 const ready=!busy&&!!form.title.trim()&&!!form.content.trim()&&!!form.source.trim()&&!!form.applicability.trim()&&!!form.validFrom;
 return <section className="space-y-5">
  <Button variant="ghost" className="min-h-11 px-0" onClick={onCancel}><ArrowLeft className="h-4 w-4" aria-hidden/>{entry?'返回资料':'返回列表'}</Button>
  <h3 className="font-semibold">{entry?'修订资料 · 保存后生效为第 '+(entry.version+1)+' 版':'手动新增一条资料'}</h3>
  {error&&<p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{error}</p>}
  {inputField('knowledge-title','标题',form.title,v=>setForm(f=>({...f,title:v})))}
  <label className="block space-y-2 text-sm"><span className="block font-medium">分类</span><select className={nativeSelect} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value as KnowledgeCategory}))}>{Object.entries(knowledgeCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <label className="block space-y-2 text-sm"><span className="block font-medium">谁能看到</span><select className={nativeSelect} value={form.accessScope} onChange={e=>setForm(f=>({...f,accessScope:e.target.value as 'project'|'admins'}))}><option value="project">本项目成员</option><option value="admins">仅管理员</option></select></label>
  <div className="space-y-2"><Label htmlFor="knowledge-body">正文</Label><Textarea id="knowledge-body" rows={10} maxLength={12000} value={form.content} onChange={e=>setForm(f=>({...f,content:e.target.value}))}/><p className={'text-xs '+(form.content.length>12000?'text-destructive':'text-muted-foreground')}>{form.content.length} / 12000 字符</p></div>
  {inputField('knowledge-keywords','关键词（逗号分隔，可含英文别名）',form.tags,v=>setForm(f=>({...f,tags:v})))}
  {inputField('knowledge-products','适用产品（逗号分隔；留空表示通用）',form.products,v=>setForm(f=>({...f,products:v})))}
  {inputField('knowledge-conditions','适用条件与边界',form.applicability,v=>setForm(f=>({...f,applicability:v})))}
  {inputField('knowledge-source','来源或确认依据',form.source,v=>setForm(f=>({...f,source:v})))}
  <div className="grid gap-4 sm:grid-cols-2">{inputField('knowledge-from','生效时间',form.validFrom,v=>setForm(f=>({...f,validFrom:v})),'datetime-local')}{inputField('knowledge-until','失效时间（可选）',form.validUntil,v=>setForm(f=>({...f,validUntil:v})),'datetime-local')}</div>
  <section className="space-y-4 border-y py-4"><div><h4 className="font-semibold">交易条件（可选）</h4><p className="mt-1 text-sm leading-6 text-muted-foreground">MOQ、交期、费用、认证等要对客户承诺的内容，在这里逐项写清数值、单位和适用条件。不填也能发布，但助手不会替你承诺这些数字。</p></div>
   {form.terms.map((term,index)=><fieldset key={index} className="space-y-4 rounded-lg border p-3"><legend className="px-1 text-sm">条件 {index+1}</legend>
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm"><span className="block font-medium">内容类型</span><select className={nativeSelect} value={term.topic} onChange={e=>patchTerm(index,{topic:e.target.value as KnowledgeTerm['topic']})}>{Object.entries(policyTopics).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label className="space-y-2 text-sm"><span className="block font-medium">确认程度</span><select className={nativeSelect} value={term.mode} onChange={e=>patchTerm(index,{mode:e.target.value as KnowledgeTerm['mode']})}><option value="needs_confirmation">待确认，不对外承诺</option><option value="reference">参考，非正式报价</option><option value="confirmed">已确认，按条件使用</option></select></label></div>
    {inputField('term-value-'+index,'值或明确说明',term.value,v=>patchTerm(index,{value:v}))}
    <div className="grid gap-4 sm:grid-cols-2">{inputField('term-unit-'+index,'单位（如 pcs / working days）',term.unit??'',v=>patchTerm(index,{unit:v}))}{inputField('term-currency-'+index,'币种（如 USD）',term.currency??'',v=>patchTerm(index,{currency:v.trim()?v.toUpperCase():undefined}))}</div>
    <div className="grid gap-4 sm:grid-cols-2">{inputField('term-min-'+index,'区间下限（可选）',term.min===undefined?'':String(term.min),v=>patchTerm(index,{min:v===''?undefined:Number(v)}),'number')}{inputField('term-max-'+index,'区间上限（可选）',term.max===undefined?'':String(term.max),v=>patchTerm(index,{max:v===''?undefined:Number(v)}),'number')}</div>
    {inputField('term-condition-'+index,'适用条件（产品、数量、费用边界）',term.conditions,v=>patchTerm(index,{conditions:v}))}
    <ConditionalScopeEditor term={term} products={form.products.split(/[,，]/).map(x=>x.trim()).filter(Boolean)} onChange={scope=>patchTerm(index,{scope})}/>
    <Button variant="ghost" className="min-h-11 text-muted-foreground" onClick={()=>setForm(f=>({...f,terms:f.terms.filter((_,i)=>i!==index)}))}>移除此条件</Button>
   </fieldset>)}
   <Button variant="outline" className="min-h-11" disabled={form.terms.length>=25} onClick={()=>setForm(f=>({...f,terms:[...f.terms,{topic:'moq',value:'',conditions:'',mode:'needs_confirmation'}]}))}>添加条件</Button>
  </section>
  <div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" disabled={!ready} onClick={()=>void save(false)}>{busy?<Loader2 className="h-4 w-4 animate-spin" aria-hidden/>:null}只保存草稿</Button><Button className="min-h-11" disabled={!ready} onClick={()=>void save(true)}>保存并发布</Button></div>
  <p className="text-xs leading-5 text-muted-foreground">发布后助手立即可用；旧版本和旧邮件依据都会保留。</p>
 </section>;
}
