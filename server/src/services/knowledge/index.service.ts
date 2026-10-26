import {randomUUID} from 'node:crypto';
import mongoose,{Types,type HydratedDocument} from 'mongoose';
import {AgentKnowledge,type KnowledgeRevision} from '../../models/AgentKnowledge';
import {KnowledgeIndexState as State,KnowledgeIndexGeneration as Gen,KnowledgeIndexItem as Item} from '../../models/KnowledgeIndex';
import {User} from '../../models/User';
import {Project} from '../../models/Project';
import type {AuthUser} from '../../types/express';
import {requireProjectId} from '../../utils/access';
import {ApiError} from '../../utils/ApiError';
import {embeddingIdentity,IndexError,localEmbedding,sha,type SemanticAdapter} from './embedding';
import type {IndexIdentity,IndexState} from '../../models/KnowledgeIndex';
import type {KnowledgeBundle,KnowledgeSource} from '../agent/knowledge-types';
import {boundedRefs} from '../agent/knowledge-types';

type Published={id:string;version:number;revision:KnowledgeRevision};
const valid=(v:KnowledgeRevision,now=new Date())=>v.approved&&v.validFrom&&v.validFrom<=now&&(!v.validUntil||v.validUntil>now);
const objectId=(value:string)=>{if(!Types.ObjectId.isValid(value))throw ApiError.notFound();return new Types.ObjectId(value);};
const requireAdmin=(actor:AuthUser)=>{if(actor.role!=='admin')throw ApiError.forbidden('请项目管理员管理知识索引');};
export async function indexActor(actor:AuthUser):Promise<AuthUser>{
 const projectId=requireProjectId(actor);
 const [u,p]=await Promise.all([User.findById(objectId(actor.id)).maxTimeMS(5000),Project.findById(projectId).maxTimeMS(5000)]);
 if(!u||u.status==='disabled'||p?.status!=='active'||(u.role!=='admin'&&!u.projectIds.some(id=>String(id)===String(projectId))))throw ApiError.notFound('项目或知识权限已变化');
 return {...actor,role:actor.role==='admin'&&u.role==='admin'?'admin':'user'};
}
async function published(projectId:string){
 const docs=await AgentKnowledge.aggregate<{_id:Types.ObjectId;approvedVersion:number;revisions:KnowledgeRevision[]}>([{$match:{projectId:objectId(projectId),approvedVersion:{$gt:0},archived:false}},{$sort:{_id:1}},{$limit:10001},{$project:{approvedVersion:1,revisions:{$filter:{input:'$revisions',as:'v',cond:{$eq:['$$v.version','$approvedVersion']}}}}}]).option({maxTimeMS:5000});
 if(docs.length>10000)throw new IndexError('publication_limit','首版支持每项目最多 10000 条已发布知识，请拆分项目资料');
 const rows:Published[]=docs.flatMap(k=>{const revision=k.revisions.find(v=>v.version===k.approvedVersion);return revision&&valid(revision)?[{id:String(k._id),version:k.approvedVersion,revision}]:[];});
 // Full effective revision + ACL + provenance: changes bypassing normal CRUD are also detected.
 const manifest=sha(JSON.stringify(rows.map(r=>[r.id,r.version,r.revision])));
 return {rows,manifest};
}
async function diagnosticMetadata(projectId:string,actor:AuthUser,query='',topics:KnowledgeBundle['topics']=[]){
 const inactive=await AgentKnowledge.find({projectId,$or:[{archived:true},{approvedVersion:0},{'revisions.validUntil':{$lte:new Date()}},{'revisions.validFrom':{$gt:new Date()}}]}).select('approvedVersion version archived revisions.version revisions.title revisions.validFrom revisions.validUntil revisions.accessScope revisions.category').sort({_id:1}).limit(10001).lean();
 return inactive.flatMap(k=>{
   const v=k.revisions.find(v=>v.version===(k.approvedVersion||k.version));
   if(!v||(!k.approvedVersion&&actor.role!=='admin')||(v.accessScope==='admins'&&actor.role!=='admin'))return [];
   const specificNonCompliance=!topics.includes('certification')&&(topics.length>0||/材料|材质|工艺|涂层|结构|material|coating|finish|construction/i.test(query));
   if(v.category==='compliance'&&specificNonCompliance)return [];
   const code=k.archived?'disabled':!k.approvedVersion?'draft_only':v.validFrom&&v.validFrom>new Date()?'not_effective':v.validUntil&&v.validUntil<=new Date()?'expired':null;
   return code?[{code,sourceId:'knowledge:'+String(k._id)+':v'+v.version,title:v.title}]:[];
  });
}
function visible(row:Published,actor:AuthUser){return row.revision.accessScope!=='admins'||actor.role==='admin';}
async function init(){await Promise.all([State.init(),Gen.init(),Item.init()]);}
async function withSwitch<T>(projectId:string,fn:(state:HydratedDocument<IndexState>)=>Promise<T>):Promise<T>{
 const token=randomUUID();
 let state;for(let attempt=0;attempt<15;attempt++){state=await State.findOneAndUpdate({projectId,$or:[{switchUntil:{$exists:false}},{switchUntil:{$lt:new Date()}}]},{$set:{switchToken:token,switchUntil:new Date(Date.now()+30000)}},{new:true});if(state)break;await new Promise(r=>setTimeout(r,75));}
 if(!state)throw ApiError.conflict('索引状态正在更新，请稍后重试');
 try{return await fn(state);}finally{await State.updateOne({projectId,switchToken:token},{$unset:{switchToken:1,switchUntil:1}});}
}
export async function requestIndex(actor:AuthUser,requestKey='automatic'){
 const current=await indexActor(actor);requireAdmin(current);const projectId=String(requireProjectId(current));await init();
 const [{manifest,rows},identity]=await Promise.all([published(projectId),embeddingIdentity()]);
 const key=sha(JSON.stringify([manifest,identity.id,requestKey]));
 await State.updateOne({projectId},{$setOnInsert:{projectId,requestedBy:current.id,enabled:true,revision:0}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
 let generation;
 try{generation=await Gen.findOneAndUpdate({projectId,key},{$setOnInsert:{projectId,key,manifest,identity,requestedBy:current.id,publications:rows.length}},{new:true,upsert:true});}
 catch(e){if((e as {code?:number}).code!==11000)throw e;generation=await Gen.findOne({projectId,key});}
 if(!generation)throw new Error('generation_insert_failed');
 if(['deleted','deleting','superseded'].includes(generation.state))throw ApiError.conflict('该任务已清理或替代，请重新发起重建');
 await withSwitch(projectId,async state=>{
  if(!await Gen.exists({_id:generation!._id,state:{$in:['queued','running','ready','failed']}}))throw ApiError.conflict('索引任务已变化，请重新发起');
  if(generation!.state==='ready'&&String(state.activeGeneration)===generation!.id)return;
  await Gen.updateMany({projectId,_id:{$ne:generation!._id},state:'queued'},{$set:{state:'superseded',error:{code:'superseded',message:'已有更新的资料准备任务'}}});
  await State.updateOne({_id:state._id,switchToken:state.switchToken},{$set:{pendingGeneration:generation!._id,enabled:true},$inc:{revision:1}});
 });
 return {id:generation.id,state:generation.state,duplicate:generation.createdAt.getTime()!==generation.updatedAt.getTime()};
}
// Best-effort outbox hint only. Read-time authority checks and periodic reconciliation close crash gaps.
export async function knowledgeIndexChanged(actor:AuthUser){
 const enabled=await State.exists({projectId:requireProjectId(actor),enabled:true});if(enabled)await requestIndex(actor);
}
async function plan(rows:Published[],generation:string,projectId:string,identity:IndexIdentity,adapter:SemanticAdapter,signal?:AbortSignal,guard?:()=>Promise<void>,skipKeys=new Set<string>()){
 const atoms=rows.filter(row=>!skipKeys.has(`${row.id}:${row.version}`)).flatMap(row=>{
  const v=row.revision;if(v.category==='sales_rules')return [];
  const context=[v.title,v.applicability??'',...(v.products??[])].filter(Boolean).join('\n');
  return [{row,body:v.content,location:{kind:'published_text',start:0,end:Array.from(v.content).length,offsetUnit:'unicode_codepoints'} as Record<string,unknown>},
   ...(v.terms??[]).map((term,index)=>({row,body:JSON.stringify(term),location:{kind:'conditional_fact',termIndex:index} as Record<string,unknown>}))]
   .map(atom=>({...atom,text:context+'\n'+atom.body}));
 });
 const items=[];let ordinal=0;
 for(let offset=0;offset<atoms.length;offset+=16){
  const segmented=await adapter.run({command:'segment',projectId,atoms:atoms.slice(offset,offset+16).map((atom,index)=>({key:String(offset+index),text:atom.text}))},identity,signal,guard);
  if(!segmented.segments)throw new IndexError('segment_failed','未生成检索片段');
  for(const window of segmented.segments){
   const atom=atoms[Number(window.key)],row=atom.row,v=row.revision,content=window.text,contentHash=sha(content),refs=v.sourceRefs??[];
   const itemId=sha(JSON.stringify([row.id,row.version,window.key,window.start,window.end,contentHash]));
   items.push({projectId:objectId(projectId),generation:objectId(generation),itemId,knowledgeId:objectId(row.id),publicationVersion:row.version,
    documentIds:refs.flatMap(r=>typeof r.documentId==='string'?[r.documentId]:[]),sourceChunkIds:refs.flatMap(r=>typeof r.chunkId==='string'?[r.chunkId]:[]),
    sourceRefs:refs,location:{...atom.location,retrievalWindow:{start:window.start,end:window.end,offsetUnit:'unicode_codepoints',includesContext:true,standaloneFact:false},parentContentHash:sha(atom.body)},ordinal:ordinal++,content,contentHash,scope:v.accessScope??'project',identity:identity.id,dimension:identity.dimension});
  }
 }
 if(items.length>50000)throw new IndexError('chunk_limit','首版支持每项目最多 50000 个发布片段，请拆分项目资料');
 return items;
}

const checksum=(items:{itemId:string;contentHash:string}[])=>sha(JSON.stringify([...items].sort((a,b)=>a.itemId.localeCompare(b.itemId)).map(i=>[i.itemId,i.contentHash])));
export async function processKnowledgeIndex(id?:string,adapter:SemanticAdapter=localEmbedding){
 const leaseToken=randomUUID(),now=new Date();
 const g=await Gen.findOneAndUpdate({...(id?{_id:objectId(id)}:{}),$or:[{state:'queued',$or:[{retryAt:{$exists:false}},{retryAt:{$lte:now}}]},{state:'running',leaseUntil:{$lt:now}}]},
  {$set:{state:'running',leaseToken,leaseUntil:new Date(Date.now()+30000)},$inc:{attempts:1}},{new:true,sort:{createdAt:1}});
 if(!g)return;
 const fence={_id:g._id,state:'running',leaseToken};const abort=new AbortController();
 const original:AuthUser={id:String(g.requestedBy),role:'admin',projectId:String(g.projectId),username:'index-task',displayName:'index-task'};
 let checking=false;
 const heartbeat=setInterval(()=>{if(checking)return;checking=true;void indexActor(original).then(a=>{
  requireAdmin(a);return Gen.updateOne(fence,{$set:{leaseUntil:new Date(Date.now()+30000)}});
 }).then(r=>{if(!r.matchedCount)abort.abort();}).catch(()=>abort.abort()).finally(()=>{checking=false;});},2000);
 try{
  if(g.attempts>3)throw new IndexError('recovery_limit','多次中断未能恢复，请检查环境后重试');
  requireAdmin(await indexActor(original));
  const identity=await embeddingIdentity();
  if(g.identity.id!==identity.id||g.identity.dimension!==identity.dimension)throw new IndexError('model_changed','模型配置已变化，请建立新索引代次');
  const snapshot=await published(String(g.projectId));
  if(snapshot.manifest!==g.manifest)throw new IndexError('publication_changed','已发布资料已变化，请使用最新重建任务');
  const guard=async()=>{requireAdmin(await indexActor(original));if((await embeddingIdentity()).id!==identity.id)throw new IndexError('model_changed','本地模型配置已变化');if(abort.signal.aborted||!await Gen.exists(fence))throw new IndexError('cancelled','权限或租约已变化');if((await published(String(g.projectId))).manifest!==g.manifest)throw new IndexError('publication_changed','已发布资料已变化');};
  const state=await State.findOne({projectId:String(g.projectId)});
  const prior=state?.activeGeneration?await Item.find({projectId:g.projectId,generation:state.activeGeneration,identity:identity.id,dimension:identity.dimension}).sort({ordinal:1}).lean():[];
  const currentKeys=new Set(snapshot.rows.map(row=>`${row.id}:${row.version}`));
  const reusable=prior.filter(item=>currentKeys.has(`${String(item.knowledgeId)}:${item.publicationVersion}`));
  let reusedItems=reusable.map(({_id,generation:_oldGeneration,...item})=>({...item,projectId:g.projectId,generation:g._id}));
  // Reuse verified windows and local vectors for unchanged publications. Only
  // added/changed publications are segmented, embedded and lexically indexed.
  let freshItems=await plan(snapshot.rows,g.id,String(g.projectId),identity,adapter,abort.signal,guard,new Set(reusable.map(item=>`${String(item.knowledgeId)}:${item.publicationVersion}`)));
  if(reusedItems.length){
   const copied=await adapter.run({command:'copy',projectId:String(g.projectId),generation:g.id,sourceGeneration:String(state!.activeGeneration),items:reusable.map(item=>item.itemId)},identity,abort.signal,guard);
   if(copied.count!==reusedItems.length){
    // Local files can be lost or an older runtime may not have copied lexical
    // rows. Fall back to a full, explicit rebuild rather than switch a
    // partially copied generation.
    reusedItems=[];freshItems=await plan(snapshot.rows,g.id,String(g.projectId),identity,adapter,abort.signal,guard);
   }
  }
  const items=[...reusedItems,...freshItems];
  if(items.length)await Item.bulkWrite(items.map(item=>({updateOne:{filter:{generation:g._id,itemId:item.itemId},update:{$setOnInsert:item},upsert:true}})));
  if(!(await Gen.updateOne(fence,{$set:{total:items.length,done:reusedItems.length},$inc:{reused:reusedItems.length}})).matchedCount)throw new IndexError('cancelled','任务已停止');
  for(let offset=0;offset<freshItems.length;offset+=16){
   if(abort.signal.aborted)throw new IndexError('cancelled','索引权限或租约已变化');
   const batch=freshItems.slice(offset,offset+16);
   const result=await adapter.run({command:'upsert',projectId:String(g.projectId),generation:g.id,
    items:batch.map(i=>({id:i.itemId,text:i.content,hash:i.contentHash,scope:i.scope,parent:String(i.knowledgeId)}))},identity,abort.signal,guard);
   if(result.count!==batch.length)throw new IndexError('incomplete_batch','本地索引批次未完整写入');
   if(!(await Gen.updateOne(fence,{$set:{done:reusedItems.length+offset+batch.length,metrics:{elapsedMs:result.elapsedMs,rssMiB:result.rssMiB}},$inc:{embedded:result.embedded??0,reused:result.reused??0}})).matchedCount)throw new IndexError('cancelled','索引租约已变化');
  }
  const verified=await adapter.run({command:'verify',projectId:String(g.projectId),generation:g.id},identity,abort.signal,guard);
  if(verified.count!==items.length||verified.checksum!==checksum(items))throw new IndexError('incomplete_generation','索引校验不完整，尚未切换');
  requireAdmin(await indexActor(original));
  if((await published(String(g.projectId))).manifest!==g.manifest)throw new IndexError('publication_changed','构建期间资料已变化，未切换旧政策');
  if(abort.signal.aborted||!await Gen.exists(fence))throw new IndexError('cancelled','索引任务已停止');
  await withSwitch(String(g.projectId),async state=>{
   if(String(state.pendingGeneration)!==g.id)throw new IndexError('superseded','已有更新的索引任务，本次不切换');
   if(!(await Gen.updateOne(fence,{$set:{state:'ready',checksum:verified.checksum,activatedAt:new Date()},$unset:{leaseToken:1,leaseUntil:1,error:1}})).matchedCount)throw new IndexError('cancelled','索引租约已变化');
   await State.updateOne({_id:state._id,switchToken:state.switchToken},{$set:{activeGeneration:g._id},$unset:{pendingGeneration:1},$inc:{revision:1}});
  });
 }catch(e){const error=e instanceof IndexError?{code:e.code,message:e.message}:{code:'index_failed',message:'索引任务未完成，请检查本地环境与权限后重试'};
  const retry=['timeout','local_runtime_failure','incomplete_batch'].includes(error.code)&&g.attempts<3;
  await Gen.updateOne(fence,{$set:{state:retry?'queued':error.code==='superseded'?'superseded':'failed',error,...(retry?{retryAt:new Date(Date.now()+g.attempts*3000)}:{})},$unset:{leaseToken:1,leaseUntil:1}});
 }finally{clearInterval(heartbeat);abort.abort();}
}
export async function indexStatus(actor:AuthUser){
 const current=await indexActor(actor);requireAdmin(current);const projectId=String(requireProjectId(actor));
 const [state,rows,identity,snapshot]=await Promise.all([State.findOne({projectId}),Gen.find({projectId}).sort({createdAt:-1}).limit(20).lean(),embeddingIdentity(),published(projectId)]);
 const active=rows.find(g=>String(g._id)===String(state?.activeGeneration))??(state?.activeGeneration?await Gen.findById(state.activeGeneration).lean():null);
 let ready=!!active&&active.state==='ready'&&active.manifest===snapshot.manifest&&active.identity.id===identity.id&&active.identity.dimension===identity.dimension;
 let storageIssue:string|undefined;
 if(ready&&active){try{const checked=await localEmbedding.run({command:'verify',projectId,generation:String(active._id)},identity);ready=checked.count===active.total&&checked.checksum===active.checksum;if(!ready)storageIssue='本地索引缺失或不完整，请重建';}catch(e){ready=false;storageIssue=e instanceof IndexError?e.message:'本地索引检查失败，请重试';}}
 return {storageIssue,status:ready?'ready':state?.pendingGeneration?'updating':state?.enabled?'stale':'not_ready',effectivePublications:snapshot.rows.length,
  activeGeneration:state?.activeGeneration?.toString(),identity,ready,
  generations:rows.map(g=>({id:String(g._id),state:g.state,done:g.done,total:g.total,publications:g.publications,attempts:g.attempts,
   embedded:g.embedded,reused:g.reused,error:g.error,identity:g.identity,manifest:g.manifest,checksum:g.checksum,createdAt:g.createdAt,updatedAt:g.updatedAt,metrics:g.metrics}))};
}
export async function controlIndex(actor:AuthUser,id:string,action:'retry'|'cancel'|'rollback',adapter:SemanticAdapter=localEmbedding){
 const current=await indexActor(actor);requireAdmin(current);const projectId=String(requireProjectId(actor));
 const g=await Gen.findOne({_id:objectId(id),projectId});if(!g)throw ApiError.notFound('索引任务不存在');
 if(action==='cancel'){
  await Gen.updateOne({_id:g._id,state:{$in:['queued','running']}},{$set:{state:'failed',error:{code:'cancelled',message:'管理员已停止本次构建'}},$unset:{leaseToken:1,leaseUntil:1}});
  return {id:g.id};
 }
 const [identity,snapshot]=await Promise.all([embeddingIdentity(),published(projectId)]);
 if(g.manifest!==snapshot.manifest||g.identity.id!==identity.id||g.identity.dimension!==identity.dimension)throw ApiError.conflict('当前资料或模型已变化，请按最新版本重建；不能恢复旧政策');
 if(action==='retry'){
  if(g.state!=='failed')throw ApiError.conflict('仅失败的任务可重试');
  await withSwitch(projectId,async state=>{
   if(!(await Gen.updateOne({_id:g._id,state:'failed'},{$set:{state:'queued',attempts:0,requestedBy:current.id},$unset:{error:1,retryAt:1}})).matchedCount)throw ApiError.conflict('任务已变化');
   await State.updateOne({_id:state._id,switchToken:state.switchToken},{$set:{pendingGeneration:g._id},$inc:{revision:1}});
  });return {id:g.id};
 }
 if(g.state!=='ready')throw ApiError.conflict('只能切换到完整校验通过的代次');
 const checked=await adapter.run({command:'verify',projectId,generation:g.id},identity);
 if(checked.checksum!==g.checksum||checked.count!==g.total)throw ApiError.conflict('该代次的持久索引不完整，请重建');
 await withSwitch(projectId,async state=>{
  requireAdmin(await indexActor(current));
  if((await published(projectId)).manifest!==g.manifest||!await Gen.exists({_id:g._id,state:'ready'}))throw ApiError.conflict('资料或代次已变化，不能切换');
  await State.updateOne({_id:state._id,switchToken:state.switchToken},{$set:{activeGeneration:g._id},$unset:{pendingGeneration:1},$inc:{revision:1}});
 });return {id:g.id};
}
export async function cleanupIndexes(actor:AuthUser,adapter:SemanticAdapter=localEmbedding){
 const current=await indexActor(actor);requireAdmin(current);const projectId=String(requireProjectId(actor));
 const ids=await withSwitch(projectId,async state=>{
  const old=await Gen.find({projectId,_id:{$nin:[state.activeGeneration,state.pendingGeneration].filter(Boolean)},
   $or:[{state:'deleting'},{state:{$in:['ready','failed','superseded']},updatedAt:{$lt:new Date(Date.now()-86400000)}}]}).limit(50).select('_id');
  const ids=old.map(g=>g.id);await Gen.updateMany({_id:{$in:ids}},{$set:{state:'deleting'}});return ids;
 });
 const identity=await embeddingIdentity();
 await adapter.run({command:'cleanup',projectId,generations:ids},identity);
 await Item.deleteMany({projectId,generation:{$in:ids}});await Gen.updateMany({projectId,_id:{$in:ids},state:'deleting'},{$set:{state:'deleted'}});
 return {removed:ids.length};
}
export function expandEvidenceWindows<T extends {itemId:string;knowledgeId:unknown;publicationVersion:number;ordinal:number;content:string;location?:Record<string,unknown>}>(picked:T[],all:T[]):T[]{
 const selected=new Set(picked.map(item=>item.itemId));
 const groups=new Map<string,T[]>();
 for(const item of all){
  const key=String(item.knowledgeId)+':'+String(item.location?.parentContentHash??'');
  const group=groups.get(key);if(group)group.push(item);else groups.set(key,[item]);
 }
 const footnote=/(?:footnote|notes?|备注|注[:：]|价格|运费|freight|price|payment|lead time|交期|付款)/i;
 for(const item of picked){
  const group=groups.get(String(item.knowledgeId)+':'+String(item.location?.parentContentHash??''));
  if(!group?.length)continue;
  const at=group.findIndex(candidate=>candidate.itemId===item.itemId);if(at<0)continue;
  // A short section is cheaper and safer to read as a whole. For a long section,
  // keep the hit plus immediate neighbours and the final note/condition window.
  if(group.length<=4)group.forEach(candidate=>selected.add(candidate.itemId));
  else {
   if(at>0)selected.add(group[at-1].itemId);
   if(at+1<group.length)selected.add(group[at+1].itemId);
   const last=group[group.length-1];
   if(footnote.test(last.content.trim()))selected.add(last.itemId);
  }
 }
 return all.filter(item=>selected.has(item.itemId));
}
async function semanticKnowledgeImpl(actor:AuthUser,query:string,options:{topics:KnowledgeBundle['topics'];productApplies:(products:string[]|undefined,text:string)=>boolean;sourceOf:(id:string,v:KnowledgeRevision)=>KnowledgeSource;ids?:string[];mode?:'bm25'|'vector'|'hybrid'|'hybrid_rerank'},adapter:SemanticAdapter=localEmbedding):Promise<KnowledgeBundle>{
 const projectId=String(requireProjectId(actor));const base:KnowledgeBundle={projectId,status:'index_not_ready',sources:[],issues:[],topics:options.topics};
 try{
  const current=await indexActor(actor);
  const snapshot=await published(projectId);
  // No published corpus needs no vector/model runtime. This is absence of evidence,
  // never a keyword fallback or permission to invent supplier facts.
  if(!snapshot.rows.length){const inactive=await diagnosticMetadata(projectId,current,query,options.topics);return {...base,status:inactive.some(d=>d.code==='expired')?'expired':'no_match',issues:[{code:'no_published_knowledge',message:'当前项目暂无有效已发布资料；可分析客户，邮件中不能加入未经确认的我方能力或交易承诺'},...inactive.map(d=>({code:d.code,message:d.code==='expired'?'相关知识已过期':'相关知识尚不可用',sourceIds:[d.sourceId]}))]};}
  const [state,identity]=await Promise.all([State.findOne({projectId}),embeddingIdentity()]);
  const g=state?.activeGeneration?await Gen.findOne({_id:state.activeGeneration,projectId,state:'ready'}):null;
  if(!g||g.manifest!==snapshot.manifest||g.identity.id!==identity.id||g.identity.dimension!==identity.dimension){
   return {...base,status:g?'index_stale':'index_not_ready',issues:[{code:g?'index_stale':'index_not_ready',message:'当前有效知识的语义索引尚未就绪，请管理员在知识库更新检索资料；未使用旧索引'}]};
  }
  const allowed=snapshot.rows.filter(r=>visible(r,current)&&options.productApplies(r.revision.products,query));
  const rows=await Item.find({projectId,generation:g._id,knowledgeId:{$in:allowed.map(r=>objectId(r.id))},identity:identity.id,dimension:identity.dimension}).sort({ordinal:1}).select('itemId knowledgeId publicationVersion ordinal').lean();
  // No query-vector cache in S2. Embedding reuse key is (project, visibility, model identity, full content hash).
  const diagnostics=await diagnosticMetadata(projectId,current,query,options.topics);
  const result=await adapter.run({command:'query',projectId,generation:g.id,diagnostics,allowed:rows.map(r=>r.itemId),query,mode:options.mode??'hybrid_rerank',expectedCount:g.total,expectedChecksum:g.checksum},identity,undefined,async()=>{const now=await indexActor(actor);if((await embeddingIdentity()).id!==identity.id||now.role!==current.role||(await published(projectId)).manifest!==snapshot.manifest||String((await State.findOne({projectId}))?.activeGeneration)!==g.id||sha(JSON.stringify(diagnostics))!==sha(JSON.stringify(await diagnosticMetadata(projectId,now,query,options.topics))))throw new IndexError('authority_changed','排队期间资料或权限已变化，请重新查询');});
  const again=await indexActor(actor),after=await published(projectId),pointer=await State.findOne({projectId}),afterIdentity=await embeddingIdentity();
  if(after.manifest!==snapshot.manifest||String(pointer?.activeGeneration)!==g.id||again.role!==current.role||afterIdentity.id!==identity.id||sha(JSON.stringify(diagnostics))!==sha(JSON.stringify(await diagnosticMetadata(projectId,again,query,options.topics))))return {...base,status:'index_stale',issues:[{code:'index_stale',message:'检索期间知识或权限发生变化，请重新查询'}]};
  const selectedIds=new Set([...(result.hits??[]).map(h=>h.id),...rows.filter(i=>options.ids?.includes(String(i.knowledgeId))).map(i=>i.itemId)]);
  const parents=rows.filter(i=>selectedIds.has(i.itemId)).map(i=>i.knowledgeId);
  const details=await Item.find({projectId,generation:g._id,knowledgeId:{$in:parents},identity:identity.id}).sort({ordinal:1}).lean();
  const sources:KnowledgeSource[]=[];
  const rules=allowed.filter(r=>r.revision.category==='sales_rules');
  for(const row of rules.slice(0,4))sources.push({...options.sourceOf(row.id,row.revision),content:row.revision.content});
  const seen=new Set<string>();
  const explicit=new Set(rows.filter(i=>options.ids?.includes(String(i.knowledgeId))).map(i=>i.itemId));
  const hits=[...explicit,...(result.hits??[]).map(h=>h.id)];
  // Whole documents can be large; the model only needs the retrieved windows.
  // Keep every accepted window of the entry, not just the first hit.
  const accepted=new Set([...explicit,...(result.hits??[]).filter(h=>h.accepted).map(h=>h.id)]);
  for(const hitId of hits){
   if(!explicit.has(hitId)&&!(result.hits?.find(h=>h.id===hitId)?.accepted??false))continue;
   const item=details.find(i=>i.itemId===hitId),row=item&&after.rows.find(r=>r.id===String(item.knowledgeId)&&r.version===item.publicationVersion&&visible(r,again));
   if(!item||!row||seen.has(row.id))continue;seen.add(row.id);
   const source=options.sourceOf(row.id,row.revision);
   const acceptedForRow=details.filter(i=>String(i.knowledgeId)===row.id&&accepted.has(i.itemId));
   const picked=expandEvidenceWindows(acceptedForRow,details.filter(i=>String(i.knowledgeId)===row.id));
   const windows=picked.map(i=>i.content).filter(Boolean);
   // Provenance refs are identical on every window; keep them once instead of
   // repeating the whole document's refs on each chunk (that used to reach MBs).
   const refs=boundedRefs(picked.flatMap(i=>i.sourceRefs??[]));
   const chunks=picked.map((i,position)=>({id:i.itemId,contentHash:i.contentHash,location:i.location,sourceRefs:position===0?refs:[]}));
   sources.push({...source,content:windows.length?windows.join('\n\n…\n\n'):row.revision.content,terms:source.terms.filter(t=>options.topics.includes(t.topic)),index:{scores:result.hits?.find(h=>h.id===hitId)?.scores,selection:explicit.has(hitId)?'explicit':'semantic',generation:g.id,model:identity.id,modelName:identity.model,revision:identity.revision,dimension:identity.dimension,manifest:g.manifest,chunks}});
   if(seen.size>=10)break;
  }
  const diagnosticIssues=(result.trace?.diagnostics??[]).map(d=>({code:d.code,message:({expired:'相关资料已过期：',disabled:'相关资料已停用：',not_effective:'相关资料尚未生效：',draft_only:'相关资料尚未发布：'} as Record<string,string>)[d.code]+d.title,sourceIds:[d.sourceId]}));
  const diagnosticWarnings=(result.trace?.warnings??[]).map(w=>({code:w.code,message:w.message}));
  return {...base,status:diagnosticIssues.some(d=>d.code==='expired')&&(!sources.some(s=>s.category!=='sales_rules')||/expired|过期|失效/i.test(query))?'expired':sources.some(s=>s.category!=='sales_rules')?'ready':'no_match',sources,issues:[...diagnosticIssues,...diagnosticWarnings,...(rules.length>4?[{code:'rules_limit',message:'基础销售规则超过加载上限，请管理员合并整理'}]:[]),...(result.trace?.degraded?[result.trace.degraded]:[])],retrieval:{engine:'local_semantic',generation:g.id,identity:identity.id,trace:{...result.trace,candidates:(result.hits??[]).map(h=>{const item=details.find(i=>i.itemId===h.id),row=allowed.find(r=>r.id===String(item?.knowledgeId));return {id:h.id,knowledgeId:row?.id,title:row?.revision.title,version:row?.version,accepted:h.accepted,scores:h.scores,excerpt:item?.content,location:item?.location};})}}};
 }catch(e){return {...base,status:'retrieval_failed',sources:[],issues:[{code:e instanceof IndexError?e.code:'retrieval_failed',message:e instanceof IndexError?e.message:'语义检索或权限核对失败，请检查后重试；不能据此作出交易承诺'}]};}
}
let timer:NodeJS.Timeout|undefined,busy=false,cursor='';
export function startKnowledgeIndexWorker(){
 if(timer||process.env.NODE_ENV==='test'||process.env.NODE_TEST_CONTEXT)return;
 timer=setInterval(()=>{if(busy||mongoose.connection.readyState!==1)return;busy=true;
  void (async()=>{
   const states=await State.find({enabled:true,...(cursor?{_id:{$gt:cursor}}:{})}).sort({_id:1}).limit(5);
   cursor=states.at(-1)?.id??'';
   for(const state of states){
    const recent=await Gen.findOne({projectId:state.projectId}).sort({createdAt:-1});
    if(!recent){if(state.requestedBy)try{await requestIndex({id:String(state.requestedBy),projectId:String(state.projectId),role:'admin',username:'index',displayName:'index'});}catch{/* retry setup via admin */}continue;}
    const pending=state.pendingGeneration?await Gen.findOne({_id:state.pendingGeneration,state:'ready'}):null;
    if(pending){try{await controlIndex({id:String(pending.requestedBy),projectId:String(state.projectId),role:'admin',username:'index',displayName:'index'},pending.id,'rollback');}catch{/* authority/version checks remain */}}
    const snapshot=await published(String(state.projectId)),identity=await embeddingIdentity();
    if(snapshot.manifest!==recent.manifest||identity.id!==recent.identity.id){
     try{await requestIndex({id:String(recent.requestedBy),projectId:String(state.projectId),role:'admin',username:'index',displayName:'index'});}catch{/* Explicit failed/not-ready status remains. */}
    }else if(recent.state==='ready'&&String(state.activeGeneration)!==recent.id&&String(state.pendingGeneration)===recent.id){
     try{await controlIndex({id:String(recent.requestedBy),projectId:String(state.projectId),role:'admin',username:'index',displayName:'index'},recent.id,'rollback');}catch{/* no stale switch */}
    }
   }
   await processKnowledgeIndex();
  })().catch(()=>undefined).finally(()=>{busy=false;});
 },3000);timer.unref();
}

export function stopKnowledgeIndexWorker(){if(timer)clearInterval(timer);timer=undefined;}

export async function semanticKnowledge(...args:Parameters<typeof semanticKnowledgeImpl>):Promise<KnowledgeBundle>{const start=Date.now();const result=await semanticKnowledgeImpl(...args);const {observeRetrieval}=await import('./operations');await observeRetrieval(result.projectId,result.status,Date.now()-start);return result;}
