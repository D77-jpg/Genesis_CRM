export const KNOWLEDGE_CATEGORIES = ['company','product','trade','compliance','sales_rules','faq'] as const;
export type KnowledgeCategory = typeof KNOWLEDGE_CATEGORIES[number];
export const POLICY_TOPICS = ['moq','lead_time','sample','price','shipping','payment','certification','trade_terms','capacity','other'] as const;
export type PolicyTopic = typeof POLICY_TOPICS[number];
export interface KnowledgeTerm {
  topic: PolicyTopic; value: string; conditions: string; unit?: string; currency?: string;
  min?: number; max?: number; mode: 'reference'|'confirmed'|'needs_confirmation';
}
export interface KnowledgeSource {
  index?:{scores?:Record<string,number>;selection:'explicit'|'semantic';generation:string;model:string;modelName:string;revision:string;dimension:number;manifest:string;chunks:{id:string;contentHash:string;location:Record<string,unknown>;sourceRefs:Record<string,unknown>[]}[]};
  sourceId: string; knowledgeId?: string; quotationId?: string; version: number; title: string;
  category: KnowledgeCategory; kind: 'knowledge'|'quotation'; content: string; source: string;
  applicability: string; products: string[]; validFrom: string; validUntil?: string; terms: KnowledgeTerm[];
}
export interface KnowledgeIssue { code: string; message: string; sourceIds?: string[]; topic?: PolicyTopic }
export interface KnowledgeBundle {
  retrieval?:{engine:'keyword'|'local_semantic';generation?:string;identity?:string;trace?:Record<string,unknown>};
  projectId: string; status: 'index_not_ready'|'index_stale'|'ready'|'no_match'|'retrieval_failed'|'expired'|'conflict';
  sources: KnowledgeSource[]; issues: KnowledgeIssue[]; topics: PolicyTopic[];
}
export interface KnowledgeReview {
  version: 1; projectId: string; taskType: string; generatedAt: string;
  status: KnowledgeBundle['status']; completeness: 'complete'|'partial';
  sources: KnowledgeSource[]; claims: {text:string;sourceIds:string[];topic?:PolicyTopic}[];
  questions: {question:string;topic?:PolicyTopic;status:'answered'|'unanswered';sourceIds:string[]}[];
  issues: KnowledgeIssue[]; context: {customerId?:string;mailId?:string;direction?:'inbound'|'outbound';request?:string};
  bodyHash: string;
}
export interface KnowledgeFreshness { checkedAt: string; changed: {sourceId:string;title:string;reason:string}[]; failed?:boolean }
