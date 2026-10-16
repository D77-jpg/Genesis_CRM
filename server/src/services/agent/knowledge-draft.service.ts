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
 if(context.mailId){
  const analysis=await createMailThreadAnalysis({mailId:context.mailId,direction:context.direction??'inbound',idempotencyKey:'kb-regenerate-'+id+'-'+requestKey},actor);
  const saved=await saveMailReplyDraft(analysis.id,{expectedVersion:analysis.version,idempotencyKey:'kb-save-'+id+'-'+requestKey},actor);
  return {letterId:saved.letterId,customerId:letter.customerId};
 }
 const analysis=await createCustomerAnalysis({customerId:letter.customerId,idempotencyKey:'kb-regenerate-'+id+'-'+requestKey},actor,
  {firstOutreach:letter.knowledgeReview.taskType==='first_outreach',userRequest:context.request??'依据当前有效知识重新准备邮件草稿'});
 const saved=await saveAnalysisEmailDraft(analysis.id,{expectedVersion:analysis.version,idempotencyKey:'kb-save-'+id+'-'+requestKey},actor);
 return {letterId:saved.letterId,customerId:letter.customerId};
}
