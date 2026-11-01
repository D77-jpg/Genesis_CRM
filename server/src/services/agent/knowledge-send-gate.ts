import type {KnowledgeReview} from './knowledge-types';

const BLOCKING_REVIEW_CODES = new Set([
  'fact_budget',
  'index_stale',
  'retrieval_failed',
  'index_not_ready',
  'conflict',
  'access_changed',
]);

const HIGH_RISK_CLAIM = /\b(?:price|pricing|discount|free(?![\s-]+weights?)|sample|shipping|freight|payment|deposit|stock|exclusive|guarantee(?:d)?|certif(?:ied|icate)|legal|contract)\b|价格|报价|折扣|免费|样品|运费|付款|定金|库存|独家|保证|认证|合同|法律/i;

export function knowledgeReviewRequiresApproval(review?:KnowledgeReview):boolean{
 if(!review)return false;
 return (review.claims??[]).some(claim=>HIGH_RISK_CLAIM.test(claim.text));
}

// A generated draft may only be sent after its knowledge audit is complete enough.
// `draft_unverified` means the verifier could not finish its work: it still requires
// an explicit human approval, but it is not a permanent dead end. Once the reviewer
// has inspected the body and approved it, the normal send route may proceed.
// Stale evidence or structural failures remain hard blocks even after approval.
// `manualApproved` is the "would this still be blocked after the human approves it?"
// probe used by the review UI; it bypasses the human-review gates only.
export function knowledgeReviewSendIssue(review?:KnowledgeReview,options?:{manualApproved?:boolean}):string|undefined{
 if(!review)return undefined;
 if(['retrieval_failed','index_stale','index_not_ready','conflict'].includes(review.status))return '依据检索状态异常';
 const issue=(review.issues??[]).find(issue=>BLOCKING_REVIEW_CODES.has(issue.code)||(issue.code==='draft_unverified'&&!options?.manualApproved&&!review.manualApprovedAt));
 if(issue)return issue.message;
 if(knowledgeReviewRequiresApproval(review)&&!review.manualApprovedAt&&!options?.manualApproved)return '高风险内容还没有人工批准';
 return undefined;
}

/** 人工批准也解决不了的硬拦截（依据异常、冲突等）；模型原稿和高风险待批准都可由人审放行。 */
export function knowledgeReviewHardBlocker(review?:KnowledgeReview):string|undefined{
 return knowledgeReviewSendIssue(review,{manualApproved:true});
}
