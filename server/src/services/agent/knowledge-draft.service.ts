import {salesSubjects,type SalesMailKind} from './sales-evidence';
import {DevelopmentLetter} from '../../models/DevelopmentLetter';
import {requireProjectId} from '../../utils/access';
import {draftHash,knowledgeFreshness} from './knowledge-grounding';
import {providerFactVerifier,inspectEditedDraft,type SemanticVerifier} from './fact-verifier';
import {resolveAgentProvider} from './ai-settings.service';
import type {KnowledgeBundle,ClaimCheck} from './knowledge-types';
import {randomUUID} from 'node:crypto';
import {getLetter} from '../letter.service';
import {ApiError} from '../../utils/ApiError';
import type {AuthUser} from '../../types/express';
import {createCustomerAnalysis,saveAnalysisEmailDraft} from './customer-analysis.service';
import {createMailThreadAnalysis,saveMailReplyDraft} from './mail-thread-analysis.service';
// Regeneration is an explicit human action. A new analysis/draft preserves the old draft and its versions.
export async function regenerateKnowledgeDraft(id:string,actor:AuthUser,requestKey=randomUUID()){
 const letter=await getLetter(id,actor);
 if(letter.status!=='draft'||!letter.knowledgeReview)throw ApiError.conflict('仅支持重新生成有知识依据的草稿');
 const context=letter.knowledgeReview.context;
 const originalKind=letter.knowledgeReview.taskType;
 const taskKind:SalesMailKind=Object.hasOwn(salesSubjects,originalKind)?originalKind as SalesMailKind:'followup_review';
 if(context.mailId){
  const analysis=await createMailThreadAnalysis({mailId:context.mailId,direction:context.direction??'inbound',idempotencyKey:'kb-regenerate-'+id+'-'+requestKey},actor,{taskKind,userRequest:context.request});
  const saved=await saveMailReplyDraft(analysis.id,{expectedVersion:analysis.version,idempotencyKey:'kb-save-'+id+'-'+requestKey},actor);
  return {letterId:saved.letterId,customerId:letter.customerId};
 }
 const analysis=await createCustomerAnalysis({customerId:letter.customerId,idempotencyKey:'kb-regenerate-'+id+'-'+requestKey},actor,
  {taskKind,firstOutreach:taskKind==='first_outreach',userRequest:context.request??'依据当前有效知识重新准备邮件草稿'});
 const saved=await saveAnalysisEmailDraft(analysis.id,{expectedVersion:analysis.version,idempotencyKey:'kb-save-'+id+'-'+requestKey},actor);
 return {letterId:saved.letterId,customerId:letter.customerId};
}

export async function recheckKnowledgeDraft(id:string,input:{requestKey:string;bodyText?:string;subject?:string},actor:AuthUser,verifierOverride?:SemanticVerifier){
 const letter=await getLetter(id,actor);
 if(letter.status!=='draft'||!letter.knowledgeReview)throw ApiError.conflict('仅支持有知识依据的草稿复核');
 const document=await DevelopmentLetter.findOne({_id:id,projectId:requireProjectId(actor)});if(!document)throw ApiError.notFound();
 const review=letter.knowledgeReview;
 const body=input.bodyText??letter.contentText;const subject=input.subject??letter.subject;
 const bodyHash=draftHash(subject+'\n'+body);
 const existing=document.knowledgeRechecks?.find(x=>x.requestKey===input.requestKey);
 if(existing){if(existing.bodyHash!==bodyHash)throw ApiError.conflict('复核请求标识已用于另一份正文');return existing;}
 if((document.knowledgeRechecks?.length??0)>=20)throw ApiError.conflict('本稿已有20次复核，请保存新稿继续，旧审核记录仍保留');
 const freshness=await knowledgeFreshness(review,actor);
 const stale=freshness.failed||freshness.changed.length>0;
 const bundle:KnowledgeBundle={projectId:review.projectId,status:stale?'index_stale':review.status,sources:stale?[]:review.sources,topics:[],issues:[],factContext:review.context.factContext};
 const profile=review.context.customerId&&review.context.customerProfile?{id:review.context.customerId,profile:review.context.customerProfile,websites:review.context.customerWebsites}:undefined;
 const result:{mode:'unavailable'|'semantic';checks:ClaimCheck[]}=stale?{mode:'unavailable' as const,checks:[{id:'stale',text:'依据状态',status:'unverifiable' as const,sourceIds:[],reason:'旧依据已变化或无法核对，请重新生成'}]}:await inspectEditedDraft(body,bundle,verifierOverride??providerFactVerifier(await resolveAgentProvider(),actor),profile);
 // A recheck includes the subject; it cannot be an unchecked channel for new commitments.
 if(subject){const subjectResult=await inspectEditedDraft(subject,bundle,stale?undefined:verifierOverride??providerFactVerifier(await resolveAgentProvider(),actor),profile);result.checks.unshift(...subjectResult.checks.map(c=>({...c,id:'subject-'+c.id})));if(subjectResult.mode==='unavailable')result.mode='unavailable';}
 await getLetter(id,actor);
 const after=await knowledgeFreshness(review,actor);if(after.failed||after.changed.length)throw ApiError.conflict('复核期间依据已变化，结果未保存，请重新生成');
 const record={requestKey:input.requestKey,bodyHash,checkedAt:new Date().toISOString(),mode:result.mode,checks:result.checks,freshness};
 const saved=await DevelopmentLetter.updateOne({_id:id,projectId:requireProjectId(actor),status:'draft',updatedAt:document.updatedAt,'knowledgeRechecks.requestKey':{$ne:input.requestKey}},{$push:{knowledgeRechecks:record}});
 if(!saved.matchedCount){const repeat=await DevelopmentLetter.findById(id);const found=repeat?.knowledgeRechecks?.find(x=>x.requestKey===input.requestKey);if(found?.bodyHash===bodyHash)return found;throw ApiError.conflict('草稿已变化，请重新核对');}
 return record;
}
