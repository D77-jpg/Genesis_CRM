import env from '../../config/env';
import { AgentProviderError, type AgentInputItem, type AgentProvider, type AgentProviderRequest, type AgentProviderTurn } from './provider';

interface OpenAIResponse {
  status?: string;
  output?: AgentInputItem[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { code?: string; message?: string };
}

export interface OpenAIProviderConfig {
  apiKey?: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

function outputText(response: OpenAIResponse): string {
  if (typeof response.output_text === 'string') return response.output_text;
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content as Record<string, unknown>[]) {
      if (content.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
      if (content.type === 'refusal' && typeof content.refusal === 'string') parts.push(content.refusal);
    }
  }
  return parts.join('\n').trim();
}

export class OpenAIResponsesProvider implements AgentProvider {
  readonly name = 'openai' as const;
  readonly model: string;

  constructor(private readonly config: OpenAIProviderConfig = {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
  }) {
    this.model = config.model;
  }

  isAvailable(): boolean {
    return Boolean(this.config.apiKey);
  }

  async createTurn(request: AgentProviderRequest): Promise<AgentProviderTurn> {
    if (!this.config.apiKey) throw new AgentProviderError('OPENAI_NOT_CONFIGURED');
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
        body: JSON.stringify({
          model: this.config.model,
          store: false,
          instructions: request.instructions,
          input: request.input,
          tools: request.tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          include: ['reasoning.encrypted_content'],
          max_output_tokens: 1600,
          safety_identifier: request.safetyIdentifier,
        }),
      });
    } catch (error) {
      const code = error instanceof DOMException && error.name === 'TimeoutError' ? 'OPENAI_TIMEOUT' : 'OPENAI_UNREACHABLE';
      throw new AgentProviderError(code);
    }

    let body: OpenAIResponse;
    try {
      body = await response.json() as OpenAIResponse;
    } catch {
      throw new AgentProviderError('OPENAI_INVALID_RESPONSE');
    }
    if (!response.ok || body.status === 'failed') {
      throw new AgentProviderError(`OPENAI_${String(body.error?.code ?? response.status).toUpperCase()}`);
    }

    const output = Array.isArray(body.output) ? body.output : [];
    const toolCalls = output
      .filter((item) => item.type === 'function_call')
      .map((item) => ({
        callId: String(item.call_id ?? ''),
        name: String(item.name ?? ''),
        arguments: String(item.arguments ?? '{}'),
      }));
    const usage = body.usage ?? {};
    return {
      text: outputText(body),
      output,
      toolCalls,
      usage: {
        inputTokens: Number(usage.input_tokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? 0),
      },
    };
  }
}
