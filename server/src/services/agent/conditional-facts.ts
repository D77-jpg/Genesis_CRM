import {z} from 'zod';
import type {KnowledgeBundle,KnowledgeSource,KnowledgeTerm,PolicyTopic} from './knowledge-types';
export const factScopeInput=z.object({
 products:z.array(z.string().trim().min(1).max(100)).max(20),
 processes:z.array(z.string().trim().min(1).max(100)).max(12).default([]),
 quantity:z.object({min:z.number().finite().nonnegative().optional(),max:z.number().finite().nonnegative().optional(),minInclusive:z.boolean().default(true),maxInclusive:z.boolean().default(true),unit:z.string().trim().min(1).max(40)}).strict().refine(v=>v.min===undefined||v.max===undefined||v.min<=v.max,'数量范围下限不能大于上限').optional(),
 startsAfter:z.string().trim().max(300).optional(),
 validFrom:z.string().datetime({offset:true}).optional(),validUntil:z.string().datetime({offset:true}).optional(),
 exclusions:z.array(z.string().trim().min(1).max(200)).max(12).default([]),
 polarity:z.enum(['affirmed','denied']).default('affirmed'),
 certificate:z.object({number:z.string().trim().min(1).max(120),issuer:z.string().trim().min(1).max(160),products:z.array(z.string().trim().min(1).max(100)).min(1).max(20),validUntil:z.string().datetime({offset:true})}).strict().optional(),
}).strict().superRefine((v,c)=>{if(v.validUntil&&v.validFrom&&v.validUntil<=v.validFrom)c.addIssue({code:'custom',message:'条件失效时间须晚于生效时间'});});
export type FactScope=z.infer<typeof factScopeInput>;
export interface FactContext {products?:string[];processes?:string[];quantity?:number;quantityUnit?:string;customerId?:string;asOf?:string}
export interface ConditionalEvidence {
 id:string;sourceId:string;version:number;topic:PolicyTopic;term:KnowledgeTerm;
 status:'applicable'|'needs_confirmation'|'not_applicable'|'expired'|'conflict';reasons:string[];
 location:{kind:'publication_term'|'quotation_item'|'agreement_term';index:number};
}
export const normalized=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
function same(a:string,b:string){return normalized(a)===normalized(b);}
function active(from:string|undefined,until:string|undefined,at:number){return (!from||Date.parse(from)<=at)&&(!until||Date.parse(until)>at);}
function finiteDate(v:string|undefined){return !v||Number.isFinite(Date.parse(v));}
export function factApplies(term:KnowledgeTerm,source:KnowledgeSource,context:FactContext):{status:ConditionalEvidence['status'];reasons:string[]}{
 const reasons:string[]=[];const at=Date.parse(context.asOf??new Date().toISOString());const s=term.scope;
 if(!Number.isFinite(at)||!finiteDate(source.validFrom)||!finiteDate(source.validUntil)||!active(source.validFrom,source.validUntil,at))return {status:'expired',reasons:['来源未生效或已失效']};
 if(source.customerId&&source.customerId!==context.customerId)return {status:'not_applicable',reasons:['客户范围不符']};
 if(term.mode==='needs_confirmation')return {status:'needs_confirmation',reasons:['资料尚待确认']};
 if(!s)return {status:'needs_confirmation',reasons:['旧版条件尚未结构化审核；不得从自由备注推断适用范围']};
 if(!finiteDate(s.validFrom)||!finiteDate(s.validUntil)||!active(s.validFrom,s.validUntil,at))return {status:'expired',reasons:['条件未生效或已失效']};
 if(s.products.length&&(!context.products?.length||!context.products.every(p=>s.products.some(x=>same(p,x)))))reasons.push('适用产品需要精确确认');
 if(s.processes.length&&(!context.processes?.length||!s.processes.every(p=>context.processes!.some(x=>same(p,x)))))reasons.push('工艺条件需要确认');
 if(s.quantity){
  const q=s.quantity;
  if(context.quantity===undefined||!context.quantityUnit||!same(context.quantityUnit,q.unit))reasons.push('数量或计量单位需要确认');
  else if((q.min!==undefined&&(context.quantity<q.min||(!q.minInclusive&&context.quantity===q.min)))||(q.max!==undefined&&(context.quantity>q.max||(!q.maxInclusive&&context.quantity===q.max))))return {status:'not_applicable',reasons:['数量不在适用区间']};
 }
 if(s.exclusions.length)reasons.push('排除条件须由业务员核对：'+s.exclusions.join('；'));
 if(term.topic==='lead_time'&&!s.startsAfter)reasons.push('交期缺少起算条件');
 if(term.topic==='certification'){
  const cert=s.certificate;
  if(!cert)reasons.push('缺少证书编号、适用产品、签发方或有效期');
  else if(!active(undefined,cert.validUntil,at))return {status:'expired',reasons:['证书已过期']};
  else if(!context.products?.length||!context.products.every(p=>cert.products.some(x=>same(p,x))))reasons.push('证书未明确覆盖本次产品');
 }
 return {status:reasons.length?'needs_confirmation':'applicable',reasons};
}
export function collectConditionalEvidence(bundle:KnowledgeBundle,context:FactContext=bundle.factContext??{}):ConditionalEvidence[]{
 const rows=bundle.sources.flatMap(source=>source.terms.map((term,index):ConditionalEvidence=>({id:source.sourceId+':term:'+(term.publicationIndex??index),sourceId:source.sourceId,version:source.version,topic:term.topic,term,...factApplies(term,source,context),location:{kind:source.kind==='quotation'?'quotation_item':source.kind==='agreement'?'agreement_term':'publication_term',index:term.publicationIndex??index}})));
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j];if(a.topic!==b.topic||a.status!=='applicable'||b.status!=='applicable')continue;
  // Only facts proven applicable to the same actual request can conflict. Never silently prefer a quote.
  const value=(x:ConditionalEvidence)=>JSON.stringify([normalized(x.term.value),x.term.min,x.term.max,normalized(x.term.unit??''),x.term.currency,x.term.mode,x.term.scope?.polarity,x.term.scope?.startsAfter]);
  if(value(a)!==value(b)){a.reasons.push('与另一有效来源不兼容');b.reasons.push('与另一有效来源不兼容');}
 }
 for(const row of rows)if(row.reasons.includes('与另一有效来源不兼容'))row.status='conflict';
 return rows;
}
export function scopeSummary(scope:FactScope){
 const q=scope.quantity;
 return [scope.products.length?'products '+scope.products.join(', '):'all products',scope.processes.length?'processes '+scope.processes.join(', '):'',
 q?'quantity '+(q.minInclusive?'[':'(')+(q.min??'unspecified')+', '+(q.max??'unbounded')+(q.maxInclusive?']':')')+' '+q.unit:'',
 scope.startsAfter?'counted after '+scope.startsAfter:'',scope.validFrom?'effective from '+scope.validFrom:'',scope.validUntil?'valid until '+scope.validUntil:'',
 scope.certificate?'certificate '+scope.certificate.number+' issued by '+scope.certificate.issuer+', covering '+scope.certificate.products.join(', ')+', valid until '+scope.certificate.validUntil:'',
 scope.exclusions.length?'exclusions '+scope.exclusions.join('; '):''].filter(Boolean).join('; ');
}
