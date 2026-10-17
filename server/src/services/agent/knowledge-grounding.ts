import {createHash} from 'node:crypto';
import {Types} from 'mongoose';
import {Quotation} from '../../models/Quotation';
import {AgentKnowledge} from '../../models/AgentKnowledge';
import type {AuthUser} from '../../types/express';
import {requireProjectId} from '../../utils/access';
import {getCustomerByIdOrThrow} from '../customer.service';
import {policyTopics,productApplies,retrieveKnowledge,revisionActive} from './knowledge.service';
import type {KnowledgeBundle,KnowledgeReview,KnowledgeSource,KnowledgeTerm,KnowledgeFreshness,PolicyTopic} from './knowledge-types';

export const normalizeFact=(s:string)=>s.toLocaleLowerCase().replace(/\s+/g,' ').trim();
export const draftHash=(s:string)=>createHash('sha256').update(normalizeFact(s)).digest('hex');
const labels:Record<PolicyTopic,string>={moq:'Minimum order quantity',lead_time:'Production lead time',sample:'Sample policy',
 price:'Price',shipping:'Shipping',payment:'Payment',certification:'Certification',trade_terms:'Trade terms',capacity:'Capacity',other:'Product details'};
const ask:Record<PolicyTopic,string>={moq:'Minimum order quantity needs confirmation for your exact specification.',
 lead_time:'Production timing needs confirmation for the final specification and order quantity.',
 sample:'The sample arrangement and any charges need confirmation.',
 price:'A firm price needs confirmation after reviewing your specifications and quantity.',
 shipping:'Freight cost needs confirmation for the destination and shipment details.',
 payment:'Payment terms need confirmation.',certification:'Certificate scope and current validity need confirmation for this product.',
 trade_terms:'Trade terms need confirmation.',capacity:'Available production capacity needs confirmation.',other:'Please confirm the remaining product details.'};
export function knowledgeTaskType(request:string,fallback='first_outreach'){
 if(/样品|sample/i.test(request))return 'sample_reply';
 if(/报价|quote|quotation|pricing/i.test(request))return 'quotation_explanation';
 if(/跟进|follow.?up/i.test(request))return 'followup';
 return fallback;
}
export function languageOnly(text:string){
 return /翻译|润色|translate|polish|proofread/i.test(text)&&!/补充|新增|加入|添加|add |include new|new commitment/i.test(text);
}
export function needsKnowledge(text:string){
 if(languageOnly(text))return false;
 return policyTopics(text).length>0||/开发信|询盘|邮件|写信|回复|产品|公司|工厂|write.*(?:email|letter)|reply|outreach|product|company/i.test(text);
}
export function guardLanguageTransform(text:string,original:string){
 const numbers=new Set(original.match(/\d+(?:[.,]\d+)*/g)??[]);
 const topics=new Set(policyTopics(original));
 const kept=text.split(/\n+|(?<=[.!?。！？])\s+(?=[A-Z\u4e00-\u9fff])/).filter(sentence=>{
  if((sentence.match(/\d+(?:[.,]\d+)*/g)??[]).some(value=>!numbers.has(value)))return false;
  return policyTopics(sentence).every(topic=>topics.has(topic));
 }).join('\n');
 return kept||'本次文字转换包含无法核对的新增事实，请明确提供需要翻译或润色的原文。';
}
export function isBusinessMailCommand(text:string){
 if(/^(为什么|如何|怎么|是否)|不要.{0,6}(写|生成|准备)|不用.{0,6}(写|生成|准备)/.test(text))return false;
 return /^(请|帮我|给我|为|给|你帮我|麻烦|现在|先|写|生成|起草|准备|回复|please|write|draft|prepare)/i.test(text)
  &&/(写|生成|起草|准备|回复|write|draft|prepare|reply)/i.test(text)
  &&/(开发信|邮件|询盘|跟进信|样品回复|报价说明|email|letter|inquiry|quotation|follow.?up)/i.test(text);
}
function quantityOf(text:string):number|undefined{
 const m=/(?:quantity|qty|order quantity|采购数量|数量)\s*[:：=]?\s*(\d[\d,]*)|(?:^|\s)(\d[\d,]*)\s*(?:pcs|pieces|units|件)\b/i.exec(text);
 return m?Number((m[1]??m[2]).replace(/,/g,'')):undefined;
}
function requestedPriceMissing(bundle:KnowledgeBundle,query:string){
 if(bundle.status!=='ready'||!policyTopics(query).includes('price'))return bundle;
 const freight=/freight|shipping|courier|运费|物流费用|快递费/i.test(query);
 const hasValue=bundle.sources.some(s=>s.terms.some(t=>(t.mode!=='needs_confirmation'&&
  t.topic==='price'&&(!freight||/freight|shipping|courier|运费|物流|快递/i.test(t.conditions)))
  ||(freight&&t.topic==='shipping'&&t.mode!=='needs_confirmation'&&!!t.currency&&/\d/.test(t.value))));
 const hasOtherAnswer=bundle.topics.some(topic=>topic!=='price'&&topic!=='shipping'&&bundle.sources.some(s=>s.terms.some(t=>t.topic===topic&&t.mode!=='needs_confirmation')));
 if(!hasValue)return {...bundle,status:hasOtherAnswer?'ready' as const:'no_match' as const,issues:[...bundle.issues,{code:'missing',message:freight?'尚无适用于本次请求的已确认运费金额；相关物流说明不能当作报价':'尚无适用于本次请求的已确认价格；相关产品介绍不能当作报价'}]};
 return bundle;
}
export async function buildKnowledgeBundle(actor:AuthUser,query:string,options:{customerId?:string;quantity?:number;ids?:string[];retrievalMode?:'bm25'|'vector'|'hybrid'|'hybrid_rerank'}={}){
 const bundle=await retrieveKnowledge(actor,query,options.ids,options.retrievalMode);
 if(!options.customerId||bundle.status==='retrieval_failed')return requestedPriceMissing(bundle,query);
 // A customer's quotation can only enter their own context and only after a fresh ACL check.
 const customer=await getCustomerByIdOrThrow(options.customerId,actor);
 const quantity=options.quantity??quantityOf(query)??(/^\d+$/.test(customer.expectedQuantity??'')?Number(customer.expectedQuantity):undefined);
 try{
  const quotes=await Quotation.find({projectId:requireProjectId(actor),customerId:customer._id,status:'accepted',validityDate:{$gt:new Date()}}).sort({updatedAt:-1}).limit(10);
  for(const q of quotes){
   const items=q.items.filter(item=>quantity===item.quantity&&productApplies([item.productName],query));
   if(!items.length)continue;
   const terms:KnowledgeTerm[]=items.map(item=>({topic:'price',value:String(item.unitPrice),unit:'per piece',currency:q.currency,
    conditions:item.productName+'; quantity '+item.quantity+'; customer '+customer.name+'; quotation '+q.quotationNo,mode:'confirmed'}));
   const conditions=terms.map(t=>t.conditions).join('; ');
   for(const [topic,value] of [['moq',q.moq],['lead_time',q.leadTime],['payment',q.paymentTerms]] as const)if(value)terms.push({topic,value,conditions,mode:'confirmed'});
   if(bundle.status==='no_match')bundle.status='ready';
   bundle.sources.push({sourceId:'quotation:'+q.id+':v'+q.version,quotationId:q.id,version:q.version,title:q.quotationNo,category:'trade',kind:'quotation',
    source:'已接受的客户专属报价',content:JSON.stringify(items),applicability:conditions,products:items.map(i=>i.productName),validFrom:q.updatedAt.toISOString(),validUntil:q.validityDate!.toISOString(),terms});
  }
  return requestedPriceMissing(bundle,query);
 }catch{
  return {...bundle,status:'retrieval_failed' as const,issues:[...bundle.issues,{code:'retrieval_failed',message:'客户专属报价检索失败，不能作出报价承诺'}]};
 }
}
function termText(term:KnowledgeTerm,source:KnowledgeSource){
 const numberRange=term.min!==undefined?(term.max!==undefined&&term.max!==term.min?term.min+'–'+term.max:String(term.min)):term.value;
 const embedded=normalizeFact(numberRange);
 const value=[term.currency&&!embedded.includes(term.currency.toLowerCase())?term.currency:undefined,
  numberRange,term.unit&&!embedded.includes(term.unit.toLowerCase())?term.unit:undefined].filter(Boolean).join(' ');
 return labels[term.topic]+': '+value+(term.mode==='reference'?' (reference only; not a firm quotation)':'')+
  '. Conditions: '+term.conditions+(source.applicability&&source.applicability!==term.conditions?'; '+source.applicability:'')+'.';
}
export function applicableTerms(bundle:KnowledgeBundle){
 const terms=bundle.sources.filter(source=>!source.validUntil||new Date(source.validUntil)>new Date()).flatMap(source=>(source.terms??[]).filter(term=>term.mode!=='needs_confirmation').map(term=>({source,term})));
 const conflicts=new Set<string>();
 for(const a of terms)for(const b of terms){
  if(a===b||a.term.topic!==b.term.topic)continue;
  // Different applicable authoritative values for the same policy need human resolution.
  // Product/customer-specific quotations never silently override general policies.
  const conditionClass=(text:string)=>/fully custom|full custom|全定制/i.test(text)?'custom':/standard|stock|标准|现货/i.test(text)?'standard':'unspecified';
  const left=conditionClass(a.term.conditions),right=conditionClass(b.term.conditions);
  const explicitlyDisjoint=left!==right&&left!=='unspecified'&&right!=='unspecified';
  const sameScope=!explicitlyDisjoint;
  const aValue=JSON.stringify([a.term.value,a.term.min,a.term.max,a.term.unit,a.term.currency,a.term.mode]);
  const bValue=JSON.stringify([b.term.value,b.term.min,b.term.max,b.term.unit,b.term.currency,b.term.mode]);
  if(sameScope&&aValue!==bValue){conflicts.add(a.source.sourceId+':'+a.term.topic);conflicts.add(b.source.sourceId+':'+b.term.topic);}
 }
 return {terms:terms.filter(t=>!conflicts.has(t.source.sourceId+':'+t.term.topic)),conflicts,all:terms};
}
function factWords(text:string){return (text.toLowerCase().match(/[a-z]{3,}|[\u4e00-\u9fff]{2,}/g)??[]).filter(w=>!['the','and','our','with','for','your','that','from','this','have','are','you','can','will','would','could','please','company'].includes(w));}
function groundedSentence(sentence:string,sources:KnowledgeSource[],customerEvidence:string,identity:string){
 const normalized=normalizeFact(sentence);
 if(normalized.length<8)return true;
 const authority=sources.filter(s=>s.kind==='knowledge'&&['company','product','faq'].includes(s.category)).map(s=>s.content).join(' ');
 const all=[authority,customerEvidence,identity].join(' ');
 const numbers=sentence.match(/\d+(?:[.,]\d+)*/g)??[];
 const evidenceNumbers=new Set((all.replace(/\b[a-f\d]{24}\b/gi,'').match(/\d+(?:[.,]\d+)*/g)??[]));
 if(numbers.some(n=>!evidenceNumbers.has(n)))return false;
 if(/\b(?:we|our|your|you)\b.*(?:manufactur|factor|certif|speciali|export|founded|establish|produce|operate|located|store|capacity|customiz|offer|provide|deliver)|我们.*(?:工厂|生产|提供|产能|制造)|贵司|贵公司/i.test(sentence)){
  const tokens=factWords(sentence);const supported=tokens.filter(w=>normalizeFact(all).includes(w)).length;
  return tokens.length>0&&supported/tokens.length>=0.8;
 }
 return true;
}
export function auditGroundedEmail(body:string,bundle:KnowledgeBundle,options:{
 taskType:string;customerId?:string;mailId?:string;direction?:'inbound'|'outbound';request?:string;
 customerEvidence?:string;questions?:string[];seller?:{companyName:string;senderName:string;senderEmail?:string;website?:string};
}):{bodyText:string;review:KnowledgeReview}{
 const issues=[...bundle.issues];const {terms,conflicts,all}=applicableTerms(bundle);
 if(conflicts.size)issues.push({code:'conflict',message:'有效来源对同一条件给出不同条款，需人工确认',sourceIds:[...new Set(all.filter(t=>conflicts.has(t.source.sourceId+':'+t.term.topic)).map(t=>t.source.sourceId))]});
 const topics=bundle.topics;const claims:KnowledgeReview['claims']=[];const questions:KnowledgeReview['questions']=[];
 const answers:string[]=[];const missing:string[]=[];
 for(const topic of topics){
  const matches=terms.filter(t=>t.term.topic===topic);
  if(matches.length&&bundle.status!=='retrieval_failed'){
   for(const item of matches.slice(0,4)){const text=termText(item.term,item.source);answers.push(text);claims.push({text,topic,sourceIds:[item.source.sourceId]});}
   questions.push({question:labels[topic],topic,status:'answered',sourceIds:[...new Set(matches.map(t=>t.source.sourceId))]});
  }else{
   missing.push(ask[topic]);questions.push({question:labels[topic],topic,status:'unanswered',sourceIds:[]});
   issues.push({code:conflicts.size?'conflict':'missing',message:'尚无可直接使用的有效依据：'+labels[topic],topic});
  }
 }
 for(const question of options.questions??[]){
  const questionTopics=policyTopics(question);
  if(questionTopics.length)continue;
  const words=factWords(question);
  const matching=bundle.sources.filter(s=>['faq','product'].includes(s.category)&&words.length>0&&words.filter(w=>normalizeFact(s.content).includes(w)).length/words.length>=0.8);
  questions.push({question,status:matching.length?'answered':'unanswered',sourceIds:matching.map(s=>s.sourceId)});
  if(!matching.length)issues.push({code:'unanswered',message:'需补充回答：'+question});
 }
 const seller=options.seller;
 const identity=seller?Object.values(seller).filter(Boolean).join(' '):'';
 // The model writes tone and structure; server-owned policy sentences carry the commitments.
 // Removing policy assertions before inserting reviewed conditional statements prevents fabricated
 // numbers, template examples, customer demands and prompt injection from becoming seller policy.
 const withoutSignature=body.split(/\n\s*(?:best regards|kind regards|sincerely|regards|此致|祝好)\b/i)[0]??body;
 const parts=withoutSignature.replace(/^\s*\d+[.)]\s*/gm,'').split(/\n+|(?<=[.!?。！？])\s+(?=[A-Z\u4e00-\u9fff])/).map(s=>s.trim()).filter(Boolean);
 const removed:string[]=[];
 const kept=parts.filter(sentence=>{
  if(/review the draft|draft review|draft reply|prepared for.{0,40}review|sales team.{0,12}review|(?:has |have )?not been sent|approval workflow|internal review|sourceId|knowledge.?base|知识库|内部审核|草稿准备|业务员审核|\bCRM\b/i.test(sentence))return false;
  if(/following (?:confirmed )?(?:points|details|terms)|以下.*(?:信息|要点|政策)/i.test(sentence)&&/:$/.test(sentence))return false;
  if(/please find (?:our )?(?:confirmed )?information below|^(?:here are|below are) (?:the|our) (?:confirmed )?(?:details|answers)/i.test(sentence))return false;
  const commercial=policyTopics(sentence).length>0;
  if(commercial){removed.push(sentence);return false;}
  if(!groundedSentence(sentence,bundle.sources,options.customerEvidence??'',identity)){removed.push(sentence);return false;}
  if(/(?:what|confirm|share|provide|let us know).*(?:quantity|order size)/i.test(sentence)&&quantityOf(options.customerEvidence??''))return false;
  return true;
 });
 if(removed.some(s=>/\d|certif|\bfsc\b|\biso\b|认证|证书/i.test(s)))issues.push({code:'claim_rewritten',message:'已移除或改写模型中的业务承诺；最终条款仅取有效条件记录'});
 if(!bundle.sources.length)issues.push({code:bundle.status==='retrieval_failed'?'retrieval_failed':'missing',message:bundle.status==='retrieval_failed'?'知识检索失败，草稿仅保留可确认部分':'未找到相关有效知识，草稿需补充业务依据'});
 const requestIndex=kept.findIndex(sentence=>/could you|please (?:confirm|share|provide)|to help|let us know|to (?:prepare|proceed)/i.test(sentence));
 const opening=requestIndex<0?kept:kept.slice(0,requestIndex);
 const followup=requestIndex<0?[]:kept.slice(requestIndex);
 const sections=[opening.join('\n\n'),answers.join('\n\n'),missing.length?'To confirm the remaining details:\n'+missing.map(s=>'- '+s).join('\n'):'',followup.join('\n\n')];
 if(seller)sections.push(['Best regards,',seller.senderName,seller.companyName,seller.senderEmail,seller.website].filter(Boolean).join('\n'));
 const bodyText=sections.filter(Boolean).join('\n\n').slice(0,20000)||'Thank you for your inquiry. We need to confirm the relevant details before making a business commitment.';
 const blocking=issues.some(i=>!['claim_rewritten'].includes(i.code));
 return {bodyText,review:{version:1,projectId:bundle.projectId,taskType:options.taskType,generatedAt:new Date().toISOString(),
  status:conflicts.size?'conflict':bundle.status,completeness:blocking?'partial':'complete',sources:bundle.sources,claims,questions,issues,
  context:{customerId:options.customerId,mailId:options.mailId,direction:options.direction,request:options.request},bodyHash:draftHash(bodyText)}};
}
export async function knowledgeFreshness(review:KnowledgeReview,actor:AuthUser):Promise<KnowledgeFreshness>{
 const result:KnowledgeFreshness={checkedAt:new Date().toISOString(),changed:[]};
 if(review.projectId!==String(requireProjectId(actor)))return {...result,failed:true};
 try{
  const ids=review.sources.flatMap(s=>s.knowledgeId&&Types.ObjectId.isValid(s.knowledgeId)?[s.knowledgeId]:[]);
  const rows=await AgentKnowledge.find({projectId:requireProjectId(actor),_id:{$in:ids}});
  for(const source of review.sources){
   if(source.knowledgeId){
    const row=rows.find(k=>k.id===source.knowledgeId);const revision=row?.revisions.find(v=>v.version===row.approvedVersion);
    const reason=revision?.accessScope==='admins'&&actor.role!=='admin'?'依据访问范围已变化':!row?'依据已不可用':row.archived?'依据已停用':row.approvedVersion!==source.version?'已发布新版本':!revisionActive(revision)?'依据已失效':'';
    if(reason)result.changed.push({sourceId:source.sourceId,title:source.title,reason});
   }else if(source.quotationId){
    if(!review.context.customerId){result.changed.push({sourceId:source.sourceId,title:source.title,reason:'缺少客户范围'});continue;}
    await getCustomerByIdOrThrow(review.context.customerId,actor);
    const q=await Quotation.findOne({_id:source.quotationId,projectId:requireProjectId(actor),customerId:review.context.customerId,status:'accepted',validityDate:{$gt:new Date()}});
    if(!q||q.version!==source.version)result.changed.push({sourceId:source.sourceId,title:source.title,reason:'客户报价已变化或失效'});
   }
  }
  return result;
 }catch{return {...result,failed:true};}
}
