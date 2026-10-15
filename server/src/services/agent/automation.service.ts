import {Types} from 'mongoose';
import {z} from 'zod';
import {AgentAutomationRule,AgentAutomationEvent,AgentAutomationDay} from '../../models/AgentAutomation';
import {AgentTask} from '../../models/AgentTask';
import {AgentSession,Customer,DevelopmentLetter} from '../../models';
import {MailMessage} from '../../models/MailMessage';
import type {AuthUser} from '../../types/express';
import {ApiError} from '../../utils/ApiError';
import {requireProjectId,customerScope} from '../../utils/access';
import {detectProtectedMailSignal,hasProtectedCustomerMail} from './mail-thread-analysis.service';
import {taskActor} from './task.service';
import {createFollowUp} from '../followup.service';
const scope=(actor:AuthUser)=>({projectId:requireProjectId(actor),userId:new Types.ObjectId(actor.id)});
export const automationRuleInput=z.object({expectedVersion:z.number().int().min(0),enabled:z.boolean(),inbound:z.boolean(),due:z.boolean(),sent:z.boolean(),dailyLimit:z.number().int().min(1).max(20),tokenBudget:z.number().int().min(10000).max(60000)}).strict();
export async function getAutomationRule(actor:AuthUser){const rule=await AgentAutomationRule.findOne(scope(actor));return rule?{...rule.toObject(),id:rule.id}:{id:null,version:0,enabled:false,inbound:true,due:true,sent:true,dailyLimit:5,tokenBudget:30000};}
export async function saveAutomationRule(input:z.infer<typeof automationRuleInput>,actor:AuthUser){
 const parsed=automationRuleInput.parse(input);const current=await AgentAutomationRule.findOne(scope(actor));if((current?.version??0)!==parsed.expectedVersion)throw ApiError.conflict('事件规则已变化，请重新载入');
 const now=new Date();const patch={enabled:parsed.enabled,inbound:parsed.inbound,due:parsed.due,sent:parsed.sent,dailyLimit:parsed.dailyLimit,tokenBudget:parsed.tokenBudget,actorRole:actor.role,...(parsed.enabled&&!current?.enabled?{enabledAt:now,mailCursorAt:now,mailCursorId:new Types.ObjectId('000000000000000000000000')}:{})};
 let saved;if(!current){try{saved=await AgentAutomationRule.create({...scope(actor),...patch,version:1});}catch{throw ApiError.conflict('事件规则已由其他页面创建，请重新载入');}}
 else saved=await AgentAutomationRule.findOneAndUpdate({_id:current._id,version:parsed.expectedVersion},{$set:patch,$inc:{version:1}},{new:true});
 if(!saved)throw ApiError.conflict('事件规则已变化');
 // Changing scope/version revokes outstanding automatic work. Saved artifacts are retained.
 await AgentTask.updateMany({...scope(actor),automationRuleId:saved._id,ruleVersion:{$ne:saved.version},status:{$in:['queued','running','paused','waiting_input','failed']}},{$set:{status:'cancelled'},$unset:{leaseToken:1,leaseUntil:1},$inc:{version:1},$push:{events:{$each:[{at:now,message:'事件规则已关闭或更新，未完成的自动任务已停止。'}],$slice:-100}}});
 return getAutomationRule(actor);
}
export async function listAutomationInbox(actor:AuthUser){
 const rows=await AgentAutomationEvent.find(scope(actor)).sort({createdAt:-1}).limit(60);const result=[];
 for(const e of rows){if(e.customerId&&!await Customer.exists({_id:e.customerId,...customerScope(actor)}))continue;result.push({id:e.id,kind:e.kind,status:e.status,reason:e.reason,taskId:e.taskId?.toString(),sourceId:String(e.sourceId),customerId:e.customerId?.toString(),createdAt:e.createdAt});}return result;
}
async function putEvent(rule:InstanceType<typeof AgentAutomationRule>,kind:'inbound'|'due'|'sent',sourceId:Types.ObjectId,key:string,customerId?:Types.ObjectId,dueAt?:Date){
 const filter={projectId:rule.projectId,userId:rule.userId,eventKey:key};
 try{return await AgentAutomationEvent.findOneAndUpdate(filter,{$setOnInsert:{...filter,ruleId:rule._id,ruleVersion:rule.version,kind,sourceId,customerId,dueAt,status:'pending'}},{upsert:true,new:true});}
 catch(error){if((error as {code?:number}).code!==11000)throw error;return AgentAutomationEvent.findOne(filter);}
}
async function reserveEvent(rule:InstanceType<typeof AgentAutomationRule>,eventId:string){
 const day=new Date().toISOString().slice(0,10);const filter={ruleId:rule._id,day};
 try{await AgentAutomationDay.updateOne(filter,{$setOnInsert:{...filter,used:0,eventIds:[]}},{upsert:true});}catch(error){if((error as {code?:number}).code!==11000)throw error;}
 if(await AgentAutomationDay.exists({...filter,eventIds:eventId}))return true;
 const charged=await AgentAutomationDay.updateOne({...filter,used:{$lt:rule.dailyLimit},eventIds:{$ne:eventId}},{$inc:{used:1},$addToSet:{eventIds:eventId}});
 return Boolean(charged.matchedCount)||Boolean(await AgentAutomationDay.exists({...filter,eventIds:eventId}));
}
async function blockMarketing(customerId:Types.ObjectId,projectId:Types.ObjectId){
 await DevelopmentLetter.updateMany({projectId,customerId,status:{$in:['queued','scheduled','retrying']},$or:[{agentTaskId:{$exists:true}},{agentOutreachId:{$exists:true}}]},{$set:{status:'cancelled',error:'检测到停止营销联系记录，已取消待投递任务'},$push:{history:{at:new Date(),status:'cancelled'}}});
 await AgentTask.updateMany({projectId,customerId,status:{$in:['queued','running','paused','waiting_input','awaiting_review']},$or:[{kind:{$in:['first_outreach','followup_review','inquiry_reply']}},{kind:{$exists:false}}]},{$set:{status:'cancelled'},$unset:{leaseToken:1,leaseUntil:1},$inc:{version:1},$push:{events:{$each:[{at:new Date(),message:'检测到退订、拒绝、退信或垃圾邮件信号，后续营销任务已停止；已保存草稿保留但禁止继续营销发送。'}],$slice:-100}}});
}
export async function observeAgentEvents(){
 for(const rule of await AgentAutomationRule.find({enabled:true}).limit(100)){
  let actor:AuthUser;try{actor=await taskActor({projectId:rule.projectId,userId:rule.userId,actorRole:rule.actorRole as 'admin'|'user'});}catch{continue;}
  const own={projectId:rule.projectId,ownerId:rule.userId};const customerIds=(await Customer.find(own).select('_id')).map(c=>c._id);
  if(rule.inbound){
   const cursorAt=rule.mailCursorAt??rule.enabledAt??new Date();
   const mails=await MailMessage.find({projectId:rule.projectId,deleted:{$ne:true},createdAt:{$gte:rule.enabledAt??cursorAt},$and:[{$or:[{mailboxUserId:rule.userId},{mailboxUserId:null,customerId:{$in:customerIds}}]},{$or:[{createdAt:{$gt:cursorAt}},{createdAt:cursorAt,_id:{$gt:rule.mailCursorId??new Types.ObjectId('000000000000000000000000')}}]}]}).sort({createdAt:1,_id:1}).limit(30);
   for(const mail of mails){
    const e=await putEvent(rule,'inbound',mail._id,`inbound:${mail.id}`,mail.customerId??undefined);if(!e)continue;
    const signal=detectProtectedMailSignal(mail);
    if(signal.classification!=='normal'){
     if(mail.customerId)await blockMarketing(mail.customerId,rule.projectId);
     await AgentAutomationEvent.updateOne({_id:e._id},{$set:{status:'blocked',reason:signal.reason,handledAt:new Date()}});
    }
    await AgentAutomationRule.updateOne({_id:rule._id,version:rule.version,enabled:true},{$set:{mailCursorAt:mail.createdAt,mailCursorId:mail._id}});
   }
  }
  if(rule.due){
   // Exclude exact already-observed deadlines before limiting, so older rows cannot starve later customers.
   const dueCustomers=await Customer.aggregate([
    {$match:{...own,nextFollowUpAt:{$gte:rule.enabledAt??new Date(),$lte:new Date()},status:{$nin:['won','lost']}}},
    {$lookup:{from:AgentAutomationEvent.collection.name,let:{cid:'$_id',due:'$nextFollowUpAt'},pipeline:[{$match:{projectId:rule.projectId,userId:rule.userId,kind:'due',$expr:{$and:[{$eq:['$customerId','$$cid']},{$eq:['$dueAt','$$due']}]}}},{$limit:1}],as:'observed'}},
    {$match:{'observed.0':{$exists:false}}},{$sort:{nextFollowUpAt:1,_id:1}},{$limit:30},{$project:{_id:1,nextFollowUpAt:1}},
   ]);
   for(const c of dueCustomers)await putEvent(rule,'due',c._id,'due:'+c._id+':'+c.nextFollowUpAt.toISOString(),c._id,c.nextFollowUpAt);
  }
  for(const e of await AgentAutomationEvent.find({ruleId:rule._id,status:{$in:['pending','waiting_budget','waiting_customer']}}).sort({updatedAt:1,_id:1}).limit(30)){
   if(e.ruleVersion!==rule.version){await AgentAutomationEvent.updateOne({_id:e._id},{$set:{status:'ignored',reason:'规则版本已变化'}});continue;}
   if(e.kind==='inbound'&&!e.customerId){const mail=await MailMessage.findOne({_id:e.sourceId,projectId:rule.projectId,deleted:{$ne:true}});if(mail?.customerId){e.customerId=mail.customerId;await AgentAutomationEvent.updateOne({_id:e._id},{$set:{customerId:mail.customerId}});}else if(actor.role!=='admin'){await AgentAutomationEvent.updateOne({_id:e._id},{$set:{status:'waiting_customer',reason:'未关联客户的来信需按现有权限由管理员确认关联；关联后自动继续。'}});continue;}}
   if(e.customerId){const customer=await Customer.findOne({_id:e.customerId,...own});if(!customer||!await Customer.exists({_id:e.customerId,...customerScope(actor)})){await AgentAutomationEvent.updateOne({_id:e._id},{$set:{status:'ignored',reason:'客户已转交或移除'}});continue;}
    if(await hasProtectedCustomerMail(String(e.customerId),String(rule.projectId))){await blockMarketing(e.customerId,rule.projectId);await AgentAutomationEvent.updateOne({_id:e._id},{$set:{status:'blocked',reason:'客户已有停止营销联系记录'}});continue;}}
   if(e.kind==='sent')continue;
   if(!await reserveEvent(rule,e.id)){await AgentAutomationEvent.updateOne({_id:e._id},{$set:{status:'waiting_budget',reason:'已达每日自动准备上限，等待后续额度'}});continue;}
   let session=await AgentSession.findOne({projectId:rule.projectId,userId:rule.userId,title:'事件任务',status:'active'});if(!session)session=await AgentSession.create({projectId:rule.projectId,userId:rule.userId,title:'事件任务',context:{type:'global'},status:'active'});
   const kind=e.kind==='inbound'?'inquiry_reply':'followup_review';
   const task=await AgentTask.findOneAndUpdate({projectId:rule.projectId,userId:rule.userId,requestKey:`event-${e.id}`},{$setOnInsert:{projectId:rule.projectId,userId:rule.userId,sessionId:session._id,actorRole:actor.role,requestKey:`event-${e.id}`,goal:e.kind==='inbound'?'分析新来信，整理需求并准备回复草稿，交给业务员审核。':'跟进已到期：核对客户近期动态并准备跟进草稿，交给业务员审核。',kind,customerId:e.customerId,sourceMailId:e.kind==='inbound'?e.sourceId:undefined,sourceDueAt:e.dueAt,automationRuleId:rule._id,ruleVersion:rule.version,tokenBudget:rule.tokenBudget,status:'queued',events:[{at:new Date(),message:'由已启用的个人事件规则创建；仅准备草稿，不发送邮件。'}]}},{upsert:true,new:true});
   await AgentAutomationEvent.updateOne({_id:e._id},{$set:{taskId:task!._id,status:'task_created',handledAt:new Date()},$unset:{reason:1}});
  }
 }
}
export async function assertAutomaticTask(task:InstanceType<typeof AgentTask>,actor:AuthUser){
 if(!task.automationRuleId)return;
 const rule=await AgentAutomationRule.findOne({_id:task.automationRuleId,...scope(actor),enabled:true,version:task.ruleVersion});
 if(!rule)throw new ApiError(409,'事件规则已关闭或变化','CONFLICT',[{field:'agent',message:'AUTOMATION_REVOKED'}]);
 if(task.sourceMailId){const mail=await MailMessage.findOne({_id:task.sourceMailId,projectId:requireProjectId(actor),deleted:{$ne:true}});if(!mail||(mail.mailboxUserId&&String(mail.mailboxUserId)!==actor.id))throw ApiError.notFound('来信权限已变化');if(mail.customerId&&!await Customer.exists({_id:mail.customerId,projectId:rule.projectId,ownerId:rule.userId}))throw ApiError.notFound('客户已转交');}
 if(task.kind==='followup_review'&&!await Customer.exists({_id:task.customerId,projectId:rule.projectId,ownerId:rule.userId,nextFollowUpAt:task.sourceDueAt}))throw new ApiError(409,'跟进时间已变化','CONFLICT',[{field:'agent',message:'AUTOMATION_REVOKED'}]);
}
// Called only after a durable SMTP-accepted receipt; retries use the same action key.
export async function recordAgentSendReceipt(letterId:string){
 const letter=await DevelopmentLetter.findById(letterId);if(!letter||letter.channel!=='smtp'||!['sent','opened'].includes(letter.status)||!letter.sentBy)return;
 if(letter.agentTaskId&&!letter.agentOutreachId){
  await createFollowUp(String(letter.customerId),{method:'email',result:'no_reply',content:`${letter.inReplyTo?'询盘回复':'跟进邮件'}已发送（SMTP 已接受，等待客户回复）。主题：${letter.subject}。`,followUpAt:letter.sentAt??letter.createdAt},String(letter.sentBy),String(letter.projectId),{agentActionKey:`task-sent:${letter.agentTaskId}`});
  await AgentTask.updateOne({_id:letter.agentTaskId,projectId:letter.projectId,status:{$in:['awaiting_review','cancelled']}},{$set:{status:'completed',sentLetterId:letter._id},$inc:{version:1},$push:{events:{$each:[{at:new Date(),message:'SMTP 已接受，已记录一次实际发送跟进。'}],$slice:-100}}});
 }
 const rule=await AgentAutomationRule.findOne({projectId:letter.projectId,userId:letter.sentBy,enabled:true,sent:true});if(!rule)return;
 const e=await putEvent(rule,'sent',letter._id,`sent:${letter.id}`,letter.customerId);
 if(!letter.agentOutreachId&&!letter.agentTaskId)await createFollowUp(String(letter.customerId),{method:'email',result:'no_reply',content:`邮件已发送（SMTP 已接受）。主题：${letter.subject}。`,followUpAt:letter.sentAt??letter.createdAt},String(letter.sentBy),String(letter.projectId),{agentActionKey:`mail-sent:${letter.id}`});
 if(e)await AgentAutomationEvent.updateOne({_id:e._id},{$set:{status:'completed',reason:'真实 SMTP 接受；跟进记录已去重保存。',handledAt:new Date()}});
}
