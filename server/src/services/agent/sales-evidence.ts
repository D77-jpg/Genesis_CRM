import {AgentKnowledge} from '../../models/AgentKnowledge';
import {requireProjectId} from '../../utils/access';
import type {AuthUser} from '../../types/express';
import type {KnowledgeBundle,KnowledgeSource,PolicyTopic} from './knowledge-types';
import {sourceOf,revisionActive,policyTopics} from './knowledge.service';
import {buildKnowledgeBundle,factContextFromRequest,knowledgeFreshness,auditGroundedEmail} from './knowledge-grounding';
import {collectConditionalEvidence} from './conditional-facts';
import {workflowStage,type EvidenceWorkflow} from './evidence-workflow';
import {ApiError} from '../../utils/ApiError';
export type SalesMailKind='first_outreach'|'inquiry_reply'|'quotation_explanation'|'sample_reply'|'followup_review';
export const salesSubjects:Record<SalesMailKind,string>={first_outreach:'A brief introduction',inquiry_reply:'Regarding your inquiry',quotation_explanation:'Quotation details for review',sample_reply:'Regarding your sample request',followup_review:'Following up on your requirements'};
export function salesMailKind(request:string,inbound=false):SalesMailKind{
 if(/首封|第一封|first (?:outreach|introduction)/i.test(request))return 'first_outreach';
 if(/样品|sample/i.test(request))return 'sample_reply';if(/报价|quote|quotation|pricing/i.test(request))return 'quotation_explanation';
 if(/跟进|follow.?up/i.test(request))return 'followup_review';if(inbound||/询盘|回复|reply|inquiry/i.test(request))return 'inquiry_reply';return 'first_outreach';
}
const topicQuery:Record<PolicyTopic,string>={moq:'MOQ 起订量',lead_time:'lead time 交期',sample:'sample 样品',price:'price 报价',shipping:'freight 运费',payment:'payment 付款',certification:'certification 认证',trade_terms:'trade terms 贸易条款',capacity:'capacity 产能',other:'product 产品'};
export interface SalesRequirements {questions:string[];topics:PolicyTopic[];known:{quantity?:number;quantityUnit?:string;destination?:string};historyLimited:boolean}
export function extractSalesRequirements(request:string,history:string,kind:SalesMailKind):SalesRequirements{
 const text=request+'\n'+history;const questions=(kind==='first_outreach'?request:text).split(/\n|(?<=[?？])/).filter(s=>/[?？]|请问|能否|是否|多少|多久|what|how |could you/i.test(s)).map(s=>s.trim()).filter(Boolean).slice(-20);
 const all=[...text.matchAll(/(?:^|\n)\s*(?:quantity|qty|采购数量|数量)\s*[:：=]\s*(\d[\d,]*)\s*(pcs|pieces|sets|件|套)?|(?:we (?:need|want|require|plan to order)|需要|计划采购)\s*(\d[\d,]*)\s*(pcs|pieces|sets|件|套)(?!\w)/gi)];
 const amounts=[...new Set(all.map(m=>JSON.stringify([Number((m[1]??m[3]).replace(/,/g,'')),/sets|套/i.test(m[2]??m[4]??'')?'sets':'pcs'])))];
 const quantity=amounts.length===1?JSON.parse(amounts[0]) as [number,string]:undefined;
 const destinations=[...text.matchAll(/(?:destination|ship(?:ping)? to|目的地|收货地)\s*[:：]?\s*([^\n;。？?]{2,80})/gi)].map(m=>m[1].trim());
 const topics=policyTopics(kind==='first_outreach'?request:text);if(kind==='sample_reply'&&!topics.includes('sample'))topics.push('sample');if(kind==='quotation_explanation'&&!topics.includes('price'))topics.push('price');
 return {questions,topics,known:{quantity:quantity?.[0],quantityUnit:quantity?.[1],destination:destinations.length===1?destinations[0]:undefined},historyLimited:history.length>30000};
}
async function rulesFor(actor:AuthUser){
 const rows=await AgentKnowledge.find({projectId:requireProjectId(actor),approvedVersion:{$gt:0},archived:false,'revisions.category':'sales_rules'}).limit(101);
 if(rows.length>100)throw ApiError.conflict('项目销售规则过多，请管理员先整理');
 const sources=rows.flatMap(row=>{const v=row.revisions.find(r=>r.version===row.approvedVersion);return v?.category==='sales_rules'&&revisionActive(v)&&(actor.role==='admin'||v.accessScope!=='admins')?[sourceOf(row.id,v)]:[];});
 if(sources.length>4)throw ApiError.conflict('有效基础销售规则超过4条，请管理员合并后重试');return sources;
}
function mergeSource(a:KnowledgeSource,b:KnowledgeSource){
 if(a.version!==b.version||a.publication?.contentHash!==b.publication?.contentHash)throw ApiError.conflict('检索期间资料版本变化，请重新准备');
 const terms=[...a.terms];for(const term of b.terms)if(!terms.some(t=>t.publicationIndex===term.publicationIndex&&t.topic===term.topic))terms.push(term);return {...a,terms};
}
export async function prepareSalesEvidence(actor:AuthUser,input:{request:string;history:string;productHint:string;kind:SalesMailKind;customerId?:string;ids?:string[]},workflow?:EvidenceWorkflow){
 const requirements=await workflowStage(workflow,'extract_requirements',input,async()=>extractSalesRequirements(input.request,input.history,input.kind));
 const rules=await workflowStage(workflow,'load_rules',{projectId:actor.projectId,role:actor.role},()=>rulesFor(actor),{tool:'rules'});
 const query=[input.productHint,input.request,requirements.topics.map(t=>topicQuery[t]).join(' '),requirements.known.quantity!==undefined?'quantity:'+requirements.known.quantity+' '+requirements.known.quantityUnit:'',requirements.known.destination?'destination: '+requirements.known.destination:''].join(' ');
 let bundle=await workflowStage(workflow,'retrieve_0',{query,customerId:input.customerId},()=>buildKnowledgeBundle(actor,query,{customerId:input.customerId,ids:input.ids,...requirements.known}),{tool:'knowledge'});
 const sources=new Map<string,KnowledgeSource>();for(const s of [...rules,...bundle.sources])sources.set(s.sourceId,sources.has(s.sourceId)?mergeSource(sources.get(s.sourceId)!,s):s);
 const supplemental=()=>requirements.topics.filter(topic=>!collectConditionalEvidence({...bundle,sources:[...sources.values()]}).some(f=>f.topic===topic&&f.status==='applicable'));
 // At most two supplemental queries, deterministically planned from actual missing policy topics.
 const queried=new Set<PolicyTopic>();
 for(let round=1;round<=2&&!['retrieval_failed','index_stale','index_not_ready'].includes(bundle.status);round++){
  const missing=supplemental().filter(t=>!queried.has(t));if(!missing.length)break;const selected=missing.slice(0,3);selected.forEach(t=>queried.add(t));if(!selected.length)break;
  const supplementQuery=[input.productHint,...selected.map(t=>topicQuery[t]),requirements.known.quantity!==undefined?'quantity:'+requirements.known.quantity+' '+requirements.known.quantityUnit:''].join(' ');
  const extra=await workflowStage(workflow,'retrieve_'+round,{query:supplementQuery,customerId:input.customerId},()=>buildKnowledgeBundle(actor,supplementQuery,{customerId:input.customerId,ids:input.ids,...requirements.known}),{tool:'knowledge'});
  bundle.issues.push(...extra.issues);if(['retrieval_failed','index_stale','index_not_ready'].includes(extra.status)){bundle.status=extra.status;break;}
  for(const s of extra.sources)sources.set(s.sourceId,sources.has(s.sourceId)?mergeSource(sources.get(s.sourceId)!,s):s);
 }
 bundle.sources=[...sources.values()];if(['no_match','expired'].includes(bundle.status)&&bundle.sources.length)bundle.status='ready';bundle.topics=requirements.topics;bundle.factContext=factContextFromRequest(query,bundle,{...requirements.known,customerId:input.customerId});bundle.facts=collectConditionalEvidence(bundle);
 if(bundle.sources.length>16||JSON.stringify(bundle).length>48000)throw new ApiError(413,'完整依据超过单稿上限，请缩小问题范围；未截断条件','PAYLOAD_TOO_LARGE');
 if(requirements.historyLimited)bundle.issues.push({code:'history_limit',message:'历史资料超出本轮整理范围，请核对更早往来'});
 await assertSalesEvidenceCurrent(bundle,actor,input.customerId);
 await workflowStage(workflow,'assess_evidence',bundle,async()=>({status:bundle.status,missing:supplemental(),conflicts:bundle.facts?.filter(f=>f.status==='conflict').map(f=>f.id),evidence:bundle.sources.map(s=>({sourceId:s.sourceId,version:s.version,publication:s.publication,index:s.index})),known:requirements.known}),{tool:'conditions'});
 return {bundle,requirements};
}
export async function assertSalesEvidenceCurrent(bundle:KnowledgeBundle,actor:AuthUser,customerId?:string){
 const review=auditGroundedEmail('',bundle,{taskType:'evidence_check',customerId}).review;const current=await knowledgeFreshness(review,actor);
 if(current.failed||current.changed.length)throw ApiError.conflict('依据或权限已变化，请重新准备草稿');
}
