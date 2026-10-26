import {isAnalysisOnlyRequest} from './first-outreach-intent';
import {collectConditionalEvidence,scopeSummary,normalized,type FactContext} from './conditional-facts';
import {agreementEvidence} from './customer-agreement.service';
import {CustomerAgreement} from '../../models/CustomerAgreement';
import {createHash} from 'node:crypto';
import {Types} from 'mongoose';
import {Quotation} from '../../models/Quotation';
import {AgentKnowledge} from '../../models/AgentKnowledge';
import type {AuthUser} from '../../types/express';
import {requireProjectId} from '../../utils/access';
import {getCustomerByIdOrThrow} from '../customer.service';
import {renderSignatureText,signatureName} from '../letter-signature';
import {policyTopics,productApplies,retrieveKnowledge,revisionActive} from './knowledge.service';
import type {KnowledgeBundle,KnowledgeReview,KnowledgeSource,KnowledgeTerm,KnowledgeFreshness,PolicyTopic,CustomerFactProfile} from './knowledge-types';

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
 if(/^(?:那|这|还有|那么|这个|那个|它|他们|还有呢|那这个呢|这个能做吗|能做吗|可以做吗|what about|how about|and (?:this|that)|can you (?:do|make) (?:this|that))/i.test(text.trim()))return true;
 return policyTopics(text).length>0||/开发信|询盘|邮件|写信|回复|产品|公司|工厂|write.*(?:email|letter)|reply|outreach|product|company/i.test(text);
}
// Subjects are a separate customer-facing channel. They must not smuggle a
// commitment that the verified body never made, even when they contain no digits.
export function safeGeneratedSubject(subject:string,fallback:string){
 const value=subject.normalize('NFKC').trim();
 const risky=/\b(?:guarantee(?:d)?|free|best|lowest|cheapest|exclusive|risk[- ]?free|reserve(?:d)?|stock|discount|certified|certificate|approved|iso|fsc|moq|lead time|delivery|price|quote|offer)\b|保证|免费|最低|独家|留货|现货|库存|折扣|认证|报价|价格|交期/i;
 return value.length>=8&&value.length<=90&&!/[\d€£$¥%]|USD|EUR|GBP|RMB|CNY/i.test(value)&&!risky.test(value)?value:fallback;
}
export function transformNumbersMatch(text:string,original:string){
 const numbers=(s:string)=>[...(s.match(/\d+(?:[.,]\d+)*/g)??[])].sort().join('|');
 const split=(s:string)=>s.split(/[\n。；;，,]|(?<=[.!?])\s+/).filter(Boolean);
 for(const sentence of split(text)){
  for(const topic of policyTopics(sentence)){
   const prior=split(original).filter(x=>policyTopics(x).includes(topic));
   if(!prior.length||!prior.some(x=>numbers(x)===numbers(sentence)))return false;
  }
 }
 if(numbers(text)!==numbers(original))return false;
 const tokens=(s:string)=>(s.match(/\b(?:USD|EUR|GBP|CNY|RMB|pcs|pieces|sets|kg|working days|business days|days|weeks)\b/gi)??[]).map(x=>x.toLowerCase().replace('pieces','pcs').replace('business days','working days')).sort().join('|');
 // Cross-language units need semantic review; matching explicit tokens must not be replaced with another explicit unit.
 if(tokens(text)&&tokens(original)&&tokens(text)!==tokens(original))return false;
 return true;
}
export function guardLanguageTransform(text:string,original:string){
 return transformNumbersMatch(text,original)?text:'未能确认译文保留原有数值、单位与条件，请核对原文后重试。';
}
export function isBusinessMailCommand(text:string){
 if(isAnalysisOnlyRequest(text)||/^(为什么|如何|怎么|是否)|不要.{0,6}(写|生成|准备|起草)|不用.{0,6}(写|生成|准备|起草)/.test(text))return false;
 return /^(请|帮我|给我|为|给|你帮我|麻烦|现在|先|写|生成|起草|准备|回复|please|write|draft|prepare)/i.test(text)
  &&/(写|生成|起草|准备|回复|write|draft|prepare|reply)/i.test(text)
  &&/(开发信|邮件|询盘|跟进信|样品回复|报价说明|email|letter|inquiry|quotation|follow.?up)/i.test(text);
}
function quantityOf(text:string):number|undefined{
 const m=/(?:quantity|qty|order quantity|采购数量|数量)\s*[:：=]?\s*(\d[\d,]*)|(?:^|\s)(\d[\d,]*)\s*(?:pcs|pieces|units|件)(?![a-z0-9])/i.exec(text);
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
function finishFactBundle(bundle:KnowledgeBundle,query:string,options:FactContext={}){
 bundle.factContext=factContextFromRequest(query,bundle,{...options,customerId:bundle.factContext?.customerId??options.customerId});
 bundle.facts=collectConditionalEvidence(bundle);
 return requestedPriceMissing(bundle,query);
}
export async function buildKnowledgeBundle(actor:AuthUser,query:string,options:{customerId?:string;quantity?:number;products?:string[];processes?:string[];quantityUnit?:string;ids?:string[];retrievalMode?:'bm25'|'vector'|'hybrid'|'hybrid_rerank'}={}){
 const bundle=await retrieveKnowledge(actor,query,options.ids,options.retrievalMode);
 bundle.factContext=factContextFromRequest(query,bundle,options);
 if(!options.customerId||['retrieval_failed','index_stale','index_not_ready'].includes(bundle.status))return finishFactBundle(bundle,query,options);
 // A customer's quotation can only enter their own context and only after a fresh ACL check.
 const customer=await getCustomerByIdOrThrow(options.customerId,actor);
 const quantity=options.quantity??quantityOf(query);
 bundle.factContext={...bundle.factContext,customerId:customer.id};
 try{
  const wantsAgreement=/报价|价格|单价|成交|专属|quote|quotation|pricing|accepted price|another customer|other customer|reuse/i.test(query);
  const quotes=await Quotation.find({projectId:requireProjectId(actor),customerId:customer._id,status:'accepted',validityDate:{$gt:new Date()}}).sort({updatedAt:-1}).limit(10);
  for(const q of quotes){
   const items=q.items.filter(item=>productApplies([item.productName],query)&&(!item.model||normalized(query).includes(normalized(item.model)))&&(quantity===undefined?wantsAgreement:item.quantity===quantity||(!item.model&&wantsAgreement)));
   if(!items.length||(quantity===undefined&&!wantsAgreement))continue;
   const terms:KnowledgeTerm[]=items.map(item=>{
    const exact=quantity===item.quantity;
    return {topic:'price',value:String(item.unitPrice),unit:'per piece',currency:q.currency,
     publicationIndex:q.items.indexOf(item),conditions:item.productName+'; quote quantity '+item.quantity+(quantity!==undefined&&!exact?'; requested quantity '+quantity+' — not applicable without reconfirmation':'')+'; customer '+customer.name+'; quotation '+q.quotationNo,mode:exact?'confirmed':'reference',
     scope:{reviewed:exact,measure:'amount',products:[item.productName],processes:[],quantity:{min:item.quantity,max:item.quantity,minInclusive:true,maxInclusive:true,unit:'pcs'},exclusions:[],polarity:'affirmed'}};
   });
   const conditions=terms.map(t=>t.conditions).join('; ');
   for(const [topic,value] of [['moq',q.moq],['lead_time',q.leadTime],['payment',q.paymentTerms]] as const)if(value)terms.push({topic,value,conditions,mode:'needs_confirmation'});
   if(bundle.status==='no_match')bundle.status='ready';
   bundle.sources.push({sourceId:'quotation:'+q.id+':v'+q.version,quotationId:q.id,customerId:customer.id,version:q.version,title:q.quotationNo,category:'trade',kind:'quotation',
    source:'已接受的客户专属报价',content:'For fictional customer '+customer.name+', an accepted quote covers '+items.map(i=>i.quantity+' '+i.productName+' units at '+q.currency+' '+i.unitPrice+' per piece').join('; ')+'.\nThis price cannot be used for another customer or a different quantity.',applicability:conditions,products:items.map(i=>i.productName),validFrom:q.updatedAt.toISOString(),validUntil:q.validityDate!.toISOString(),terms});
  }
  bundle.sources.push(...await agreementEvidence(customer.id,actor));
  await getCustomerByIdOrThrow(customer.id,actor); // Recheck ownership after asynchronous reads.
  return finishFactBundle(bundle,query,options);
 }catch{
  return {...bundle,status:'retrieval_failed' as const,issues:[...bundle.issues,{code:'retrieval_failed',message:'客户专属报价检索失败，不能作出报价承诺'}]};
 }
}

export function factContextFromRequest(query:string,bundle:KnowledgeBundle,options:FactContext={}):FactContext{
 const explicit=options.products;
 const products=explicit??[...new Set(bundle.sources.flatMap(s=>[...s.products,...s.terms.flatMap(t=>t.scope?.products??[])])).values()].filter(p=>productApplies([p],query));
 const route=Object.fromEntries((['origin','destination','incoterm'] as const).flatMap(key=>{const values=[...new Set(bundle.sources.flatMap(s=>s.terms.flatMap(t=>t.scope?.[key]?[t.scope[key]!]:[])))].filter(v=>normalized(query).includes(normalized(v)));return values.length===1?[[key,values[0]]]:[];}));
 const processes=options.processes??[...new Set(bundle.sources.flatMap(s=>s.terms.flatMap(t=>t.scope?.processes??[])))].filter(p=>normalized(query).includes(normalized(p)));
 const units=/\b(?:pcs|pieces|units)\b|件|个/i.test(query)?'pcs':options.quantityUnit;
 return {...route,...options,products,processes,quantity:options.quantity??quantityOf(query),quantityUnit:options.quantityUnit??units};
}
export function applicableTerms(bundle:KnowledgeBundle){
 const facts=collectConditionalEvidence(bundle);const all=facts.map(f=>({source:bundle.sources.find(s=>s.sourceId===f.sourceId)!,term:f.term}));
 const conflicts=new Set(facts.filter(f=>f.status==='conflict').map(f=>f.sourceId+':'+f.topic));
 return {terms:all.filter((_,i)=>facts[i].status==='applicable'),conflicts,all};
}
export function conditionalSentence(term:KnowledgeTerm,source:KnowledgeSource){
 const numberRange=term.min!==undefined?(term.max!==undefined&&term.max!==term.min?term.min+'–'+term.max:String(term.min)):term.value;
 const embedded=normalizeFact(numberRange);
 const value=[term.currency&&!embedded.includes(term.currency.toLowerCase())?term.currency:undefined,numberRange,term.unit&&!embedded.includes(term.unit.toLowerCase())?term.unit:undefined].filter(Boolean).join(' ')+(term.min!==undefined&&normalizeFact(term.value)!==normalizeFact(numberRange)?' (recorded policy: '+term.value+')':'');
 return labels[term.topic]+': '+(term.scope?.polarity==='denied'?'not offered — ':'')+value+(term.mode==='reference'?' (reference only; not a firm quotation)':'')+
 '. Conditions: '+term.conditions+(source.applicability&&normalizeFact(source.applicability)!==normalizeFact(term.conditions)?'; '+source.applicability:'')+(term.scope?'; '+scopeSummary(term.scope):'')+(source.customerId?'; customer-specific agreement':'')+(source.kind!=='knowledge'&&source.validUntil?'; valid until '+source.validUntil:'')+'.';
}
export function customerProfileOf(value:{name:string;company?:string;country?:string;industry?:string;interestedProducts?:string}):CustomerFactProfile{return {name:value.name,company:value.company??'',country:value.country??'',industry:value.industry??'',interestedProducts:value.interestedProducts??''};}
/** 没有联系人时不能写 "Dear there,"：这类空称呼直接决定客户第一印象 */
const GENERIC_ADDRESS = /^(?:there|sir|madam|sirs|team|all|everyone|friend|customer|sir\/madam|sir or madam)$/i;
const flatName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
/** 客户名就是公司名时（导入线索常见），不要当成联系人用。
 *  只按「完全相同」判断：同名的品牌（Niza Huang / Niza Huang Jewellery）仍然按真人称呼。*/
const recipientIsCompany = (person: string, company: string) => Boolean(person && company && flatName(person) === flatName(company));
/** 明显不像人名的：带数字、含公司/占位类词、超过三个词（多半是公司名或占位数据） */
const BUSINESS_WORD = /\b(?:inc|ltd|limited|llc|gmbh|co|corp|corporation|company|group|holdings|trading|studio|store|shop|boutique|brand|brands|design|designs|jewelry|jewellery|candle|candles|fixture|test|demo|sample|batch|customer|client|buyer|team|department)\b/i;
function looksLikePersonName(person: string): boolean {
  if (!person) return false;
  if (/\d/.test(person)) return false;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}.'\- ]*$/u.test(person)) return false;
  if (person.split(/\s+/).filter(Boolean).length > 3) return false;
  return !BUSINESS_WORD.test(person);
}
/** 称呼里可用的联系人名字：有真人联系人时返回 First Name，否则空字符串 */
export function salutationName(recipientName?: string | null, companyName?: string | null): string {
  const person = (recipientName ?? '').replace(/[\r\n]/g, ' ').trim();
  const company = (companyName ?? '').replace(/[\r\n]/g, ' ').trim();
  if (!person || recipientIsCompany(person, company) || !looksLikePersonName(person)) return '';
  const first = person.split(/\s+/).filter(Boolean)[0] ?? '';
  return GENERIC_ADDRESS.test(first) ? '' : first;
}
/**
 * 称呼一句话：有联系人 → Dear First,；只有公司 → Dear {Company} team,；都没有 → Hello,
 * （原来直接拿 customerName 拼，客户名等于公司名时就出现 "Dear ScentSational,"，
 *   模型自己写 "Dear there," 时更是直接发出去。）
 */
export function salutationFor(recipientName?: string | null, companyName?: string | null): string {
  const personName = salutationName(recipientName, companyName);
  if (personName) return 'Dear ' + personName + ',';
  const brand = ((companyName ?? '').replace(/[\r\n]/g, ' ').trim()
    || (recipientName ?? '').replace(/[\r\n]/g, ' ').trim());
  // 公司名本身已带 team / group / inc 之类后缀时，不再重复加 team
  if (brand && !GENERIC_ADDRESS.test(brand)) return 'Dear ' + brand + (/\b(?:team|group|inc|ltd|limited|llc|gmbh|co|corp|corporation|company|holdings|brands)\b\.?$/i.test(brand) ? ',' : ' team,');
  return 'Hello,';
}
export interface GroundedEmailOptions {
  // Paragraphs that already passed claim checking; they replace the generic opening.
  verifiedProse?: string;
 knownRequirements?:{quantity?:number;quantityUnit?:string;destination?:string};
 customerWebsites?:import('./knowledge-types').CustomerWebsiteSnapshot[];
 customerProfile?:CustomerFactProfile;
 taskType:string;recipientName?:string;customerId?:string;mailId?:string;direction?:'inbound'|'outbound';request?:string;
 customerEvidence?:string;questions?:string[];seller?:{companyName:string;senderName:string;senderEmail?:string;website?:string};
}
// Conservative whole-message rendering is the bounded fallback, not a chain of regex deletions.
// The original model message is retained only by the independent semantic verifier below.
export function auditGroundedEmail(body:string,bundle:KnowledgeBundle,options:GroundedEmailOptions):{bodyText:string;review:KnowledgeReview}{
 const issues=[...bundle.issues];const facts=collectConditionalEvidence(bundle);
 const blocked=['retrieval_failed','index_stale','index_not_ready'].includes(bundle.status);
 const claims:KnowledgeReview['claims']=[];const questions:KnowledgeReview['questions']=[];
 const answers:string[]=[];const missing:string[]=[];let remaining=14000;
 for(const topic of bundle.topics){
  const rows=facts.filter(f=>f.topic===topic);const matches=blocked?[]:rows.filter(f=>f.status==='applicable');
  const conflict=rows.some(f=>f.status==='conflict');
  if(conflict)issues.push({code:'conflict',topic,message:'有效来源对同一请求给出不兼容条款，需人工确认：'+labels[topic],sourceIds:rows.filter(f=>f.status==='conflict').map(f=>f.sourceId)});
  if(matches.length&&!conflict){
   const included:string[]=[];let limited=false;
   for(const fact of matches){const source=bundle.sources.find(s=>s.sourceId===fact.sourceId)!;const text=conditionalSentence(fact.term,source);if(text.length>remaining){limited=true;continue;}remaining-=text.length;answers.push(text);claims.push({text,topic,sourceIds:[source.sourceId]});included.push(source.sourceId);}
   if(limited){issues.push({code:'fact_budget',topic,message:'完整条件超出单稿范围，请拆分审核；未截断条件'});missing.push(ask[topic]);}
   questions.push({question:labels[topic],topic,status:limited?'unanswered':'answered',sourceIds:[...new Set(included)]});
  }else{
   missing.push(ask[topic]);questions.push({question:labels[topic],topic,status:'unanswered',sourceIds:[]});
   issues.push({code:conflict?'conflict':rows.some(f=>f.status==='expired')?'expired':'missing',topic,message:'待确认：'+labels[topic]+(rows.length?'；'+[...new Set(rows.flatMap(f=>f.reasons))].join('；'):''),sourceIds:rows.map(f=>f.sourceId)});
  }
 }
 for(const question of options.questions??[])if(!policyTopics(question).length){questions.push({question,status:'unanswered',sourceIds:[]});issues.push({code:'unanswered',message:'该问题需要进一步核对：'+question});}
 if(body.trim())issues.push({code:'claim_rewritten',message:'原生成稿未经过完整语义支持检查；已使用有依据的条件答复，原文未直接放行'});
 if(!bundle.sources.length)issues.push({code:bundle.status==='retrieval_failed'?'retrieval_failed':'missing',message:'尚无可用业务依据；请补充或恢复检索后再审核'});
 const seller=options.seller;
 const recipient=options.recipientName?.replace(/[\r\n]/g,' ').trim().slice(0,100);
 const outreach=options.taskType==='first_outreach';
 const intro=options.verifiedProse??(options.taskType==='quotation_explanation'?'Here are the quotation details available for review and any points still requiring confirmation.':options.taskType==='sample_reply'?'Here is the available information for your sample request.':options.taskType==='followup_review'?'I wanted to check whether you have any updates on your current requirements.':undefined);
 const asked=/[?？]\s*$/.test((options.verifiedProse??'').trim());
 const sections=[salutationFor(recipient,options.customerProfile?.company),intro??(outreach?'I am reaching out to introduce our team and see whether we could help with your requirements.':answers.length?'Thank you for getting in touch. Here are the details for the scope below.':'Thank you for getting in touch. We would be happy to review your requirements.'),
 answers.join('\n\n'),missing.length?'To confirm the remaining details:\n'+missing.map(x=>'- '+x).join('\n'):'',
 // 模型自己已经用提问收尾时（asked），不再补模板问句，否则一封信念出两个问题
 outreach?(asked?'':'Would it help if I sent a few options that fit your product line?'):options.knownRequirements?.quantity!==undefined?'We will review the remaining points and confirm the details with you.':'Could you please confirm your final specifications so we can agree on the next step?',
 seller?renderSignatureText(signatureName(seller.senderName,seller.companyName)):''];
 const bodyText=sections.filter(Boolean).join('\n\n');
 const checks=claims.map((c,i)=>({id:'f'+i,text:c.text,status:'supported' as const,sourceIds:c.sourceIds,reason:'仅使用适用的已审核结构化条件；数值、单位和完整条件由服务端呈现'}));
 return {bodyText,review:{version:1,projectId:bundle.projectId,taskType:options.taskType,generatedAt:new Date().toISOString(),
 status:facts.some(f=>f.status==='conflict')?'conflict':bundle.status,completeness:issues.some(i=>i.code!=='claim_rewritten')?'partial':'complete',sources:bundle.sources,claims,questions,issues,
 context:{customerWebsites:options.customerWebsites,customerProfile:options.customerProfile,factContext:bundle.factContext,customerId:options.customerId,mailId:options.mailId,direction:options.direction,request:options.request},bodyHash:draftHash(bodyText),factAudit:{contract:'s4.1',mode:'deterministic',attempts:0,checks,facts}}};
}
export async function knowledgeFreshness(review:KnowledgeReview,actor:AuthUser):Promise<KnowledgeFreshness>{
 const result:KnowledgeFreshness={checkedAt:new Date().toISOString(),changed:[]};
 if(review.projectId!==String(requireProjectId(actor)))return {...result,failed:true};
 try{
  if(review.context.customerId){const customer=await getCustomerByIdOrThrow(review.context.customerId,actor);if(review.context.customerProfile&&JSON.stringify(customerProfileOf(customer))!==JSON.stringify(review.context.customerProfile))result.changed.push({sourceId:'profile:'+review.context.customerId,title:'客户资料',reason:'本稿使用的客户事实已变化'});}
  if(review.context.customerWebsites?.length){
   if(!review.context.customerId)return {...result,failed:true};
   const current=await (await import('../website/research.service')).websiteCustomerEvidence(review.context.customerId,actor);
   for(const source of review.context.customerWebsites){const match=current.find(s=>s.sourceId===source.sourceId);if(!match||match.content.sha256!==source.sha256||match.content.url!==source.url||match.content.text!==source.text||match.content.collectedAt!==source.collectedAt)result.changed.push({sourceId:source.sourceId,title:'客户官网原文',reason:'官网调查快照已变化或当前不可访问，请重新生成'});}
  }
  const ids=review.sources.flatMap(s=>s.knowledgeId&&Types.ObjectId.isValid(s.knowledgeId)?[s.knowledgeId]:[]);
  const rows=await AgentKnowledge.find({projectId:requireProjectId(actor),_id:{$in:ids}});
  for(const source of review.sources){
   if(source.knowledgeId){
    const row=rows.find(k=>k.id===source.knowledgeId);const revision=row?.revisions.find(v=>v.version===row.approvedVersion);
    const reason=revision?.accessScope==='admins'&&actor.role!=='admin'?'依据访问范围已变化':!row?'依据已不可用':row.archived?'依据已停用':row.approvedVersion!==source.version?'已发布新版本':!revisionActive(revision)?'依据已失效':'';
    if(reason)result.changed.push({sourceId:source.sourceId,title:source.title,reason});
   }else if(source.agreementId){
    if(!review.context.customerId){result.changed.push({sourceId:source.sourceId,title:source.title,reason:'缺少客户范围'});continue;}
    await getCustomerByIdOrThrow(review.context.customerId,actor);
    const a=await CustomerAgreement.findOne({_id:source.agreementId,projectId:requireProjectId(actor),customerId:review.context.customerId,disabled:false});
    const v=a?.revisions.find(x=>x.version===a.approvedVersion&&x.approved&&x.validFrom<=new Date()&&x.validUntil>new Date());
    if(!v||v.version!==source.version)result.changed.push({sourceId:source.sourceId,title:source.title,reason:'客户约定已变化、停用或失效'});
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
