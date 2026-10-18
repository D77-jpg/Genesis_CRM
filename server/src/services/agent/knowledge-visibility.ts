import {AgentKnowledge} from '../../models/AgentKnowledge';
import {requireProjectId} from '../../utils/access';
import type {AuthUser} from '../../types/express';
import type {KnowledgeReview} from './knowledge-types';
// An old draft is an immutable record, not a permanent grant to private knowledge.
export async function redactPrivateReview(review:KnowledgeReview,actor:AuthUser):Promise<KnowledgeReview>{
 if(actor.role==='admin')return review;
 const rows=await AgentKnowledge.find({projectId:requireProjectId(actor),_id:{$in:review.sources.flatMap(s=>s.knowledgeId?[s.knowledgeId]:[])}}).lean();
 const denied=new Set(review.sources.filter(source=>{if(!source.knowledgeId)return false;const k=rows.find(k=>String(k._id)===source.knowledgeId);return !k||k.revisions.find(v=>v.version===source.version)?.accessScope==='admins'||k.revisions.find(v=>v.version===k.approvedVersion)?.accessScope==='admins';}).map(s=>s.sourceId));
 if(!denied.size)return review;
 return {...review,completeness:'partial',sources:review.sources.filter(s=>!denied.has(s.sourceId)),claims:review.claims.filter(c=>!c.sourceIds.some(id=>denied.has(id))),questions:review.questions.filter(q=>!q.sourceIds.some(id=>denied.has(id))),issues:[...review.issues.filter(i=>!i.sourceIds?.some(id=>denied.has(id))),{code:'access_changed',message:'部分历史依据无权查看，请管理员核对后重新生成'}],factAudit:review.factAudit?{...review.factAudit,checks:review.factAudit.checks.filter(c=>!c.sourceIds.some(id=>denied.has(id))&&!c.quotes?.some(q=>denied.has(q.sourceId))),facts:review.factAudit.facts.filter(f=>!denied.has(f.sourceId))}:undefined};
}
