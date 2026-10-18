import type * as React from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import type {FactScope,KnowledgeTerm} from '@/types/knowledge';
const list=(s:string)=>s.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);
const local=(s?:string)=>s?new Date(Date.parse(s)-new Date(s).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
export const emptyScope=(products:string[]=[]):FactScope=>({reviewed:false,products,processes:[],exclusions:[],polarity:'affirmed'});
export function ConditionalScopeEditor({term,onChange,products=[]}:{term:KnowledgeTerm;onChange:(scope:FactScope)=>void;products?:string[]}){
 const s=term.scope;
 if(!s)return <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-sm leading-6">此条件尚未填写适用范围。可保留为历史资料，助手会列为待确认。</p><Button type="button" variant="outline" className="min-h-11" onClick={()=>onChange(emptyScope(products))}>填写适用范围</Button></div>;
 const field=(label:string,value:string,change:(v:string)=>void,type='text')=><label className="block space-y-2 text-sm"><span className="block font-medium">{label}</span><Input type={type} className="min-h-11" {...(/逗号|覆盖的产品/.test(label)?{key:value,defaultValue:value,onBlur:(e:React.FocusEvent<HTMLInputElement>)=>change(e.target.value)}:{value,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>change(e.target.value)})}/></label>;
 const update=(next:FactScope)=>onChange({...next,reviewed:false});
 const cert={number:'',issuer:'',products:[] as string[],validUntil:'',...s.certificate};
 const date=(v:string)=>v?new Date(v).toISOString():undefined;
 return <details className="rounded-lg border bg-muted/20 p-3" open={!s.reviewed}><summary className="min-h-11 cursor-pointer text-sm font-medium">适用范围与边界 · {s.reviewed?'已核对':'待核对'}</summary><div className="space-y-4 pt-3">
  <div className="grid gap-4 sm:grid-cols-2">{field('精确产品名称（逗号分隔，留空为项目通用）',s.products.join(', '),v=>update({...s,products:list(v)}))}{field('必须满足的工艺（逗号分隔）',s.processes.join(', '),v=>update({...s,processes:list(v)}))}</div>
  <label className="block space-y-2 text-sm"><span className="block font-medium">数值含义</span><select className="min-h-11 w-full rounded-md border bg-background px-3" value={s.measure??'text'} onChange={e=>update({...s,measure:e.target.value as FactScope['measure']})}><option value="text">政策说明</option><option value="amount">金额或费用</option><option value="quantity">数量</option><option value="duration">时长</option><option value="percentage">比例</option></select></label>
  <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={!!s.quantity} onChange={e=>update({...s,quantity:e.target.checked?{unit:'pcs',minInclusive:true,maxInclusive:true}:undefined})}/>限定采购数量范围</label>
  {s.quantity&&<div className="grid gap-4 rounded-md border p-3 sm:grid-cols-3">{field('数量下限（可选）',s.quantity.min===undefined?'':String(s.quantity.min),v=>update({...s,quantity:{...s.quantity!,min:v===''?undefined:Number(v)}}),'number')}{field('数量上限（可选）',s.quantity.max===undefined?'':String(s.quantity.max),v=>update({...s,quantity:{...s.quantity!,max:v===''?undefined:Number(v)}}),'number')}{field('采购数量单位',s.quantity.unit,v=>update({...s,quantity:{...s.quantity!,unit:v}}))}
   <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.quantity.minInclusive} onChange={e=>update({...s,quantity:{...s.quantity!,minInclusive:e.target.checked}})}/>包含下限</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.quantity.maxInclusive} onChange={e=>update({...s,quantity:{...s.quantity!,maxInclusive:e.target.checked}})}/>包含上限</label>
  </div>}
  <div className="grid gap-4 sm:grid-cols-3">{field('发货地（有明确限制时填写）',s.origin??'',v=>update({...s,origin:v||undefined}))}{field('目的地（有明确限制时填写）',s.destination??'',v=>update({...s,destination:v||undefined}))}{field('贸易条款（如 FOB）',s.incoterm??'',v=>update({...s,incoterm:v||undefined}))}</div>
  {field('起算条件（交期必须填写，例如收到定金并确认图稿）',s.startsAfter??'',v=>update({...s,startsAfter:v||undefined}))}
  <div className="grid gap-4 sm:grid-cols-2">{field('本项生效时间（可选）',local(s.validFrom),v=>update({...s,validFrom:date(v)}),'datetime-local')}{field('本项失效时间（可选）',local(s.validUntil),v=>update({...s,validUntil:date(v)}),'datetime-local')}</div>
  <label className="block space-y-2 text-sm"><span className="block font-medium">政策含义</span><select className="min-h-11 w-full rounded-md border bg-background px-3" value={s.polarity} onChange={e=>update({...s,polarity:e.target.value as FactScope['polarity']})}><option value="affirmed">按条件提供</option><option value="denied">明确不提供</option></select></label>
  {field('排除项（逗号分隔；非空时交由人工确认）',s.exclusions.join(', '),v=>update({...s,exclusions:list(v)}))}
  {term.topic==='certification'&&<fieldset className="space-y-4 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">证书覆盖范围</legend><p className="text-xs leading-5 text-muted-foreground">用于核对范围与期限，证书真实性仍需人工确认。</p>{field('证书编号',s.certificate?.number??'',v=>update({...s,certificate:{...cert,number:v}}))}{field('签发方',s.certificate?.issuer??'',v=>update({...s,certificate:{...cert,issuer:v}}))}{field('证书明确覆盖的产品',s.certificate?.products.join(', ')??'',v=>update({...s,certificate:{...cert,products:list(v)}}))}{field('证书失效时间',local(s.certificate?.validUntil),v=>update({...s,certificate:{...cert,validUntil:date(v)??''}}),'datetime-local')}</fieldset>}
  <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm leading-6"><input type="checkbox" className="mt-1" checked={s.reviewed} onChange={e=>onChange({...s,reviewed:e.target.checked})}/>我已核对原文、脚注及所有适用条件；上述范围与完整条件文字一致。</label>
 </div></details>;
}
