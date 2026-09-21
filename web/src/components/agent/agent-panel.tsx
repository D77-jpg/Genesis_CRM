import * as React from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bot,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Clock3,
  FileClock,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useEscapeKey, useIsMobile } from '@/hooks/use-ui';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';
import { useProjectStore } from '@/store/project.store';
import { useUiStore } from '@/store/ui.store';
import type { AgentAction, AgentContext, AgentMessage, AgentSession, AgentStatus, AgentUsage } from '@/types';
import { ScratchpadCustomerPreviewView } from './scratchpad-customer-preview';
import { CustomerAnalysisView } from './customer-analysis';

interface SendResult {
  userMessage: AgentMessage;
  assistantMessage: AgentMessage;
  degraded: boolean;
}

const EMPTY_USAGE: AgentUsage = {
  runs: 0, completed: 0, failed: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCalls: 0,
};

function routeContext(pathname: string, search: string): AgentContext {
  const customerMatch = /^\/customers\/([a-f\d]{24})(?:\/|$)/i.exec(pathname);
  if (customerMatch?.[1]) return { type: 'customer', resourceId: customerMatch[1] };
  if (pathname === '/mail' || pathname.startsWith('/mail/')) {
    const params = new URLSearchParams(search);
    const id = params.get('id');
    if (id && /^[a-f\d]{24}$/i.test(id)) {
      return { type: 'mail', resourceId: id, direction: params.get('direction') === 'outbound' ? 'outbound' : 'inbound' };
    }
  }
  return { type: 'global' };
}

function contextLabel(context: AgentContext): string {
  if (context.type === 'customer') return '当前客户';
  if (context.type === 'mail') return '当前邮件线程';
  return '当前项目';
}

function sameContext(left: AgentContext, right: AgentContext): boolean {
  return left.type === right.type
    && ('resourceId' in left ? left.resourceId : '') === ('resourceId' in right ? right.resourceId : '')
    && ('direction' in left ? left.direction : '') === ('direction' in right ? right.direction : '');
}

function suggestions(context: AgentContext): string[] {
  if (context.type === 'customer') return ['分析当前客户并建议下一步', '总结客户时间线', '查看最近跟进和报价'];
  if (context.type === 'mail') return ['总结当前邮件线程', '提取客户需求与待办', '建议下一步回复思路'];
  return ['总结今天的销售工作区', '有哪些逾期客户需要优先处理？', '给我一份今日工作建议'];
}

function actionLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_current_customer: '读取当前客户',
    get_customer_timeline: '读取客户时间线',
    get_mail_thread: '读取邮件线程',
    get_customer_followups: '读取跟进记录',
    get_customer_quotations: '读取报价记录',
    get_dashboard_summary: '读取仪表盘',
    extract_scratchpad_customer: '提取随手记客户',
    update_scratchpad_customer_preview: '编辑客户预览',
    create_customer_from_scratchpad: '确认创建客户',
    analyze_customer_and_draft_email: '分析客户并生成邮件草稿',
    edit_customer_analysis_draft: '编辑分析草稿',
    save_agent_email_draft: '确认保存开发信草稿',
    schedule_agent_followup: '确认安排跟进',
  };
  return labels[toolName] ?? toolName;
}

export function AgentPanel(): React.JSX.Element | null {
  const user = useAuthStore((state) => state.user);
  const project = useProjectStore((state) => state.activeProject);
  const open = useUiStore((state) => state.agentOpen);
  const setOpen = useUiStore((state) => state.setAgentOpen);
  const toggleOpen = useUiStore((state) => state.toggleAgent);
  const customerPreviewId = useUiStore((state) => state.agentCustomerPreviewId);
  const customerAnalysisId = useUiStore((state) => state.agentCustomerAnalysisId);
  const customerAnalysisCustomerId = useUiStore((state) => state.agentCustomerAnalysisCustomerId);
  const openCustomerAnalysis = useUiStore((state) => state.openAgentCustomerAnalysis);
  const clearCustomerAnalysis = useUiStore((state) => state.clearAgentCustomerAnalysis);
  const isMobile = useIsMobile();
  const location = useLocation();
  const context = React.useMemo(() => routeContext(location.pathname, location.search), [location.pathname, location.search]);

  const [status, setStatus] = React.useState<AgentStatus | null>(null);
  const [sessions, setSessions] = React.useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState('');
  const [messages, setMessages] = React.useState<AgentMessage[]>([]);
  const [usage, setUsage] = React.useState<AgentUsage>(EMPTY_USAGE);
  const [actions, setActions] = React.useState<AgentAction[]>([]);
  const [draft, setDraft] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [error, setError] = React.useState('');
  const [tab, setTab] = React.useState('chat');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const loadRecords = React.useCallback(async () => {
    const [nextUsage, nextActions] = await Promise.all([
      apiGet<AgentUsage>('/agent/usage'),
      apiGet<AgentAction[]>('/agent/approvals'),
    ]);
    setUsage(nextUsage);
    setActions(nextActions);
  }, []);

  const loadPanel = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextSessions] = await Promise.all([
        apiGet<AgentStatus>('/agent/status'),
        apiGet<AgentSession[]>('/agent/sessions'),
        loadRecords(),
      ]);
      setStatus(nextStatus);
      setSessions(nextSessions);
      const matching = nextSessions.find((item) => sameContext(item.context, context));
      setActiveSessionId(matching?.id ?? '');
    } catch (reason) {
      setError(toErrorMessage(reason, 'Agent 面板加载失败'));
    } finally {
      setLoading(false);
    }
  }, [context, loadRecords]);

  React.useEffect(() => {
    if (open && user && project) void loadPanel();
  }, [open, user, project, loadPanel]);

  React.useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void apiGet<AgentMessage[]>(`/agent/sessions/${activeSessionId}/messages`)
      .then((data) => { if (!cancelled) setMessages(data); })
      .catch((reason) => { if (!cancelled) setError(toErrorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeSessionId]);

  React.useEffect(() => {
    if (open) window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [open, activeSessionId]);

  React.useEffect(() => {
    if (customerAnalysisId) setTab('customer-analysis');
    else if (customerPreviewId) setTab('customer-preview');
    else if (tab === 'customer-preview' || tab === 'customer-analysis') setTab('chat');
  }, [customerAnalysisId, customerPreviewId, tab]);

  React.useEffect(() => {
    if (customerAnalysisId && (context.type !== 'customer' || customerAnalysisCustomerId !== context.resourceId)) clearCustomerAnalysis();
  }, [clearCustomerAnalysis, context, customerAnalysisCustomerId, customerAnalysisId]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleOpen]);

  React.useEffect(() => {
    if (!isMobile || !open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isMobile, open]);

  useEscapeKey(() => setOpen(false), open);

  async function createSession(): Promise<AgentSession> {
    const created = await apiPost<AgentSession>('/agent/sessions', { context });
    setSessions((current) => [created, ...current]);
    setActiveSessionId(created.id);
    setMessages([]);
    return created;
  }

  async function sendMessage(value = draft) {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    setError('');
    setDraft('');
    try {
      const session = activeSessionId ? sessions.find((item) => item.id === activeSessionId) : await createSession();
      if (!session) throw new Error('请选择或新建会话');
      const optimistic: AgentMessage = {
        id: `pending-${Date.now()}`, sessionId: session.id, role: 'user', content, status: 'completed', createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);
      const result = await apiPost<SendResult>(`/agent/sessions/${session.id}/messages`, { content });
      setMessages((current) => [
        ...current.filter((item) => item.id !== optimistic.id && item.id !== result.userMessage.id && item.id !== result.assistantMessage.id),
        result.userMessage,
        result.assistantMessage,
      ]);
      if (result.degraded) toast.warning('Agent 暂时不可用，CRM 其他功能不受影响');
      await loadRecords();
    } catch (reason) {
      setMessages((current) => current.filter((item) => !item.id.startsWith('pending-')));
      setDraft(content);
      setError(toErrorMessage(reason, '消息发送失败'));
    } finally {
      setSending(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function startCustomerAnalysis() {
    if (context.type !== 'customer' || analyzing) return;
    setAnalyzing(true);
    setError('');
    try {
      const analysis = await apiPost<{ id: string }>('/agent/customer-analyses', {
        customerId: context.resourceId,
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      openCustomerAnalysis(analysis.id, context.resourceId);
      await loadRecords();
    } catch (reason) {
      setError(toErrorMessage(reason, '客户分析生成失败，CRM 数据未改动'));
    } finally { setAnalyzing(false); }
  }

  if (!open || !user || !project) return null;

  const activeContext = sessions.find((session) => session.id === activeSessionId)?.context ?? context;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-2xl sm:top-14 sm:w-[440px]"
      aria-label="业务 Agent"
    >
      <div className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Bot className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">业务 Agent</h2>
            <Badge variant="outline" className="text-[10px]">V1.2 · 确认后写入</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">{project.name} · {contextLabel(activeContext)}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="关闭业务 Agent">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value="chat"><Sparkles className="h-3.5 w-3.5" />对话</TabsTrigger>
            {customerPreviewId && <TabsTrigger value="customer-preview"><UserPlus className="h-3.5 w-3.5" />客户预览</TabsTrigger>}
            {customerAnalysisId && <TabsTrigger value="customer-analysis"><BarChart3 className="h-3.5 w-3.5" />客户分析</TabsTrigger>}
            <TabsTrigger value="records"><FileClock className="h-3.5 w-3.5" />运行记录</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {status?.available ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <CircleOff className="h-3.5 w-3.5 text-amber-600" />}
            {status?.mode === 'mock' ? 'Mock' : status?.available ? 'OpenAI' : '未配置'}
          </div>
        </div>

        <TabsContent value="chat" className="m-0 flex min-h-0 flex-1 flex-col focus-visible:ring-0">
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <div className="relative min-w-0 flex-1">
              <select
                aria-label="选择 Agent 会话"
                className="h-9 w-full appearance-none truncate rounded-md border bg-background px-3 pr-8 text-sm"
                value={activeSessionId}
                onChange={(event) => setActiveSessionId(event.target.value)}
              >
                <option value="">新会话</option>
                {sessions.map((session) => <option key={session.id} value={session.id}>{session.title} · {contextLabel(session.context)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
            <Button type="button" variant="outline" size="icon" onClick={() => void createSession().catch((reason) => setError(toErrorMessage(reason)))} aria-label="新建 Agent 会话">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-start gap-2 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
            Agent 对话与分析数据读取保持只读；保存开发信草稿或安排跟进都需要你明确确认，Agent 不能直接发送邮件。
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" aria-busy={loading || sending}>
            {loading && messages.length === 0 && <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在加载会话…</div>}
            {!loading && messages.length === 0 && (
              <div className="space-y-5 py-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span>
                <div><p className="font-medium">从当前工作上下文开始</p><p className="mt-1 text-sm text-muted-foreground">Agent 会通过只读工具获取数据，再给出分析建议。</p></div>
                {context.type === 'customer' && <Button type="button" className="h-auto w-full justify-start py-3 text-left" onClick={() => void startCustomerAnalysis()} disabled={analyzing}>{analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}<span><span className="block">分析客户并生成英文邮件草稿</span><span className="mt-0.5 block text-xs font-normal opacity-80">汇总档案、时间线、邮件、跟进与报价</span></span></Button>}
                <div className="space-y-2">
                  {suggestions(context).filter((item) => context.type !== 'customer' || item !== '分析当前客户并建议下一步').map((item) => <Button key={item} type="button" variant="outline" className="h-auto w-full justify-start whitespace-normal py-2 text-left" onClick={() => void sendMessage(item)}>{item}</Button>)}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={message.role === 'user' ? 'ml-10 rounded-xl rounded-br-sm bg-primary px-3 py-2.5 text-sm text-primary-foreground' : `mr-5 rounded-xl rounded-bl-sm border bg-card px-3 py-3 text-sm ${message.status === 'failed' ? 'border-amber-500/40 bg-amber-500/5' : ''}`}>
                {message.role === 'assistant' && <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">AI 生成 · 请核对关键信息</p>}
                <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
              </article>
            ))}
            {sending && <div className="mr-20 flex items-center gap-2 rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取 CRM 数据并分析…</div>}
          </div>

          {error && <p role="alert" className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <form className="shrink-0 border-t p-3" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <label htmlFor="agent-message" className="sr-only">向业务 Agent 提问</label>
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                id="agent-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                maxLength={8000}
                rows={2}
                disabled={sending}
                placeholder={`询问${contextLabel(activeContext)}…`}
                className="min-h-11 max-h-32 resize-none text-base sm:text-sm"
              />
              <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!draft.trim() || sending} aria-label="发送消息">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Enter 发送 · Shift + Enter 换行</p>
          </form>
        </TabsContent>

        {customerPreviewId && <TabsContent value="customer-preview" className="m-0 flex min-h-0 flex-1 flex-col focus-visible:ring-0"><ScratchpadCustomerPreviewView previewId={customerPreviewId} onRecordsChanged={loadRecords} /></TabsContent>}
        {customerAnalysisId && <TabsContent value="customer-analysis" className="m-0 flex min-h-0 flex-1 flex-col focus-visible:ring-0"><CustomerAnalysisView analysisId={customerAnalysisId} onRecordsChanged={loadRecords} /></TabsContent>}

        <TabsContent value="records" className="m-0 min-h-0 flex-1 overflow-y-auto p-4 focus-visible:ring-0">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">运行</p><p className="mt-1 text-xl font-semibold tabular-nums">{usage.runs}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">工具调用</p><p className="mt-1 text-xl font-semibold tabular-nums">{usage.toolCalls}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Token</p><p className="mt-1 text-xl font-semibold tabular-nums">{usage.totalTokens.toLocaleString()}</p></div>
          </div>
          <div className="mt-5 flex items-center justify-between"><h3 className="text-sm font-semibold">工具与审批记录</h3><Badge variant="muted">写入需确认</Badge></div>
          <div className="mt-3 space-y-2">
            {actions.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">暂无工具调用记录</div>}
            {actions.map((action) => (
              <div key={action.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium">{actionLabel(action.toolName)}</p><Badge variant={action.executionStatus === 'succeeded' ? 'developed' : action.executionStatus === 'failed' ? 'failed' : 'muted'}>{action.executionStatus === 'succeeded' ? '成功' : action.executionStatus === 'failed' ? '失败' : action.executionStatus === 'rejected' ? '已取消' : '处理中'}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{action.resultSummary || '等待执行'} · {action.approvalStatus === 'not_required' ? '只读免审批' : action.approvalStatus === 'approved' ? '用户已确认' : '用户已取消'}</p>
                <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />{formatDateTime(action.createdAt)}</p>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
