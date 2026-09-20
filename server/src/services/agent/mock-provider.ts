import type { AgentInputItem, AgentProvider, AgentProviderRequest, AgentProviderTurn } from './provider';

function lastToolOutput(input: AgentInputItem[]): { callId: string; output: string } | null {
  const item = [...input].reverse().find((entry) => entry.type === 'function_call_output');
  if (!item) return null;
  return { callId: String(item.call_id ?? ''), output: String(item.output ?? '') };
}

function selectTool(request: AgentProviderRequest): { name: string; arguments: Record<string, unknown> } {
  const prompt = request.userPrompt.toLowerCase();
  const id = request.context.resourceId;
  if (request.context.type === 'mail' && id) {
    return { name: 'get_mail_thread', arguments: { mailId: id, direction: request.context.direction ?? 'inbound' } };
  }
  if (request.context.type === 'customer' && id) {
    if (/时间线|timeline|历史|发生/.test(prompt)) return { name: 'get_customer_timeline', arguments: { customerId: id, limit: 50 } };
    if (/跟进|follow/.test(prompt)) return { name: 'get_customer_followups', arguments: { customerId: id, limit: 50 } };
    if (/报价|quotation|quote/.test(prompt)) return { name: 'get_customer_quotations', arguments: { customerId: id, limit: 50 } };
    return { name: 'get_current_customer', arguments: { customerId: id } };
  }
  return { name: 'get_dashboard_summary', arguments: {} };
}

function summarize(output: string): string {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    if (Array.isArray(value.items)) return `已完成只读查询，共读取 ${value.items.length} 条记录。`;
    if ('name' in value) return `已读取客户“${String(value.name)}”的当前资料。`;
    if ('followUpToday' in value) {
      return `已读取仪表盘：今日待跟进 ${Number(value.followUpToday ?? 0)} 个，逾期 ${Number(value.followUpOverdue ?? 0)} 个，今日新增 ${Number(value.newCustomersToday ?? 0)} 个。`;
    }
    if ('thread' in value && Array.isArray(value.thread)) return `已读取该邮件线程，共 ${value.thread.length} 封邮件。`;
  } catch {
    // Mock 只给出保守提示，不把无法识别的原始工具结果直接回显。
  }
  return '已完成只读查询，相关数据没有被修改。';
}

export class MockAgentProvider implements AgentProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock-agent-v1';

  isAvailable(): boolean {
    return true;
  }

  async createTurn(request: AgentProviderRequest): Promise<AgentProviderTurn> {
    const prior = lastToolOutput(request.input);
    if (prior) {
      const text = `${summarize(prior.output)}\n\n当前为 Mock Provider，用于无 API Key 的本地验收；接入 OpenAI 后会基于这些只读数据生成更完整的分析。`;
      return {
        text,
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    const selected = selectTool(request);
    const callId = `mock_${Date.now().toString(36)}`;
    const call = { type: 'function_call', call_id: callId, name: selected.name, arguments: JSON.stringify(selected.arguments) };
    return {
      text: '',
      output: [call],
      toolCalls: [{ callId, name: selected.name, arguments: JSON.stringify(selected.arguments) }],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}
