import * as React from 'react';
import {
  AlertOctagon, CheckCircle2, FileCheck2, Loader2, Mail, MessageSquareReply, Save, ShieldAlert, UserRoundCog,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CUSTOMER_STATUS_OPTIONS, FOLLOW_UP_METHOD_OPTIONS, FOLLOW_UP_RESULT_OPTIONS } from '@/constants';
import { apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useUiStore } from '@/store/ui.store';
import type { AgentMailThreadAnalysis, CustomerStatus, FollowUpMethod, FollowUpResult } from '@/types';

type Approval = 'reply' | 'status' | 'followup';
function newKey(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function localDateTime(value?: string | Date | null): string {
  if (!value) return '';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const intentLabels: Record<string, string> = {
  inquiry: '产品咨询', quotation_request: '询价/报价', negotiation: '商务谈判', sample_request: '样品请求', order: '订单意向',
  support: '售后/支持', positive: '积极反馈', neutral: '一般沟通', unsubscribe: '退订', bounce: '退信', rejection: '明确拒绝', other: '其他',
};
const safetyLabels = { normal: '未发现停止营销信号', unsubscribe: '客户退订', bounce: '邮件退信', rejection: '客户明确拒绝' } as const;

function Evidence({ ids, analysis }: { ids: string[]; analysis: AgentMailThreadAnalysis }) {
  if (!ids.length) return <span className="text-[11px] text-muted-foreground">未提取到明确来源</span>;
  return <div className="mt-1 flex flex-wrap gap-1">{ids.map((id) => {
    const source = analysis.sources.find((item) => item.messageId === id);
    const label = source?.label ?? `邮件 ${id.slice(-6)}`;
    return <Badge key={id} variant="outline" className="max-w-full truncate text-[10px]" title={label}>{label}</Badge>;
  })}</div>;
}

export function MailThreadAnalysisView({ analysisId, onRecordsChanged }: { analysisId: string; onRecordsChanged: () => Promise<void> }): React.JSX.Element {
  const clearAnalysis = useUiStore((state) => state.clearAgentMailAnalysis);
  const [analysis, setAnalysis] = React.useState<AgentMailThreadAnalysis | null>(null);
  const [subject, setSubject] = React.useState(''); const [bodyText, setBodyText] = React.useState('');
  const [customerStatus, setCustomerStatus] = React.useState<CustomerStatus>('pending'); const [statusReason, setStatusReason] = React.useState('');
  const [method, setMethod] = React.useState<FollowUpMethod>('email'); const [result, setResult] = React.useState<FollowUpResult>('replied');
  const [followUpContent, setFollowUpContent] = React.useState(''); const [nextFollowUpAt, setNextFollowUpAt] = React.useState('');
  const [loading, setLoading] = React.useState(true); const [saving, setSaving] = React.useState(false); const [error, setError] = React.useState('');
  const [confirmAction, setConfirmAction] = React.useState<Approval | null>(null); const [reviewed, setReviewed] = React.useState(false);

  const hydrate = React.useCallback((data: AgentMailThreadAnalysis) => {
    setAnalysis(data); setSubject(data.replyDraft.subject); setBodyText(data.replyDraft.bodyText);
    setCustomerStatus(data.statusSuggestion.status); setStatusReason(data.statusSuggestion.reason);
    setMethod(data.followUpSuggestion.method); setResult(data.followUpSuggestion.result); setFollowUpContent(data.followUpSuggestion.content);
    setNextFollowUpAt(localDateTime(data.followUpSuggestion.nextFollowUpAt));
  }, []);
  React.useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    void apiGet<AgentMailThreadAnalysis>(`/agent/mail-analyses/${analysisId}`).then((data) => { if (!cancelled) hydrate(data); })
      .catch((reason) => { if (!cancelled) setError(toErrorMessage(reason, '邮件会话分析加载失败')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [analysisId, hydrate]);

  function changed(target: Approval, current: AgentMailThreadAnalysis): boolean {
    if (target === 'reply') return subject !== current.replyDraft.subject || bodyText !== current.replyDraft.bodyText;
    if (target === 'status') return customerStatus !== current.statusSuggestion.status || statusReason !== current.statusSuggestion.reason;
    return method !== current.followUpSuggestion.method || result !== current.followUpSuggestion.result || followUpContent !== current.followUpSuggestion.content || nextFollowUpAt !== localDateTime(current.followUpSuggestion.nextFollowUpAt);
  }
  async function saveEdits(target: Approval, current = analysis): Promise<AgentMailThreadAnalysis | null> {
    if (!current || !changed(target, current)) return current;
    const payload: Record<string, unknown> = { expectedVersion: current.version };
    if (target === 'reply') payload.replyDraft = { subject, bodyText };
    if (target === 'status') payload.statusSuggestion = { status: customerStatus, reason: statusReason };
    if (target === 'followup') payload.followUpSuggestion = { method, result, content: followUpContent, nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null };
    setSaving(true); setError('');
    try {
      const updated = await apiPut<AgentMailThreadAnalysis>(`/agent/mail-analyses/${current.id}`, payload); hydrate(updated); await onRecordsChanged();
      toast.success('审批卡片编辑已保存'); return updated;
    } catch (reason) { setError(toErrorMessage(reason, '编辑保存失败')); return null; }
    finally { setSaving(false); }
  }
  async function confirm() {
    if (!analysis || !confirmAction || !reviewed) return;
    setSaving(true); setError('');
    try {
      let current = analysis;
      if (changed(confirmAction, current)) {
        const updated = await saveEdits(confirmAction, current); if (!updated) return; current = updated;
      }
      const endpoint = confirmAction === 'reply' ? 'save-reply-draft' : confirmAction === 'status' ? 'apply-customer-status' : 'save-followup';
      const response = await apiPost<{ analysis: AgentMailThreadAnalysis }>(`/agent/mail-analyses/${current.id}/${endpoint}`, { expectedVersion: current.version, idempotencyKey: newKey() });
      hydrate(response.analysis); await onRecordsChanged();
      toast.success(confirmAction === 'reply' ? '回复草稿已保存，未发送' : confirmAction === 'status' ? '客户状态已更新' : '跟进记录已保存');
      setConfirmAction(null); setReviewed(false);
    } catch (reason) { setError(toErrorMessage(reason, '确认写入失败')); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在分析邮件会话…</div>;
  if (!analysis) return <div className="p-4"><Alert variant="destructive"><AlertTitle>无法加载分析</AlertTitle><AlertDescription>{error || '分析不存在或无权访问'}</AlertDescription></Alert></div>;
  const blocked = analysis.safety.marketingBlocked;
  const replyLocked = blocked || analysis.replyStatus === 'saved';
  const statusLocked = analysis.customerStatusUpdate === 'updated';
  const followUpLocked = analysis.followUpStatus === 'saved';

  return <div className="min-h-0 flex-1 overflow-y-auto p-4">
    <div className="space-y-4">
      {blocked ? <Alert variant="destructive" className="border-2">
        <AlertOctagon className="h-4 w-4" aria-hidden /><AlertTitle>{safetyLabels[analysis.safety.classification]} · 已停止营销建议</AlertTitle>
        <AlertDescription>{analysis.safety.reason} 回复草稿已禁用，不会提供或保存营销发送内容。仍可在确认后记录客户状态与沟通结果。</AlertDescription>
      </Alert> : <Alert className="border-emerald-500/30 bg-emerald-500/5"><ShieldAlert className="h-4 w-4 text-emerald-600" aria-hidden /><AlertTitle>写入前逐项确认</AlertTitle><AlertDescription>分析本身只读。回复仅能保存为草稿，客户状态和跟进记录也需要分别确认。</AlertDescription></Alert>}
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">会话摘要</h3><div className="flex gap-2"><Badge>{intentLabels[analysis.intent.category] ?? analysis.intent.label}</Badge><Badge variant="outline">置信度 {Math.round(analysis.intent.confidence * 100)}%</Badge></div></div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{analysis.summary}</p><Evidence ids={analysis.intent.evidenceMessageIds} analysis={analysis} />
      </section>

      <section className="rounded-lg border p-4">
        <h3 className="font-semibold">需求提取</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{[
          ['产品', analysis.extracted.products.map((item) => item.value).join('、'), analysis.extracted.products.flatMap((item) => item.evidenceMessageIds)],
          ['数量', analysis.extracted.quantity.value, analysis.extracted.quantity.evidenceMessageIds],
          ['价格', analysis.extracted.price.value, analysis.extracted.price.evidenceMessageIds],
          ['交期', analysis.extracted.delivery.value, analysis.extracted.delivery.evidenceMessageIds],
        ].map(([label, value, ids]) => <div key={label as string} className="rounded-md bg-muted/50 p-3"><p className="text-xs font-medium text-muted-foreground">{label as string}</p><p className="mt-1 text-sm">{(value as string) || '未明确'}</p><Evidence ids={ids as string[]} analysis={analysis} /></div>)}</div>
        <div className="mt-3"><p className="text-xs font-medium text-muted-foreground">待回答问题</p>{analysis.extracted.questions.length ? <ul className="mt-2 space-y-2">{analysis.extracted.questions.map((item, index) => <li key={`${item.text}-${index}`} className="rounded-md bg-muted/50 p-3 text-sm">{item.text}<Evidence ids={item.evidenceMessageIds} analysis={analysis} /></li>)}</ul> : <p className="mt-1 text-sm">未提取到明确问题</p>}</div>
      </section>

      <section className={`rounded-lg border p-4 ${blocked ? 'border-destructive/40 bg-destructive/5' : ''}`}>
        <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><MessageSquareReply className="h-4 w-4" aria-hidden />审批 1 · 英文回复草稿</h3>{analysis.replyStatus === 'saved' && <Badge variant="developed"><CheckCircle2 className="h-3 w-3" aria-hidden />已保存</Badge>}</div>
        {blocked ? <p className="mt-3 text-sm font-medium text-destructive">禁止继续营销发送：当前线程不会生成或保存回复草稿。</p> : <div className="mt-3 space-y-3"><div className="space-y-1.5"><Label htmlFor="mail-agent-subject">主题</Label><Input id="mail-agent-subject" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={replyLocked || saving} /></div><div className="space-y-1.5"><Label htmlFor="mail-agent-body">英文正文</Label><Textarea id="mail-agent-body" value={bodyText} onChange={(event) => setBodyText(event.target.value)} disabled={replyLocked || saving} rows={9} /></div></div>}
        {!replyLocked && <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => void saveEdits('reply')} disabled={!changed('reply', analysis) || saving}><Save className="h-4 w-4" />保存编辑</Button><Button onClick={() => { setReviewed(false); setConfirmAction('reply'); }} disabled={!analysis.customerId || !subject.trim() || !bodyText.trim() || saving}><Mail className="h-4 w-4" />确认保存草稿</Button></div>}
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><UserRoundCog className="h-4 w-4" aria-hidden />审批 2 · 客户状态建议</h3>{statusLocked && <Badge variant="developed"><CheckCircle2 className="h-3 w-3" aria-hidden />已更新</Badge>}</div>
        <div className="mt-3 space-y-3"><div className="space-y-1.5"><Label htmlFor="mail-agent-customer-status">建议状态</Label><Select value={customerStatus} onValueChange={(value) => setCustomerStatus(value as CustomerStatus)} disabled={statusLocked || saving}><SelectTrigger id="mail-agent-customer-status"><SelectValue /></SelectTrigger><SelectContent>{CUSTOMER_STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="mail-agent-status-reason">建议理由</Label><Textarea id="mail-agent-status-reason" rows={3} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} disabled={statusLocked || saving} /></div></div>
        {!statusLocked && <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => void saveEdits('status')} disabled={!changed('status', analysis) || saving}><Save className="h-4 w-4" />保存编辑</Button><Button onClick={() => { setReviewed(false); setConfirmAction('status'); }} disabled={!analysis.customerId || !statusReason.trim() || saving}><UserRoundCog className="h-4 w-4" />确认更新状态</Button></div>}
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><FileCheck2 className="h-4 w-4" aria-hidden />审批 3 · 跟进记录建议</h3>{followUpLocked && <Badge variant="developed"><CheckCircle2 className="h-3 w-3" aria-hidden />已保存</Badge>}</div>
        {blocked && <p className="mt-2 text-xs font-medium text-destructive">受保护信号只允许记录沟通结果，不允许安排未来营销跟进。</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="mail-agent-followup-method">跟进方式</Label><Select value={method} onValueChange={(value) => setMethod(value as FollowUpMethod)} disabled={followUpLocked || saving}><SelectTrigger id="mail-agent-followup-method"><SelectValue /></SelectTrigger><SelectContent>{FOLLOW_UP_METHOD_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="mail-agent-followup-result">沟通结果</Label><Select value={result} onValueChange={(value) => setResult(value as FollowUpResult)} disabled={followUpLocked || saving}><SelectTrigger id="mail-agent-followup-result"><SelectValue /></SelectTrigger><SelectContent>{FOLLOW_UP_RESULT_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="mail-agent-followup-content">记录内容</Label><Textarea id="mail-agent-followup-content" rows={4} value={followUpContent} onChange={(event) => setFollowUpContent(event.target.value)} disabled={followUpLocked || saving} /></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="mail-agent-followup-time">下次跟进时间（可选）</Label><Input id="mail-agent-followup-time" type="datetime-local" value={blocked ? '' : nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} disabled={blocked || followUpLocked || saving} /></div></div>
        {!followUpLocked && <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => void saveEdits('followup')} disabled={!changed('followup', analysis) || saving}><Save className="h-4 w-4" />保存编辑</Button><Button onClick={() => { setReviewed(false); setConfirmAction('followup'); }} disabled={!analysis.customerId || !followUpContent.trim() || saving}><FileCheck2 className="h-4 w-4" />确认保存记录</Button></div>}
      </section>

      {!analysis.customerId && <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">当前线程未关联客户。你仍可查看只读分析，但不能执行任何写入动作。</p>}
      <Button type="button" variant="ghost" className="w-full" onClick={clearAnalysis}>返回 Agent 对话</Button>
    </div>

    <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) { setConfirmAction(null); setReviewed(false); } }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmAction === 'reply' ? '确认保存回复草稿？' : confirmAction === 'status' ? '确认更新客户状态？' : '确认保存跟进记录？'}</AlertDialogTitle><AlertDialogDescription>{confirmAction === 'reply' ? '将创建一条 draft 状态的线程回复，系统不会发送邮件。' : confirmAction === 'status' ? `将客户状态更新为“${CUSTOMER_STATUS_OPTIONS.find((item) => item.value === customerStatus)?.label ?? customerStatus}”。` : blocked ? '只记录退订、退信或拒绝结果，不会安排未来营销跟进。' : `将保存沟通结果${nextFollowUpAt ? `，并安排 ${formatDateTime(new Date(nextFollowUpAt))} 跟进` : ''}。`}</AlertDialogDescription></AlertDialogHeader>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"><Checkbox checked={reviewed} onCheckedChange={(value) => setReviewed(value === true)} /><span>我已核对以上可编辑内容，确认只执行本次审批卡片对应的写入动作。</span></label>
        <p className="text-xs text-muted-foreground">操作会记录审批人、时间和结果，并受项目权限与幂等保护。邮件不会直接发送。</p>
        <AlertDialogFooter><AlertDialogCancel disabled={saving}>返回核对</AlertDialogCancel><AlertDialogAction disabled={!reviewed || saving} onClick={(event) => { event.preventDefault(); void confirm(); }}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}确认写入</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
