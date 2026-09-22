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

export interface CustomerAnalysisInput {
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

export interface AgentProvider {
  readonly name: AgentProviderName;
  readonly model: string;
  isAvailable(): boolean;
  createTurn(request: AgentProviderRequest): Promise<AgentProviderTurn>;
  extractCustomer(request: CustomerExtractionRequest): Promise<CustomerExtractionResult>;
  analyzeCustomer(request: CustomerAnalysisRequest): Promise<CustomerAnalysisResult>;
  analyzeMailThread(request: MailThreadAnalysisRequest): Promise<MailThreadAnalysisResult>;
}

export class AgentProviderError extends Error {
  constructor(public readonly code: string, message = 'Agent provider unavailable') {
    super(message);
    this.name = 'AgentProviderError';
  }
}
