import type {SalesRequirements,SalesMailKind} from './sales-evidence';
import type {KnowledgeBundle} from './knowledge-types';
import type {ProjectPromptContext} from '../project-profile';
import type {
  AgentContextType,
  AgentCustomerPreviewFields,
  AgentCustomerUncertainty,
  AgentProviderName,
} from '../../models';

export type AgentInputItem = Record<string, unknown>;

export interface AgentToolSchema {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export interface AgentProviderRequest {
  instructions: string;
  input: AgentInputItem[];
  tools: AgentToolSchema[];
  context: { type: AgentContextType; resourceId?: string; direction?: 'inbound' | 'outbound' };
  userPrompt: string;
  safetyIdentifier: string;
  outputFormat?: {type:'json_schema';name:string;strict:true;schema:Record<string,unknown>}|{type:'text'};
}

export interface AgentProviderTurn {
  text: string;
  output: AgentInputItem[];
  toolCalls: { callId: string; name: string; arguments: string }[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface CustomerExtractionRequest {
  content: string;
  safetyIdentifier: string;
}

export interface CustomerExtractionResult {
  fields: AgentCustomerPreviewFields;
  uncertainties: AgentCustomerUncertainty[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface PreviousOutreachDraft {
  step: number;
  subject: string;
  bodyText: string;
}

export interface CustomerAnalysisInput {
  customerResearch?:import('../website/customer-research').CustomerResearchStatus;
  taskType?:SalesMailKind;userRequest?:string;salesRequirements?:SalesRequirements;
  knowledgeContext?: KnowledgeBundle;
  firstOutreach?: boolean;
  /** 当前是同一客户三封开发信序列中的第几封。 */
  outreachStep?: 1 | 2 | 3;
  /** 已生成的上一封（或前两封）；仅用于承接，不能当成新的我方事实。 */
  previousOutreach?: PreviousOutreachDraft[];
  projectProfile?: ProjectPromptContext;
  seller?: { companyName: string; website?: string; moq?: string; senderName: string; senderEmail?: string };
  customerName: string;
  customerEmail?: string;
  sourceCatalog: { sourceId: string; kind: string; label: string; content: unknown }[];
}

export interface CustomerAnalysisResult {
  facts: { text: string; sourceIds: string[] }[];
  gaps: { text: string; sourceIds: string[] }[];
  recommendations: { text: string; rationale: string; sourceIds: string[] }[];
  emailDraft: { subject: string; bodyText: string };
  followUpPlan: { method: 'email' | 'whatsapp' | 'phone' | 'chat' | 'other'; content: string; dueAt: string };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface CustomerAnalysisRequest {
  input: CustomerAnalysisInput;
  safetyIdentifier: string;
}

export interface MailThreadAnalysisInput {
  taskType?:SalesMailKind;userRequest?:string;salesRequirements?:SalesRequirements;
  knowledgeContext?: KnowledgeBundle;
  seller?:{companyName:string;senderName:string;senderEmail?:string;website?:string};
  productKnowledge?:{sourceId:string;title:string;content:string;version:number;approved:boolean}[];
  customer?: { id: string; name: string; company?: string; email?: string; status: string };
  messages: {
    messageId: string;
    direction: 'inbound' | 'outbound';
    subject: string;
    from: string;
    to: string[];
    text: string;
    sentAt: string;
  }[];
}

export interface MailThreadAnalysisResult {
  summary: string;
  intent: { category: 'inquiry' | 'quotation_request' | 'negotiation' | 'sample_request' | 'order' | 'support' | 'positive' | 'neutral' | 'unsubscribe' | 'bounce' | 'rejection' | 'other'; label: string; confidence: number; evidenceMessageIds: string[] };
  extracted: {
    products: { value: string; evidenceMessageIds: string[] }[];
    quantity: { value: string; evidenceMessageIds: string[] };
    price: { value: string; evidenceMessageIds: string[] };
    delivery: { value: string; evidenceMessageIds: string[] };
    questions: { text: string; evidenceMessageIds: string[] }[];
  };
  safety: { classification: 'normal' | 'unsubscribe' | 'bounce' | 'rejection'; reason: string; evidenceMessageIds: string[] };
  replyDraft: { subject: string; bodyText: string };
  statusSuggestion: { status: 'pending' | 'contacted' | 'replied' | 'interested' | 'quoting' | 'negotiating' | 'won' | 'lost'; reason: string };
  followUpSuggestion: { method: 'email' | 'whatsapp' | 'phone' | 'chat' | 'other'; content: string; result: 'no_reply' | 'replied' | 'interested' | 'quoted' | 'negotiating' | 'won' | 'no_need' | 'other'; nextFollowUpAt: string };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface MailThreadAnalysisRequest { input: MailThreadAnalysisInput; safetyIdentifier: string }

export interface FollowUpDraftInput {
  /** 这是第几封（2 或 3） */
  step: number;
  customer: { name: string; salutation: string; company?: string; email?: string };
  /** 上一封开发信 */
  previous: { subject: string; sentAt: string; excerpt: string };
  seller: { companyName: string; senderName: string };
  projectProfile?: ProjectPromptContext;
  /** 允许在跟进信里提到的事实（为空时只能做不含新事实的礼貌跟进） */
  allowedFacts: string[];
}

export interface FollowUpDraftResult {
  subject: string;
  bodyText: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface FollowUpDraftRequest {
  input: FollowUpDraftInput;
  safetyIdentifier: string;
}

export interface AgentProvider {
  readonly name: AgentProviderName;
  readonly model: string;
  isAvailable(): boolean;
  createTurn(request: AgentProviderRequest): Promise<AgentProviderTurn>;
  extractCustomer(request: CustomerExtractionRequest): Promise<CustomerExtractionResult>;
  analyzeCustomer(request: CustomerAnalysisRequest): Promise<CustomerAnalysisResult>;
  analyzeMailThread(request: MailThreadAnalysisRequest): Promise<MailThreadAnalysisResult>;
  /** 写第 2 / 3 封跟进信：基于上一封的实际内容，不引入新事实 */
  draftFollowUp(request: FollowUpDraftRequest): Promise<FollowUpDraftResult>;
}

export class AgentProviderError extends Error {
  constructor(public readonly code: string, message = 'Agent provider unavailable') {
    super(message);
    this.name = 'AgentProviderError';
  }
}
