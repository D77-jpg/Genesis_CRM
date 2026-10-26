import type {KnowledgeReview} from './knowledge-types';

const BLOCKING_REVIEW_CODES = new Set([
  'draft_unverified',
  'fact_budget',
  'index_stale',
  'retrieval_failed',
  'index_not_ready',
  'conflict',
  'access_changed',
]);

const HIGH_RISK_CLAIM = /\b(?:price|pricing|discount|free|sample|shipping|freight|payment|deposit|stock|exclusive|guarantee(?:d)?|certif(?:ied|icate)|legal|contract)\b|价格|报价|折扣|免费|样品|运费|付款|定金|库存|独家|保证|认证|合同|法律/i;

export function knowledgeReviewRequiresApproval(review?:KnowledgeReview):boolean{
 if(!review)return false;
 return (review.claims??[]).some(claim=>HIGH_RISK_CLAIM.test(claim.text));
}

// A generated draft may only be sent after its knowledge audit is complete enough.
// A deterministic fallback is safe to send, but a retained model draft, stale evidence
// or an unapproved high-risk commitment must not slip through the normal send route.
export function knowledgeReviewSendIssue(review?:KnowledgeReview):string|undefined{
 if(!review)return undefined;
 if(['retrieval_failed','index_stale','index_not_ready','conflict'].includes(review.status))return '依据检索状态异常';
 const issue=(review.issues??[]).find(issue=>BLOCKING_REVIEW_CODES.has(issue.code));
 if(issue)return issue.message;
 if(knowledgeReviewRequiresApproval(review)&&!review.manualApprovedAt)return '高风险内容还没有人工批准';
 return undefined;
}
