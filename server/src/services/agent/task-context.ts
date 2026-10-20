import {WebsiteResearch} from '../../models/WebsiteResearch';
import {Types} from 'mongoose';
import {DevelopmentLetter,FollowUp,Quotation} from '../../models';
import {MailMessage} from '../../models/MailMessage';
import {CustomerAgreement} from '../../models/CustomerAgreement';
import {AgentKnowledge} from '../../models/AgentKnowledge';
import type {AuthUser} from '../../types/express';
import {getCustomerByIdOrThrow} from '../customer.service';
import {agentMailOrThrow,inboundAgentScope} from './mail-access';
import {workflowHash} from './evidence-workflow';
import {requireProjectId} from '../../utils/access';
import {ApiError} from '../../utils/ApiError';
// Fingerprint current authorized inputs on every resume and before committing generated results.
// Hashes alone never grant access. Private mailbox scope is resolved fresh each time.
export async function taskContextStamp(customerId:string|undefined,mailId:string|undefined,actor:AuthUser){
 const mail=mailId?await agentMailOrThrow(mailId,actor):undefined;
 if(mail&&customerId&&String(mail.customerId??'')!==customerId)throw ApiError.conflict('原来信关联客户已变化，请重新发起任务');
 const cid=customerId??mail?.customerId?.toString();const customer=cid?await getCustomerByIdOrThrow(cid,actor):undefined;
 const projectId=requireProjectId(actor);const filter={projectId,customerId:cid?new Types.ObjectId(cid):null};
 const [inbound,outbound,followups,quotes,agreements,knowledge,website]=await Promise.all([
  MailMessage.find({...filter,...await inboundAgentScope(actor),deleted:{$ne:true},...(!cid&&mail?{threadId:mail.threadId}: {})}).sort({_id:1}).select('_id customerId mailboxUserId visibility text subject from fromName to sentAt').limit(501).lean(),
  cid?DevelopmentLetter.find({...filter,status:{$in:['sent','opened']}}).sort({_id:1}).select('_id updatedAt contentText subject').limit(501).lean():[],
  cid?FollowUp.find(filter).sort({_id:1}).select('_id updatedAt content nextFollowUpAt').limit(501).lean():[],
  cid?Quotation.find(filter).sort({_id:1}).select('_id version updatedAt status validityDate').limit(501).lean():[],
  cid?CustomerAgreement.find(filter).sort({_id:1}).select('_id version approvedVersion disabled').limit(101).lean():[],
  AgentKnowledge.find({projectId,approvedVersion:{$gt:0}}).sort({_id:1}).select('_id approvedVersion archived updatedAt').limit(1001).lean(),
  cid?WebsiteResearch.findOne({...filter,state:{$in:['ready','partial']}}).sort({createdAt:-1}).select('_id pages.url pages.hash pages.collectedAt report.version').lean():null,
 ]);
 if(inbound.length>=501||outbound.length>=501||followups.length>=501||quotes.length>=501||agreements.length>=101||knowledge.length>=1001)throw new ApiError(413,'任务资料超过本轮恢复核对范围，请缩小范围','PAYLOAD_TOO_LARGE');
 // Customer fields are authoritative, but an unrelated viewer opening a page does not change this stamp.
 const profile=customer?Object.fromEntries(Object.entries(customer.toObject()).filter(([key])=>!['updatedAt','__v'].includes(key))):null;
 return workflowHash({projectId,actor:actor.id,role:actor.role,profile,root:mail?{id:mail.id,customerId:mail.customerId,text:mail.text,subject:mail.subject}:null,inbound,outbound,followups,quotes,agreements,knowledge,website});
}
