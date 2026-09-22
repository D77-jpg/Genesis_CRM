import type { AgentCustomerField, AgentCustomerPreviewFields, AgentCustomerUncertainty } from '../../models';
import type {
  AgentInputItem,
  AgentProvider,
  AgentProviderRequest,
  AgentProviderTurn,
  CustomerExtractionRequest,
  CustomerExtractionResult,
  CustomerAnalysisRequest,
  CustomerAnalysisResult,
  MailThreadAnalysisRequest,
  MailThreadAnalysisResult,
} from './provider';

function lineValue(content: string, labels: string[]): string {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = new RegExp(`^(?:${escaped})\\s*[：:]\\s*(.+)$`, 'im').exec(content);
  return match?.[1]?.trim() ?? '';
}

function priorityValue(content: string): 'high' | 'medium' | 'low' {
  const raw = lineValue(content, ['优先级', 'priority']).toLowerCase();
  if (/high|urgent|高|紧急/.test(raw)) return 'high';
  if (/low|低/.test(raw)) return 'low';
  return 'medium';
}

function mockExtract(content: string): { fields: AgentCustomerPreviewFields; uncertainties: AgentCustomerUncertainty[] } {
  const email = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  const phoneLine = lineValue(content, ['电话', '手机', 'phone', 'tel', 'mobile']);
  const fields: AgentCustomerPreviewFields = {
    company: lineValue(content, ['公司', '公司名称', 'company']),
    name: lineValue(content, ['联系人', '姓名', 'contact', 'contact name', 'name']),
    email,
    phone: phoneLine,
    country: lineValue(content, ['国家', '国家/地区', 'country', 'region']),
    industry: lineValue(content, ['行业', 'industry']),
    requirementNotes: lineValue(content, ['需求', '客户需求', 'requirement', 'requirements', 'needs']),
    leadSource: lineValue(content, ['来源', '业务来源', 'source', 'channel']),
    priority: priorityValue(content),
  };
  const labels: Record<AgentCustomerField, string> = {
    company: '公司', name: '联系人', email: '邮箱', phone: '电话', country: '国家', industry: '行业',
    requirementNotes: '需求', leadSource: '来源', priority: '优先级',
  };
  const uncertainties = (Object.keys(labels) as AgentCustomerField[])
    .filter((field) => field !== 'priority' && !fields[field])
    .map((field) => ({ field, reason: `随手记中未明确找到${labels[field]}`, confidence: 0.2 }));
  if (!lineValue(content, ['优先级', 'priority'])) {
    uncertainties.push({ field: 'priority', reason: '随手记中未注明优先级，暂按“中”处理', confidence: 0.4 });
  }
  return { fields, uncertainties };
}

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
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const value = parsed.data && typeof parsed.data === 'object' ? parsed.data as Record<string, unknown> : parsed;
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

  async extractCustomer(request: CustomerExtractionRequest): Promise<CustomerExtractionResult> {
    return { ...mockExtract(request.content), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
  }

  async analyzeCustomer(request: CustomerAnalysisRequest): Promise<CustomerAnalysisResult> {
    const profile = request.input.sourceCatalog.find((source) => source.kind === 'profile');
    const timeline = request.input.sourceCatalog.filter((source) => source.kind === 'timeline');
    const mails = request.input.sourceCatalog.filter((source) => source.kind === 'mail');
    const followups = request.input.sourceCatalog.filter((source) => source.kind === 'followup');
    const quotations = request.input.sourceCatalog.filter((source) => source.kind === 'quotation');
    const profileData = (profile?.content ?? {}) as Record<string, unknown>;
    const facts = [
      { text: `客户为 ${String(profileData.company || request.input.customerName)}，联系人 ${request.input.customerName}。`, sourceIds: profile ? [profile.sourceId] : [] },
      ...(profileData.requirementNotes ? [{ text: `已记录需求：${String(profileData.requirementNotes)}`, sourceIds: [profile!.sourceId] }] : []),
      ...(mails.length ? [{ text: `CRM 中共有 ${mails.length} 封可用于分析的往来邮件。`, sourceIds: mails.slice(0, 3).map((source) => source.sourceId) }] : []),
      ...(quotations.length ? [{ text: `已存在 ${quotations.length} 份报价记录。`, sourceIds: quotations.slice(0, 3).map((source) => source.sourceId) }] : []),
    ];
    const gaps = [
      ...(!profileData.email ? [{ text: '客户档案缺少邮箱，保存邮件草稿前需要补充。', sourceIds: profile ? [profile.sourceId] : [] }] : []),
      ...(!profileData.requirementNotes ? [{ text: '当前资料未明确记录采购需求或目标产品。', sourceIds: profile ? [profile.sourceId] : [] }] : []),
      ...(!quotations.length ? [{ text: '尚未找到报价记录，价格、MOQ 与交期仍需确认。', sourceIds: profile ? [profile.sourceId] : [] }] : []),
    ];
    const evidence = [profile?.sourceId, timeline[0]?.sourceId, followups[0]?.sourceId, mails[0]?.sourceId].filter(Boolean) as string[];
    const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    return {
      facts,
      gaps,
      recommendations: [{ text: '发送一封简短英文邮件，确认当前采购优先级、规格和目标时间。', rationale: '先补齐关键需求，再决定是否准备正式报价。', sourceIds: evidence.length ? evidence : profile ? [profile.sourceId] : [] }],
      emailDraft: {
        subject: `Next steps for ${String(profileData.company || request.input.customerName)}`,
        bodyText: `Dear ${request.input.customerName},\n\nThank you for your interest. To make sure we prepare the most relevant information, could you please confirm your preferred product specifications, estimated quantity, and target timeline?\n\nOnce we have these details, we will review the next steps with you.\n\nBest regards,`,
      },
      followUpPlan: { method: 'email', content: '确认客户规格、预计数量和目标采购时间，并根据回复准备下一步资料。', dueAt },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  async analyzeMailThread(request: MailThreadAnalysisRequest): Promise<MailThreadAnalysisResult> {
    const messages = request.input.messages;
    const latestInbound = [...messages].reverse().find((item) => item.direction === 'inbound');
    const evidence = latestInbound ? [latestInbound.messageId] : messages.length ? [messages[messages.length - 1]!.messageId] : [];
    const text = latestInbound?.text ?? '';
    const products = /(?:^|\n)\s*(?:product|model|产品|型号)\s*[:：]\s*([^\n。]+)/i.exec(text)?.[1]?.trim();
    const quantity = /(?:^|\n)\s*(?:quantity|qty|数量)\s*[:：]\s*([^\n。]+)/i.exec(text)?.[1]?.trim() ?? '';
    const price = /(?:^|\n)\s*(?:price|价格|报价)\s*[:：]\s*([^\n。]+)/i.exec(text)?.[1]?.trim() ?? '';
    const delivery = /(?:^|\n)\s*(?:delivery|lead time|交期|交货)\s*[:：]\s*([^\n。]+)/i.exec(text)?.[1]?.trim() ?? '';
    const questions = text.split(/(?<=[?？])/).map((item) => item.trim()).filter((item) => /[?？]$/.test(item)).slice(0, 5);
    const name = request.input.customer?.name || 'there';
    const subject = latestInbound?.subject ? (/^re:/i.test(latestInbound.subject) ? latestInbound.subject : `Re: ${latestInbound.subject}`) : 'Re: Your inquiry';
    return {
      summary: `该线程共有 ${messages.length} 封邮件。${latestInbound ? '最新一封客户来信已用于意图和需求提取。' : '当前未找到客户来信。'}`,
      intent: { category: /price|quote|报价/i.test(text) ? 'quotation_request' : 'inquiry', label: /price|quote|报价/i.test(text) ? '询价/报价请求' : '产品咨询', confidence: 0.82, evidenceMessageIds: evidence },
      extracted: {
        products: products ? [{ value: products, evidenceMessageIds: evidence }] : [],
        quantity: { value: quantity, evidenceMessageIds: quantity ? evidence : [] },
        price: { value: price, evidenceMessageIds: price ? evidence : [] },
        delivery: { value: delivery, evidenceMessageIds: delivery ? evidence : [] },
        questions: questions.map((question) => ({ text: question, evidenceMessageIds: evidence })),
      },
      safety: { classification: 'normal', reason: 'Mock Provider 未识别到受保护信号；服务端仍会独立复核。', evidenceMessageIds: evidence },
      replyDraft: { subject, bodyText: `Dear ${name},\n\nThank you for your message. We have noted your inquiry and will review the requested product details, quantity, pricing, and delivery expectations. Could you please confirm any missing specifications or target timeline?\n\nBest regards,` },
      statusSuggestion: { status: 'replied', reason: '客户已通过邮件回复，建议将状态更新为“已回复”。' },
      followUpSuggestion: { method: 'email', content: '记录本次邮件需求，并在未收到补充信息时进行一次人工跟进。', result: 'replied', nextFollowUpAt: new Date(Date.now() + 3 * 86400000).toISOString() },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}
