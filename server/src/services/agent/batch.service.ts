import {createHash} from 'node:crypto';
import {Types} from 'mongoose';
import {z} from 'zod';
import {AgentBatch} from '../../models/AgentBatch';
import {AgentTask} from '../../models/AgentTask';
import {AgentSession,Customer} from '../../models';
import {customerScope,requireProjectId} from '../../utils/access';
import {ApiError} from '../../utils/ApiError';
import type {AuthUser} from '../../types/express';
import {getCustomerByIdOrThrow} from '../customer.service';
import {hasProtectedCustomerMail} from './mail-thread-analysis.service';
import {createAgentTask,taskActor} from './task.service';
import {searchProductKnowledge} from './knowledge.service';
const id=z.string().regex(/^[a-f\d]{24}$/i);
export const batchProposalSchema=z.object({sessionId:id,requestKey:z.string().min(8).max(100),goal:z.string().trim().min(1).max(8000),customerIds:z.array(id).min(1).max(20).optional(),query:z.string().trim().max(120).optional(),priority:z.enum(['high','medium','low']).optional(),status:z.enum(['pending','contacted','interested','negotiating','won','lost']).optional(),tag:z.string().max(80).optional(),limit:z.number().int().min(1).max(20).default(5),knowledgeIds:z.array(id).max(5).default([]),totalTokenBudget:z.number().int().min(1000).max(400000).optional()}).strict();
const scope=(actor:AuthUser)=>({projectId:requireProjectId(actor),userId:new Types.ObjectId(actor.id)});
async function batchDto(batch:InstanceType<typeof AgentBatch>,actor:AuthUser){
 const customers=await Customer.find({...customerScope(actor),_id:{$in:batch.customerIds}}).select('_id name company');
 const byId=new Map(customers.map(c=>[c.id,c]));
 const tasks=await AgentTask.find({...scope(actor),parentBatchId:batch._id}).select('_id customerId status draftId error budgetCharged tokenBudget contextSummary');
 const rows=batch.customerIds.map(cid=>{const customer=byId.get(String(cid));const task=tasks.find(t=>String(t.customerId)===String(cid));return {customerId:String(cid),name:customer?.name??'客户已移除或无权访问',company:customer?.company,taskId:customer?task?.id:undefined,status:customer?(task?.status??'queued'):'unavailable',draftId:customer?task?.draftId?.toString():undefined,error:customer?task?.error?.message:'客户权限已变化',summary:customer?task?.contextSummary:undefined,budgetCharged:task?.budgetCharged??0};});
 return {id:batch.id,goal:batch.goal,status:batch.status,version:batch.version,rows,totalTokenBudget:batch.totalTokenBudget,budgetCharged:rows.reduce((sum,t)=>sum+t.budgetCharged,0),ready:rows.filter(t=>['awaiting_review','completed'].includes(t.status)).length,failed:rows.filter(t=>['failed','waiting_input','unavailable'].includes(t.status)).length,knowledgeIds:batch.knowledgeIds.map(String),createdAt:batch.createdAt};
}
async function owned(id:string,actor:AuthUser){if(!Types.ObjectId.isValid(id))throw ApiError.notFound();const batch=await AgentBatch.findOne({_id:id,...scope(actor)});if(!batch)throw ApiError.notFound('批量任务不存在或无权访问');return batch;}
export async function listAgentBatches(actor:AuthUser){return Promise.all((await AgentBatch.find(scope(actor)).sort({createdAt:-1}).limit(20)).map(b=>batchDto(b,actor)));}
export async function getAgentBatch(id:string,actor:AuthUser){return batchDto(await owned(id,actor),actor);}
export async function proposeAgentBatch(raw:z.input<typeof batchProposalSchema>,actor:AuthUser){
 const input=batchProposalSchema.parse(raw);const requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');const session=await AgentSession.findOne({_id:input.sessionId,...scope(actor),status:'active'});if(!session)throw ApiError.notFound('会话不存在');
 const old=await AgentBatch.findOne({...scope(actor),requestKey:input.requestKey});if(old){if(old.requestHash!==requestHash)throw ApiError.conflict('请求标识已用于其他目标');return batchDto(old,actor);}
 let selected:string[]=[];
 if(input.customerIds){selected=[...new Set(input.customerIds)];for(const cid of selected)await getCustomerByIdOrThrow(cid,actor);}
 else{
  const pattern=input.query?.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const found=await Customer.find({...customerScope(actor),...(pattern?{$or:['name','company','industry','interestedProducts'].map(k=>({[k]:{$regex:pattern,$options:'i'}}))}:{}),...(input.priority?{priority:input.priority}:{}),...(input.status?{status:input.status}:{}),...(input.tag?{tags:input.tag}:{})}).sort({priority:1,createdAt:-1,_id:1}).select('_id email status').limit(200);
  for(const c of found){if(selected.length===input.limit)break;if(c.email&&!['won','lost'].includes(c.status)&&!await hasProtectedCustomerMail(c.id,actor.projectId!))selected.push(c.id);}
 }
 if(!selected.length)throw ApiError.badRequest('没有符合条件且可联系的客户，请调整筛选或先完善邮箱');
 if(input.knowledgeIds.length && (await searchProductKnowledge(actor,'',input.knowledgeIds)).length!==input.knowledgeIds.length)throw ApiError.badRequest('所选产品知识未发布或不属于当前项目');
 let batch;
 try{batch=await AgentBatch.create({...scope(actor),sessionId:session._id,actorRole:actor.role,requestKey:input.requestKey,requestHash,goal:input.goal,customerIds:selected,knowledgeIds:input.knowledgeIds,totalTokenBudget:input.totalTokenBudget??selected.length*20000,status:'proposed'});}
 catch(error){if((error as {code?:number}).code!==11000)throw error;batch=await AgentBatch.findOne({...scope(actor),requestKey:input.requestKey});}
 if(!batch)throw ApiError.internal('批量计划保存失败');if(batch.requestHash!==requestHash)throw ApiError.conflict('请求标识已用于其他计划');return batchDto(batch,actor);
}
export async function materializeAgentBatches(){
 for(const batch of await AgentBatch.find({status:'active'}).sort({createdAt:1}).limit(20)){
  try{
   const actor=await taskActor(batch);
   for(const cid of batch.customerIds){
    if(!await AgentBatch.exists({_id:batch._id,status:'active'}))break;
    if(await AgentTask.exists({...scope(actor),requestKey:`batch-${batch.id}-${cid}`}))continue;
    // A transferred/deleted customer becomes a visible per-row failure; it cannot block other rows.
    try{await createAgentTask({sessionId:String(batch.sessionId),goal:`请给这个客户写第一封开发信。业务员要求：${batch.goal}`,requestKey:`batch-${batch.id}-${cid}`,customerId:String(cid),parentBatchId:batch.id,knowledgeIds:batch.knowledgeIds.map(String),tokenBudget:Math.floor(batch.totalTokenBudget/batch.customerIds.length)},actor);}
    catch(error){if(!(error instanceof ApiError&&error.statusCode===404))throw error;}
   }
  }catch{await AgentBatch.updateOne({_id:batch._id,status:'active'},{$set:{status:'paused'},$inc:{version:1}});}
 }
}
export async function controlAgentBatch(id:string,action:'confirm'|'pause'|'resume'|'cancel',version:number,actor:AuthUser){
 const current=await owned(id,actor);if(current.version!==version)throw ApiError.conflict('批量计划已变化，请重新载入');
 const allowed={confirm:['proposed'],pause:['active'],resume:['paused'],cancel:['proposed','active','paused']}[action];if(!allowed.includes(current.status))throw ApiError.conflict('批量任务状态已变化');
 // Confirm the exact immutable customer set and budget; nothing is added on resume.
 if(action==='confirm')for(const cid of current.customerIds)await getCustomerByIdOrThrow(String(cid),actor);
 const next=action==='confirm'||action==='resume'?'active':action==='pause'?'paused':'cancelled';
 const saved=await AgentBatch.findOneAndUpdate({_id:current._id,...scope(actor),version},{$set:{status:next},$inc:{version:1}},{new:true});if(!saved)throw ApiError.conflict('批量任务已变化');
 if(next==='paused'||next==='cancelled')await AgentTask.updateMany({...scope(actor),parentBatchId:current._id,status:{$in:['queued','running','paused']}},{$set:{status:next==='paused'?'paused':'cancelled'},$unset:{leaseToken:1,leaseUntil:1},$inc:{version:1}});
 if(action==='resume')await AgentTask.updateMany({...scope(actor),parentBatchId:current._id,status:'paused'},{$set:{status:'queued'},$inc:{version:1}});
 if(next==='active')await materializeAgentBatches();return batchDto(saved,actor);
}
export function isBatchOutreachCommand(text:string){return !/(不要|不用|(?<!分)别)(?!发送)[^，。；\n]{0,8}(写|准备|生成)/.test(text)&&/(开发信|开发邮件)/.test(text)&&/(批量|分别|这些|这\s*\d+\s*家|[2-9一二三四五六七八九十]+\s*家)/.test(text)&&/(写|准备|生成|起草)/.test(text);}
export async function proposeBatchFromCommand(sessionId:string,goal:string,key:string,actor:AuthUser){
 const match=goal.match(/(\d+|[一二三四五六七八九十])\s*家/);const number=match?({'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[match[1]]??Number(match[1])):5;
 const query=goal.match(/珠宝|首饰|jewelry|jewellery|香氛|蜡烛|candle|哑铃|杠铃|壶铃|健身器材|fitness|dumbbell|barbell|kettlebell/i)?.[0];
 return proposeAgentBatch({sessionId,goal,requestKey:key,limit:Math.min(20,Math.max(1,number)),priority:/高优先级|high priority/i.test(goal)?'high':undefined,query,status:'pending'},actor);
}
