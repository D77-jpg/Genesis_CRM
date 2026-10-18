import {createHash} from 'node:crypto';
import {Schema,model} from 'mongoose';
import {z} from 'zod';
import {AgentKnowledge,type KnowledgeRevision} from '../../models/AgentKnowledge';
import {KnowledgeDocument,KnowledgeChunk} from '../../models/KnowledgeDocument';
import {KnowledgeIndexState,KnowledgeIndexGeneration} from '../../models/KnowledgeIndex';
import {requireProjectId} from '../../utils/access';
import {ApiError} from '../../utils/ApiError';
import type {AuthUser} from '../../types/express';
import {getKnowledgeHistory,revisionActive} from './knowledge.service';
import {knowledgeIndexChanged} from '../knowledge/index.service';
import {getLetter} from '../letter.service';
import {knowledgeFreshness} from './knowledge-grounding';
const Preview=model('KnowledgeGovernancePreview',new Schema({projectId:Schema.Types.ObjectId,actorId:Schema.Types.ObjectId,expiresAt:Date,items:[{_id:false,id:String,version:Number,title:String}],results:[{_id:false,id:String,state:String}]},{timestamps:true}).index({expiresAt:1},{expireAfterSeconds:0}));
const admin=(actor:AuthUser)=>{if(actor.role!=='admin')throw ApiError.forbidden('仅项目管理员可维护知识');return requireProjectId(actor);};
export const bulkInput=z.object({ids:z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(20)}).strict();
const normalize=(v:string)=>v.toLowerCase().replace(/\s+/g,' ').trim();
export function publicationWarnings(v:KnowledgeRevision){
 const warnings:string[]=[];
 if(!v.applicability||!v.source||!v.validFrom)warnings.push('缺少适用条件、来源或生效时间');
 for(const t of v.terms??[])if(t.mode==='confirmed'&&!t.scope?.reviewed)warnings.push('已确认条件尚未完成范围审核：'+t.topic);
 if(v.category==='compliance'&&(!v.products?.length||!v.validUntil))warnings.push('合规资料缺少适用产品或有效期');
 for(const t of v.terms??[])if(t.topic==='certification'&&t.mode==='confirmed'&&(!t.scope?.certificate?.products.length||!t.scope.certificate.validUntil))warnings.push('认证条件缺少证书覆盖范围或有效期');
 return [...new Set(warnings)];
}
export async function governanceOverview(actor:AuthUser){
 const projectId=admin(actor);const records=await AgentKnowledge.find({projectId}).sort({_id:1}).limit(501).lean();
 const truncated=records.length>500;const rows=records.slice(0,500);
 const [documents,state]=await Promise.all([KnowledgeDocument.find({projectId}).select('_id').limit(501),KnowledgeIndexState.findOne({projectId}).lean()]);
 const generation=state?.activeGeneration?await KnowledgeIndexGeneration.findOne({_id:state.activeGeneration,projectId}).lean():null;
 const alerts:{id:string;kind:string;message:string;relatedId?:string}[]=[];const hashes=new Map<string,string>();
 const publications: {id:string;v:KnowledgeRevision}[]=[];
 for(const row of rows){const v=row.revisions.find(x=>x.version===row.approvedVersion)??row.revisions.at(-1);if(!v)continue;
  const id=String(row._id);if(!row.archived){for(const message of publicationWarnings(v))alerts.push({id,kind:'review',message});
   if(v.validUntil&&v.validUntil<=new Date(Date.now()+30*86400000))alerts.push({id,kind:'expiry',message:v.validUntil<=new Date()?'已过期，请替换或停用':'将在30天内到期，请重新确认'});
   const hash=createHash('sha256').update(normalize(v.content)).digest('hex');const duplicate=hashes.get(hash);if(duplicate)alerts.push({id,kind:'duplicate',relatedId:duplicate,message:'正文与另一条资料相同，请核对范围后决定是否保留'});else hashes.set(hash,id);
   if(revisionActive(v))publications.push({id,v});
  }
 }
 // Potential conflicts are advisory, never adjudicate business truth or replace S4 applicability checks.
 const terms=new Map<string,{id:string;value:string}[]>();
 for(const {id,v} of publications)for(const t of v.terms??[]){if(t.mode!=='confirmed')continue;const key=JSON.stringify([t.topic,(v.products??[]).map(normalize).sort(),normalize(t.conditions),t.scope??null]);const value=JSON.stringify([normalize(t.value),t.unit,t.currency,t.min,t.max]);const group=terms.get(key)??[];const conflict=group.find(x=>x.id!==id&&x.value!==value);if(conflict)alerts.push({id,kind:'conflict',relatedId:conflict.id,message:'同类产品和条件存在不同政策值，请业务负责人确认'});group.push({id,value});terms.set(key,group);}
 return {truncated,documentCount:documents.length,alerts,index:{status:state?.pendingGeneration?'updating':generation?.state==='ready'?'needs_verification':'not_ready',message:state?.pendingGeneration?'正在准备最新检索资料':generation?.state==='ready'?'已有索引，请在检索准备页核验当前版本':'尚未准备检索资料'},publicationCount:publications.length};
}
export async function versionDiff(id:string,from:number,to:number,actor:AuthUser){
 admin(actor);const {revisions}=await getKnowledgeHistory(id,actor);const a=revisions.find(v=>v.version===from),b=revisions.find(v=>v.version===to);if(!a||!b)throw ApiError.notFound('版本不存在');
 const fields=['title','content','category','tags','source','applicability','products','validFrom','validUntil','terms','accessScope','approved'] as const;
 return {from,to,changes:fields.filter(key=>JSON.stringify(a[key])!==JSON.stringify(b[key])).map(key=>({field:key,before:a[key]??null,after:b[key]??null}))};
}
export async function previewDisable(ids:string[],actor:AuthUser){
 const projectId=admin(actor);const parsed=bulkInput.parse({ids});const unique=[...new Set(parsed.ids)];
 const rows=await AgentKnowledge.find({_id:{$in:unique},projectId,archived:false});if(rows.length!==unique.length)throw ApiError.conflict('部分知识已变化或不属于当前项目，请刷新列表');
 const items=rows.map(row=>({id:row.id,version:row.version,title:row.revisions.at(-1)?.title??'知识'}));
 const p=await Preview.create({projectId,actorId:actor.id,expiresAt:new Date(Date.now()+10*60000),items,results:[]});return {id:p.id,expiresAt:p.expiresAt,items};
}
export async function commitDisable(id:string,actor:AuthUser){
 const projectId=admin(actor);const p=await Preview.findOne({_id:id,projectId,actorId:actor.id,expiresAt:{$gt:new Date()}});if(!p)throw ApiError.conflict('预览已失效，请重新预览');
 const results:{id:string;state:string}[]=[];
 for(const item of p.items){const previous=p.results.find(x=>x.id===item.id);if(previous){results.push({id:item.id!,state:previous.state!});continue;}
  const saved=await AgentKnowledge.findOneAndUpdate({_id:item.id,projectId,version:item.version,archived:false},{$set:{archived:true,lastGovernanceOperationId:id},$inc:{version:1}},{new:true});
  const recovered=saved??await AgentKnowledge.findOne({_id:item.id,projectId,archived:true,lastGovernanceOperationId:id});
  const result={id:item.id!,state:recovered?'disabled':'changed'};results.push(result);
  await Preview.updateOne({_id:p._id,'results.id':{$ne:item.id}},{$push:{results:result}});
 }
 let indexRefreshPending=false;try{await knowledgeIndexChanged(actor);}catch{indexRefreshPending=true;}
 return {results,indexRefreshPending};
}
export async function draftEvidence(id:string,sourceId:string,actor:AuthUser){
 const letter=await getLetter(id,actor);const review=letter.knowledgeReview;if(!review)throw ApiError.notFound();
 const source=review.sources.find(s=>s.sourceId===sourceId);if(!source)throw ApiError.notFound('本稿没有使用该依据');
 // Revoke current access even though a historical snapshot exists in the draft.
 const freshness=await knowledgeFreshness(review,actor);if(freshness.failed)throw ApiError.conflict('暂时无法核对资料权限，请稍后重试');
 if(source.knowledgeId){const k=await AgentKnowledge.findOne({_id:source.knowledgeId,projectId:requireProjectId(actor)});const published=k?.revisions.find(v=>v.version===k.approvedVersion);const saved=k?.revisions.find(v=>v.version===source.version);if(actor.role!=='admin'&&saved?.accessScope==='admins')throw ApiError.notFound('无权查看该历史版本');if(!k||k.archived||!revisionActive(published)||(actor.role!=='admin'&&published?.accessScope==='admins'))throw ApiError.notFound('依据已停用、失效或无权访问');}
 const refs=source.publication?.sourceRefs??source.index?.chunks.flatMap(c=>c.sourceRefs)??[];
 const locations=[];
 for(const ref of refs.slice(0,30)){
  const doc=await KnowledgeDocument.findOne({_id:ref.documentId,projectId:requireProjectId(actor)}).lean();if(!doc)continue;
  const chunk=await KnowledgeChunk.findOne({_id:ref.chunkId,projectId:requireProjectId(actor),documentId:doc._id,parsingRevisionId:ref.parsingRevisionId}).lean();
  if(!chunk)continue;
  locations.push({documentId:String(doc._id),parsingRevisionId:String(chunk.parsingRevisionId),chunkId:String(chunk._id),name:doc.originalName,location:chunk.location,headingPath:chunk.headingPath,
   // Raw originals remain admin-only. Do not expose unpublished neighbouring text to sales.
   excerpt:actor.role==='admin'||source.content.includes(chunk.content??'')?chunk.content:source.content,excerptScope:actor.role==='admin'?'original_chunk':'published_snapshot',...(actor.role==='admin'?{originalUrl:'/knowledge?view=documents&document='+String(doc._id)+'&revision='+String(chunk.parsingRevisionId)+'&chunk='+String(chunk._id)}:{})});
 }
 await getLetter(id,actor);const after=await knowledgeFreshness(review,actor);if(after.failed||JSON.stringify(after.changed)!==JSON.stringify(freshness.changed))throw ApiError.conflict('查看期间资料权限或版本已变化，请重试');
 return {sourceId,title:source.title,version:source.version,content:source.content,applicability:source.applicability,products:source.products,validFrom:source.validFrom,validUntil:source.validUntil,changed:freshness.changed.some(c=>c.sourceId===sourceId),locations};
}
