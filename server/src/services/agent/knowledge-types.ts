export const KNOWLEDGE_CATEGORIES = ['company','product','trade','compliance','sales_rules','faq','reference'] as const;
export type KnowledgeCategory = typeof KNOWLEDGE_CATEGORIES[number];
export const POLICY_TOPICS = ['moq','lead_time','sample','price','shipping','payment','certification','trade_terms','capacity','other'] as const;
export type PolicyTopic = typeof POLICY_TOPICS[number];
import type {FactScope,FactContext,ConditionalEvidence} from './conditional-facts';
export interface CustomerWebsiteSnapshot {sourceId:string;url:string;text:string;sha256:string;collectedAt:string}
export interface CustomerFactProfile {name:string;company:string;country:string;industry:string;interestedProducts:string}
export interface KnowledgeTerm {
  publicationIndex?:number;scope?:FactScope;
  topic: PolicyTopic; value: string; conditions: string; unit?: string; currency?: string;
  min?: number; max?: number; mode: 'reference'|'confirmed'|'needs_confirmation';
}
export interface KnowledgeSource {
  index?:{scores?:Record<string,number>;selection:'explicit'|'semantic';generation:string;model:string;modelName:string;revision:string;dimension:number;manifest:string;chunks:{id:string;contentHash:string;location:Record<string,unknown>;sourceRefs:Record<string,unknown>[]}[]};
  publication?:{contentHash:string;location:Record<string,unknown>;sourceRefs:Record<string,unknown>[]};
  sourceId: string; knowledgeId?: string; quotationId?: string; agreementId?:string;customerId?:string; version: number; title: string;
  category: KnowledgeCategory; kind: 'knowledge'|'quotation'|'agreement'; content: string; source: string;
  applicability: string; products: string[]; validFrom: string; validUntil?: string; terms: KnowledgeTerm[];
}
export interface KnowledgeIssue { code: string; message: string; sourceIds?: string[]; topic?: PolicyTopic }
export interface KnowledgeBundle {
  factContext?:FactContext;facts?:ConditionalEvidence[];
  retrieval?:{engine:'keyword'|'local_semantic';generation?:string;identity?:string;trace?:Record<string,unknown>};
  projectId: string; status: 'index_not_ready'|'index_stale'|'ready'|'no_match'|'retrieval_failed'|'expired'|'conflict';
  sources: KnowledgeSource[]; issues: KnowledgeIssue[]; topics: PolicyTopic[];
}
export interface KnowledgeReview {
  factAudit?:{contract:'s4.1';mode:'semantic'|'deterministic'|'unavailable';attempts:number;checks:ClaimCheck[];facts:ConditionalEvidence[]};
  version: 1; projectId: string; taskType: string; generatedAt: string;
  status: KnowledgeBundle['status']; completeness: 'complete'|'partial';
  sources: KnowledgeSource[]; claims: {text:string;sourceIds:string[];topic?:PolicyTopic}[];
  questions: {question:string;topic?:PolicyTopic;status:'answered'|'unanswered';sourceIds:string[]}[];
  issues: KnowledgeIssue[]; context: {customerWebsites?:CustomerWebsiteSnapshot[];customerProfile?:CustomerFactProfile;factContext?:FactContext;customerId?:string;mailId?:string;direction?:'inbound'|'outbound';request?:string};
  bodyHash: string;
}
export interface ClaimCheck {id:string;text:string;status:'supported'|'unsupported'|'contradicted'|'unverifiable'|'non_claim';sourceIds:string[];reason:string;quotes?:{sourceId:string;quote:string;start:number;end:number}[];/** 原段落序号：核验按句子做，重建时据此把同段句子合回一段 */block?:number}
export interface KnowledgeFreshness { checkedAt: string; changed: {sourceId:string;title:string;reason:string}[]; failed?:boolean }

// One retrieved source points at one published entry; its provenance carries a
// ref per parser chunk (tens for a 10,000-character entry). The citation panel
// links to the document and a handful of chunk excerpts, so keep a bounded,
// de-duplicated slice. The unbounded list made an ordinary bundle 400 KB and
// tripped the 160 KB workflow step budget before any draft could be written.
export const MAX_PROVENANCE_REFS = 4;
export function boundedRefs(refs: Record<string, unknown>[] | undefined): Record<string, unknown>[] {
  const seen = new Set<string>(), kept: Record<string, unknown>[] = [];
  for (const ref of refs ?? []) {
    const key = [ref.documentId, ref.parsingRevisionId, ref.chunkId].some(value => value !== undefined)
      ? [ref.documentId, ref.parsingRevisionId, ref.chunkId].map(value => String(value ?? '')).join(':') : JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key); kept.push(ref);
    if (kept.length >= MAX_PROVENANCE_REFS) break;
  }
  return kept;
}

// One source without ranking/provenance diagnostics. The model cites sourceId;
// the review panel keeps the full snapshot on the bundle.
export function knowledgeSourceForModel(source:KnowledgeSource){const {index:_index,publication:_publication,...rest}=source;return rest;}

// Administrator diagnostics are not facts for generation. Preserve the full selected
// publication/snapshot, but never send rejected candidate excerpts or ranking traces.
export function knowledgeForModel(bundle:KnowledgeBundle):KnowledgeBundle {
 const retrieval=bundle.retrieval;
 // Ranking diagnostics (per-chunk locations and provenance refs) stay internal:
 // they can be megabytes for long collected documents and are not facts.
 const sources=bundle.sources.map(({index:_diagnostics,publication:_provenance,...source})=>source);
 return {...bundle,sources,retrieval:retrieval?{engine:retrieval.engine,generation:retrieval.generation,identity:retrieval.identity}:undefined};
}
