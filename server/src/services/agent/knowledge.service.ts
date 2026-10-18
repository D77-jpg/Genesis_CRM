import {factScopeInput} from './conditional-facts';
import {semanticKnowledge,knowledgeIndexChanged} from '../knowledge/index.service';
import {createHash} from 'node:crypto';
import {Types} from 'mongoose';
import {z} from 'zod';
import {AgentKnowledge,type KnowledgeRevision} from '../../models/AgentKnowledge';
import {requireProjectId} from '../../utils/access';
import type {AuthUser} from '../../types/express';
import {ApiError} from '../../utils/ApiError';
import {KNOWLEDGE_CATEGORIES,POLICY_TOPICS,type KnowledgeBundle,type KnowledgeSource,type PolicyTopic} from './knowledge-types';

export const termInput=z.object({
 scope:factScopeInput.optional(),topic:z.enum(POLICY_TOPICS),value:z.string().trim().min(1).max(1200),
 conditions:z.string().trim().min(1).max(600),unit:z.string().trim().max(60).optional(),
 currency:z.string().trim().regex(/^[A-Z]{3}$/).optional(),min:z.number().finite().optional(),max:z.number().finite().optional(),
 mode:z.enum(['reference','confirmed','needs_confirmation']).default('needs_confirmation'),
}).strict().superRefine((t,c)=>{
 if(t.min!==undefined&&t.max!==undefined&&t.min>t.max)c.addIssue({code:'custom',message:'区间下限不能大于上限'});
 if(t.mode!=='needs_confirmation'&&/^[\d\s.,–-]+$/.test(t.value)&&!t.unit)c.addIssue({code:'custom',message:'数字型条件必须注明单位或计价口径'});
 if(t.scope?.measure==='amount'&&t.mode!=='needs_confirmation'&&!t.currency)c.addIssue({code:'custom',message:'金额条件必须注明币种'});
 if(t.topic==='price'&&t.mode!=='needs_confirmation'&&!t.currency)c.addIssue({code:'custom',message:'价格必须注明币种'});
});
export const knowledgeInput=z.object({
 accessScope:z.enum(['project','admins']).default('project'),
 expectedVersion:z.number().int().min(0),title:z.string().trim().min(1).max(160),
 tags:z.array(z.string().trim().min(1).max(80)).max(20).default([]),
 content:z.string().trim().min(1).max(12000),source:z.string().trim().min(1).max(500),approved:z.boolean(),
 category:z.enum(KNOWLEDGE_CATEGORIES).default('product'),
 applicability:z.string().trim().min(1).max(1000).default('一般资料；具体产品及交易条件须核对'),
 products:z.array(z.string().trim().min(1).max(100)).max(20).default([]),
 validFrom:z.coerce.date().optional(),validUntil:z.coerce.date().optional(),terms:z.array(termInput).max(25).default([]),
}).strict().superRefine((v,c)=>{
 if(v.validUntil&&v.validUntil<=(v.validFrom??new Date()))c.addIssue({code:'custom',message:'失效时间必须晚于生效时间'});
 if(v.approved)for(const t of v.terms){
  if(t.mode==='confirmed'&&!t.scope?.reviewed)c.addIssue({code:'custom',message:'发布已确认的条件前，请完成适用范围审核；未知条件请保留待确认'});
  if(t.mode==='confirmed'&&t.topic==='certification'&&(!t.scope?.certificate?.products.length||!t.scope?.certificate?.validUntil))c.addIssue({code:'custom',message:'发布认证承诺前，请填写证书覆盖产品与有效期'});
 }
 if(v.approved&&v.category==='sales_rules'&&v.content.length>3000)c.addIssue({code:'custom',message:'基础销售规则请保持在 3000 字符以内，详细产品政策分条录入'});
 if(v.approved&&v.category==='compliance'&&(!v.products.length||!v.validUntil))c.addIssue({code:'custom',message:'发布合规资料前请填写适用产品和证书有效期'});
});
export type KnowledgeInput=z.input<typeof knowledgeInput>;
function admin(actor:AuthUser){if(actor.role!=='admin')throw ApiError.forbidden('知识由项目管理员编辑、审核和发布');}
export async function appendKnowledge(id:string|undefined,input:KnowledgeInput,actor:AuthUser,importKey?:string,sourceRefs?:Record<string,unknown>[]){
 admin(actor);const projectId=requireProjectId(actor);const parsed=knowledgeInput.parse(input);const version=parsed.expectedVersion+1;
 if(version>100)throw ApiError.conflict('请停用后建立新的知识条目');
 const revision={accessScope:parsed.accessScope,...(sourceRefs?{sourceRefs}:{}),version,title:parsed.title,tags:parsed.tags,content:parsed.content,source:parsed.source,approved:parsed.approved,
 category:parsed.category,applicability:parsed.applicability,products:parsed.products,validFrom:parsed.validFrom??new Date(),
 validUntil:parsed.validUntil,terms:parsed.terms,createdBy:new Types.ObjectId(actor.id),createdAt:new Date()};
 if(id&&!Types.ObjectId.isValid(id))throw ApiError.notFound('知识不存在');
 if(id){
  const previous=await AgentKnowledge.findOne({_id:id,projectId,version:parsed.expectedVersion});
  const prior=previous?.revisions.find(v=>v.version===parsed.expectedVersion);
  if(!sourceRefs)revision.sourceRefs=prior?.sourceRefs;
  // A legacy editor omitting the new ACL field must never broaden a private publication.
  if(input.accessScope===undefined)revision.accessScope=prior?.accessScope??'project';
 }
 if(!id){if(parsed.expectedVersion!==0)throw ApiError.conflict('新知识版本必须从 1 开始');
 const created=await AgentKnowledge.create({projectId,version,approvedVersion:parsed.approved?version:0,revisions:[revision],...(importKey?{importKey}:{})});if(parsed.approved)await knowledgeIndexChanged(actor).catch(()=>undefined);return created.id;}
 if(!Types.ObjectId.isValid(id))throw ApiError.notFound('知识不存在');
 const saved=await AgentKnowledge.findOneAndUpdate({_id:id,projectId,version:parsed.expectedVersion,archived:false},
 {$set:{version,...(parsed.approved?{approvedVersion:version}:{})},$push:{revisions:revision}},{new:true,runValidators:true});
 if(!saved)throw ApiError.conflict('知识已变化或已停用，请重新载入');if(parsed.approved)await knowledgeIndexChanged(actor).catch(()=>undefined);return saved.id;
}
export function revisionActive(v:KnowledgeRevision|undefined,at=new Date()):boolean{
 return !!v?.approved&&!!v.validFrom&&v.validFrom<=at&&(!v.validUntil||v.validUntil>at);
}
export async function listKnowledge(actor:AuthUser){
 const rows=await AgentKnowledge.find({projectId:requireProjectId(actor),...(actor.role==='admin'?{}:{archived:false,approvedVersion:{$gt:0}})}).sort({updatedAt:-1}).limit(500);
 return rows.flatMap(k=>{
  const published=k.revisions.find(v=>v.version===k.approvedVersion);
  if(actor.role!=='admin'&&(!revisionActive(published)||published?.accessScope==='admins'))return [];
  return [{id:k.id,projectId:String(k.projectId),version:k.version,approvedVersion:k.approvedVersion,archived:k.archived,
   status:k.archived?'disabled':k.approvedVersion?'published':'draft',effective:!k.archived&&revisionActive(published),
   hasDraft:k.version>k.approvedVersion,updatedAt:k.updatedAt,
   revisions:actor.role==='admin'?k.revisions.filter(v=>v.version===k.version||v.version===k.approvedVersion):k.revisions.filter(v=>v.approved&&v.version===k.approvedVersion)}];
 });
}
export async function archiveKnowledge(id:string,version:number,actor:AuthUser){
 admin(actor);if(!Types.ObjectId.isValid(id))throw ApiError.notFound();
 if(!(await AgentKnowledge.updateOne({_id:id,projectId:requireProjectId(actor),version,archived:false},{$set:{archived:true},$inc:{version:1}})).matchedCount)throw ApiError.conflict('知识已变化');
 await knowledgeIndexChanged(actor).catch(()=>undefined);
}
const topicPatterns:Record<PolicyTopic,RegExp>={
 moq:/\bmoq\b|minimum\s+(?:order|quantity)|起订|最低订|最小订单/i,
 lead_time:/lead.?time|delivery|turnaround|dispatch|ship in|\b\d+(?:-\d+)?\s*(?:working\s+|business\s+)?days?\b|生产周期|交期|交货|到货/i,
 sample:/sample|prototype|样品|打样/i,price:/\bprice|pricing|cost|quotation|quote|discount|(?:[$€£¥]\s*\d)|(?:USD|EUR|GBP|CNY|RMB)\s*\d|报价|价格|单价|费用|折扣/i,
 shipping:/shipping|ship |freight|logistic|运费|运输|物流/i,payment:/payment|deposit|\bt\/t\b|付款|定金|支付/i,
 certification:/certif|\bfsc\b|\biso\b|\bbsci\b|合规|证书|认证/i,
 trade_terms:/incoterm|\bfob\b|\bexw\b|\bcif\b|贸易条款/i,capacity:/capacity|产能|工厂面积|factory size/i,other:/$a/,
};
export function policyTopics(text:string):PolicyTopic[]{
 const relevant=text.replace(/(?:不要提|不提|不用提|不主动加入|do not mention|don't mention|without mentioning)[^，。；\n]{0,80}/gi,'');
 return POLICY_TOPICS.filter(t=>t!=='other'&&topicPatterns[t].test(relevant));
}
const synonyms=[['珠宝','首饰','jewelry','jewellery'],['盒','包装','box','boxes','packaging'],['袋','pouch','pouches','bag','bags'],['绒布','velvet'],['健身','fitness','gym'],['样品','sample'],['起订','moq'],['交期','delivery','lead time']];
function words(text:string):string[]{
 const lower=text.toLocaleLowerCase();const tokens:string[]=lower.match(/[a-z0-9][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g)??[];
 for(const group of synonyms)if(group.some(w=>lower.includes(w)))tokens.push(...group);
 return [...new Set(tokens)].slice(0,80);
}
export function productApplies(products:string[]|undefined,text:string):boolean{
 if(!products?.length)return true;
 const normalize=(value:string)=>value.toLowerCase().replace(/jewellery|jewelry|珠宝|首饰/g,' jewelry ')
  .replace(/velvet|绒布|天鹅绒/g,' velvet ').replace(/satin|缎面/g,' satin ').replace(/cotton|棉布/g,' cotton ')
  .replace(/nylon|尼龙/g,' nylon ').replace(/zipper|拉链/g,' zipper ').replace(/travel|旅行/g,' travel ').replace(/drawstring|抽绳/g,' drawstring ').replace(/fitness|gym|健身/g,' fitness ')
  .replace(/pouches|pouch|bags|bag|袋/g,' pouch ').replace(/boxes|box|盒/g,' box ');
 const haystack=normalize(text);
 return products.some(product=>{
  if(['*','通用','general','all'].includes(product.toLowerCase()))return true;
  const tokens=normalize(product).match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g)??[];
  return tokens.length>0&&tokens.every(token=>haystack.includes(token));
 });
}
export function sourceOf(id:string,v:KnowledgeRevision):KnowledgeSource{
 return {sourceId:'knowledge:'+id+':v'+v.version,knowledgeId:id,version:v.version,title:v.title,
 category:v.category??'product',kind:'knowledge',content:v.content,source:v.source,publication:{contentHash:createHash('sha256').update(v.content).digest('hex'),location:{kind:'published_text',offsetUnit:'unicode_codepoints',start:0,end:Array.from(v.content).length},sourceRefs:v.sourceRefs??[]},
 applicability:v.applicability??'历史资料，适用条件需审核',products:v.products??[],
 validFrom:v.validFrom?.toISOString()??'',validUntil:v.validUntil?.toISOString(),terms:(v.terms??[]).map((t,publicationIndex)=>({...JSON.parse(JSON.stringify(t)),publicationIndex}))};
}
export async function retrieveKnowledge(actor:AuthUser,query:string,ids?:string[],mode?:'bm25'|'vector'|'hybrid'|'hybrid_rerank'):Promise<KnowledgeBundle>{
 if(process.env.KNOWLEDGE_RETRIEVAL_MODE!=='keyword')return semanticKnowledge(actor,query,{topics:policyTopics(query),productApplies,sourceOf,ids,mode});
 return retrieveKeywordKnowledge(actor,query,ids);
}
// Explicit compatibility/baseline path, never automatic fallback after semantic failure.
export async function retrieveKeywordKnowledge(actor:AuthUser,query:string,ids?:string[]):Promise<KnowledgeBundle>{
 const projectId=String(requireProjectId(actor));const topics=policyTopics(query);const bundle:KnowledgeBundle={projectId,status:'no_match',sources:[],issues:[],topics,retrieval:{engine:'keyword'}};
 try{
  // Both project and published-state are enforced here, never accepted from model arguments.
  const rows=await AgentKnowledge.find({projectId:new Types.ObjectId(projectId),approvedVersion:{$gt:0}}).sort({_id:1}).limit(1000);
  const tokens=words(query);const candidates=rows.flatMap(k=>{
   const v=k.revisions.find(r=>r.version===k.approvedVersion&&r.approved);if(!v||(actor.role!=='admin'&&v.accessScope==='admins'))return [];
   const haystack=[v.title,...v.tags,v.content,v.applicability??'',...(v.products??[])].join(' ').toLocaleLowerCase();
   const score=tokens.reduce((n,w)=>n+(haystack.includes(w)?(v.title.toLowerCase().includes(w)?4:1):0),0)
    +(ids?.includes(k.id)?100:0)+(v.terms?.some(t=>topics.includes(t.topic))?3:0);
   const base=v.category==='sales_rules';
   const general=v.tags.some(t=>['*','通用','general'].includes(t));
   if(!base&&!score&&!general)return [];
   if(k.archived||!revisionActive(v)){
    if(score||base)bundle.issues.push({code:k.archived?'disabled':!v.validFrom?'unverified':v.validFrom>new Date()?'not_effective':'expired',
     message:(k.archived?'资料已停用：':!v.validFrom?'历史资料缺少生效信息：':v.validFrom>new Date()?'资料尚未生效：':'资料已过期：')+v.title,sourceIds:['knowledge:'+k.id+':v'+v.version]});
    return [];
   }
   if(!productApplies(v.products,query)){if(score)bundle.issues.push({code:'conditions',message:'需确认适用产品：'+v.title});return [];}
   const source=sourceOf(k.id,v);
   if(base)source.content=v.content;
   source.terms=source.terms.filter(term=>topics.includes(term.topic)).slice(0,8);
   return [{source,score,base}];
  });
  const base=candidates.filter(c=>c.base);if(base.length>4)bundle.issues.push({code:'rules_limit',message:'基础销售规则超过单次加载上限，请合并或补充查询'});
  bundle.sources=[...base.slice(0,4),...candidates.filter(c=>!c.base).sort((a,b)=>b.score-a.score).slice(0,6)].map(c=>c.source);
  // Large source sets are explicitly partial, never silently treated as an exhaustive answer.
  if(rows.length===1000)bundle.issues.push({code:'search_limit',message:'知识量超过首版检索范围，请缩小关键词或拆分项目资料'});
  bundle.status=bundle.sources.length?'ready':bundle.issues.some(i=>i.code==='expired')?'expired':'no_match';
  return bundle;
 }catch{
  return {...bundle,status:'retrieval_failed',sources:[],issues:[{code:'retrieval_failed',message:'知识检索暂时失败，不能据此作出交易承诺'}]};
 }
}
// Compatibility surface for existing tools/batch selectors. Validity and project scope share one implementation.
export async function searchProductKnowledge(actor:AuthUser,query:string,ids?:string[]){
 const result=await retrieveKnowledge(actor,query,ids);
 return result.sources.map(s=>({...s,knowledgeId:s.knowledgeId!,approved:true}));
}
export const importPreviewInput=z.object({fileName:z.string().min(1).max(180),content:z.string().min(1).max(180000),
 category:z.enum(KNOWLEDGE_CATEGORIES),source:z.string().trim().min(1).max(500)}).strict();
export function previewKnowledgeImport(input:z.infer<typeof importPreviewInput>){
 const parsed=importPreviewInput.parse(input);
 if(!/\.(?:txt|md|markdown)$/i.test(parsed.fileName))throw ApiError.badRequest('仅支持 TXT 和 Markdown');
 if(parsed.content.includes('\u0000'))throw ApiError.badRequest('请使用 UTF-8 纯文本资料');
 const sections=parsed.content.replace(/^\uFEFF/,'').split(/(?=^#{1,3}\s+)/m).filter(s=>s.trim());
 const entries:KnowledgeInput[]=[];const headings:{level:number;title:string}[]=[];
 for(const section of sections){
  const lines=section.trim().split('\n');const heading=/^(#{1,3})\s+(.+)/.exec(lines[0]??'');
  if(heading){while(headings.length&&headings.at(-1)!.level>=heading[1].length)headings.pop();headings.push({level:heading[1].length,title:heading[2]});}
  const title=(headings.map(h=>h.title).join(' / ')||parsed.fileName).slice(0,140);
  for(let i=0;i<section.length;i+=11000)entries.push({expectedVersion:0,approved:false,title:title+(section.length>11000?'（分段 '+(i/11000+1)+'）':''),
   category:parsed.category,tags:[],products:[],applicability:'导入资料；发布前核对适用产品、条件和时效',content:section.slice(i,i+11000).trim(),
   source:parsed.source,terms:[]});
 }
 if(entries.length>60)throw ApiError.badRequest('单次最多导入 60 条，请拆分文件');
 return {entries,warnings:['导入仅保存为草稿。发布前请核实来源、适用范围、有效期和条件记录；示例价格及建议不能直接作为政策。']};
}
export const importCommitInput=z.object({entries:z.array(knowledgeInput).min(1).max(60)}).strict();
export async function importKnowledge(entries:KnowledgeInput[],actor:AuthUser){
 admin(actor);const projectId=requireProjectId(actor);const parsed=importCommitInput.parse({entries});
 const result:{id:string;created:boolean}[]=[];
 for(const raw of parsed.entries){
  const entry={...raw,approved:false,expectedVersion:0};
  const hash=createHash('sha256').update(JSON.stringify({...entry,validFrom:undefined})).digest('hex');
  const old=await AgentKnowledge.findOne({projectId,importKey:hash}).select('_id');
  if(old){result.push({id:old.id,created:false});continue;}
  try{result.push({id:await appendKnowledge(undefined,entry,actor,hash),created:true});}
  catch(e){if((e as {code?:number}).code!==11000)throw e;const raced=await AgentKnowledge.findOne({projectId,importKey:hash});if(!raced)throw e;result.push({id:raced.id,created:false});}
 }
 return {items:result,created:result.filter(r=>r.created).length,skipped:result.filter(r=>!r.created).length};
}

export async function getKnowledgeHistory(id:string,actor:AuthUser){
 if(!Types.ObjectId.isValid(id))throw ApiError.notFound();
 const row=await AgentKnowledge.findOne({_id:id,projectId:requireProjectId(actor)});
 if(!row)throw ApiError.notFound('知识不存在或无权访问');
 if(actor.role!=='admin'){
  const published=row.revisions.find(v=>v.version===row.approvedVersion);
  if(row.archived||!revisionActive(published)||published?.accessScope==='admins')throw ApiError.notFound('知识当前不可用');
  return {revisions:published?[published]:[]};
 }
 return {revisions:row.revisions};
}
