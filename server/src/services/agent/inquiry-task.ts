import type {EvidenceWorkflow} from './evidence-workflow';
import {Types} from 'mongoose';
import {AgentTaskDocument,TaskStep} from '../../models/AgentTask';
import {AgentMailThreadAnalysis,DevelopmentLetter} from '../../models';
import type {AuthUser} from '../../types/express';
import type {AgentProvider} from './provider';
import {agentMailOrThrow} from './mail-access';
import {createMailThreadAnalysis,detectProtectedMailSignal,hasProtectedCustomerMail} from './mail-thread-analysis.service';
import {sendLetter,getLetter} from '../letter.service';
import {ApiError} from '../../utils/ApiError';
import {escapeHtml} from '../../utils/text';
export async function executeInquiryTask(task:AgentTaskDocument,actions:{check:()=>Promise<AuthUser>;step:(key:TaskStep,message:string)=>Promise<void>;change:(set:Record<string,unknown>,message?:string,complete?:TaskStep)=>Promise<void>},provider?:AgentProvider,workflow?:EvidenceWorkflow){
 const suffix=(task.workflowEpoch??0)?'-e'+task.workflowEpoch:'';
 const {check,step,change}=actions;let actor=await check();await step('locate_customer','正在核对来信来源、收件账号与客户归属。');
 let mail=await agentMailOrThrow(String(task.sourceMailId),actor);
 if(detectProtectedMailSignal(mail).classification!=='normal'||(mail.customerId&&await hasProtectedCustomerMail(String(mail.customerId),actor.projectId!))){await change({status:'cancelled'},'检测到停止营销联系信号，未生成回复草稿。');return;}
 if(mail.customerId)task.customerId=mail.customerId;
 await change({... (mail.customerId?{customerId:mail.customerId}:{})},mail.customerId?'已定位来信客户。':'这是当前账号的未建档来信；先整理询盘，回复前需关联客户。','locate_customer');
 await step('analyze_customer','正在提取产品、数量、交期与待回答问题，准备回复草稿。');
 const analysis=await createMailThreadAnalysis({mailId:mail.id,direction:'inbound',idempotencyKey:`task-mail-${task.id}-${mail.customerId??'unknown'}${suffix}`},actor,{provider,taskId:task.id,workflow,taskKind:task.kind,userRequest:task.goal});
 await check();await change({mailAnalysisId:new Types.ObjectId(analysis.id),contextSummary:[analysis.summary,...analysis.productSources.map(k=>`产品依据：${k.title} v${k.version}`)].join('；').slice(0,1500)},'询盘摘要、需求依据与回复内容已保存。','analyze_customer');
 if(analysis.safety.marketingBlocked){await change({status:'cancelled'},'分析识别到受保护信号，已停止回复准备。');return;}
 mail=await agentMailOrThrow(String(task.sourceMailId),await check());
 if(!mail.customerId){await change({status:'waiting_input'},'询盘摘要与待确认回复已保存。请先在邮件中心关联或创建客户，再回来继续。');return;}
 task.customerId=mail.customerId;await change({customerId:mail.customerId});
 await step('save_draft','正在保存带原线程引用的回复草稿；不会发送。');
 let draft=await DevelopmentLetter.findOne({projectId:task.projectId,requestKey:`task-inquiry-${task.id}${suffix}`});
 if(!draft){actor=await check();const saved=await sendLetter({customerId:String(mail.customerId),replyToId:mail.id,subject:analysis.replyDraft.subject,content:analysis.replyDraft.bodyText.trim().split(/\r?\n(?:[ \t]*\r?\n)+/).map(p=>`<p>${escapeHtml(p).replace(/\r?\n/g,'<br>')}</p>`).join(''),saveAsDraft:true,markAsDeveloped:false,agentTaskId:task.id,requestKey:`task-inquiry-${task.id}${suffix}`},actor);if(analysis.knowledgeReview)await DevelopmentLetter.updateOne({_id:saved.letter.id,projectId:task.projectId,knowledgeReview:{$exists:false}},{$set:{knowledgeReview:analysis.knowledgeReview}});draft=await DevelopmentLetter.findById(saved.letter.id);}
 if(!draft||String(draft.customerId)!==String(mail.customerId)||String(draft.agentTaskId)!==task.id)throw ApiError.conflict('回复草稿关联不一致');
 await check();await AgentMailThreadAnalysis.updateOne({_id:analysis.id,userId:task.userId,projectId:task.projectId,replyStatus:{$in:['editable','failed']}},{$set:{replyStatus:'saved',createdLetterId:draft._id},$inc:{version:1}});
 await change({draftId:draft._id},'回复草稿已保存，保留原始邮件线程。','save_draft');
 await step('verify_draft','核对回复草稿与原来信引用。');await getLetter(draft.id,await check());
 await workflow?.run('handoff',{draftId:draft.id},async()=>({draftId:draft.id,customerId:String(task.customerId),reviewRequired:true,sent:false}));
 await change({status:'awaiting_review'},'询盘处理已准备完成，交给业务员审核发送。','verify_draft');
}
