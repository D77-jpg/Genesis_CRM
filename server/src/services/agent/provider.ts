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

export interface AgentProvider {
  readonly name: AgentProviderName;
  readonly model: string;
  isAvailable(): boolean;
  createTurn(request: AgentProviderRequest): Promise<AgentProviderTurn>;
  extractCustomer(request: CustomerExtractionRequest): Promise<CustomerExtractionResult>;
}

export class AgentProviderError extends Error {
  constructor(public readonly code: string, message = 'Agent provider unavailable') {
    super(message);
    this.name = 'AgentProviderError';
  }
}
