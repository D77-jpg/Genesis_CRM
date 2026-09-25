import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, CheckCircle2, FileText, Lightbulb, Loader2, Mail, Save, ShieldCheck,
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
import { apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useUiStore } from '@/store/ui.store';
import type { AgentAnalysisClaim, AgentAnalysisSource, AgentCustomerAnalysis, FollowUpMethod } from '@/types';

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localDateTime(value: string | Date): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function SourceBadges({ ids, sources }: { ids: string[]; sources: AgentAnalysisSource[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="信息来源">
      {ids.map((id) => {
        const source = sources.find((item) => item.sourceId === id);
        return source ? <Badge key={id} variant="outline" className="max-w-full truncate text-[10px] font-normal">来源：{source.label}</Badge> : null;
      })}
    </div>
  );
}

function ClaimList({ items, sources, showRationale = false }: { items: AgentAnalysisClaim[]; sources: AgentAnalysisSource[]; showRationale?: boolean }) {
  return (
    <div className="space-y-2.5">
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className="rounded-lg border bg-background p-3">
          <p className="text-sm leading-relaxed">{item.text}</p>
          {showRationale && item.rationale && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">依据：{item.rationale}</p>}
          <SourceBadges ids={item.sourceIds} sources={sources} />
        </div>
      ))}
      {items.length === 0 && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">本次未识别到相关内容。</p>}
    </div>
  );
}

export function CustomerAnalysisView({ analysisId, onRecordsChanged }: { analysisId: string; onRecordsChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const clearAnalysis = useUiStore((state) => state.clearAgentCustomerAnalysis);
  const setAgentOpen = useUiStore((state) => state.setAgentOpen);
  const [analysis, setAnalysis] = React.useState<AgentCustomerAnalysis | null>(null);
  const [subject, setSubject] = React.useState('');
  const [bodyText, setBodyText] = React.useState('');
  const [method, setMethod] = React.useState<FollowUpMethod>('email');
  const [followUpContent, setFollowUpContent] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [confirmAction, setConfirmAction] = React.useState<'email' | 'followup' | null>(null);
  const [reviewed, setReviewed] = React.useState(false);
  const emailKey = React.useRef(newKey());
  const followUpKey = React.useRef(newKey());

  const hydrate = React.useCallback((data: AgentCustomerAnalysis) => {
    setAnalysis(data);
    setSubject(data.emailDraft.subject);
    setBodyText(data.emailDraft.bodyText);
    setMethod(data.followUpPlan.method);
    setFollowUpContent(data.followUpPlan.content);
    setDueAt(localDateTime(data.followUpPlan.dueAt));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try { hydrate(await apiGet<AgentCustomerAnalysis>(`/agent/customer-analyses/${analysisId}`)); }
    catch (reason) { setError(toErrorMessage(reason, '客户分析加载失败')); }
    finally { setLoading(false); }
  }, [analysisId, hydrate]);

  React.useEffect(() => { void load(); }, [load]);

  function hasEmailChanges(current: AgentCustomerAnalysis): boolean {
    return subject.trim() !== current.emailDraft.subject || bodyText.trim() !== current.emailDraft.bodyText;
  }

  function hasFollowUpChanges(current: AgentCustomerAnalysis): boolean {
    return method !== current.followUpPlan.method || followUpContent.trim() !== current.followUpPlan.content || dueAt !== localDateTime(current.followUpPlan.dueAt);
  }

  async function saveEdits(target?: 'email' | 'followup'): Promise<AgentCustomerAnalysis | null> {
    if (!analysis || saving) return null;
    const payload: Record<string, unknown> = { expectedVersion: analysis.version };
    if ((!target || target === 'email') && hasEmailChanges(analysis)) payload.emailDraft = { subject: subject.trim(), bodyText: bodyText.trim() };
    if ((!target || target === 'followup') && hasFollowUpChanges(analysis)) payload.followUpPlan = { method, content: followUpContent.trim(), dueAt: new Date(dueAt).toISOString() };
    if (Object.keys(payload).length === 1) return analysis;
    setSaving(true);
    setError('');
    try {
      const updated = await apiPut<AgentCustomerAnalysis>(`/agent/customer-analyses/${analysis.id}`, payload);
      hydrate(updated);
      toast.success('编辑内容已保存');
      return updated;
    } catch (reason) {
      setError(toErrorMessage(reason, '编辑内容保存失败'));
      return null;
    } finally { setSaving(false); }
  }

  async function confirm() {
    if (!analysis || !confirmAction) return;
    let current: AgentCustomerAnalysis | null = analysis;
    if ((confirmAction === 'email' && hasEmailChanges(analysis)) || (confirmAction === 'followup' && hasFollowUpChanges(analysis))) {
      current = await saveEdits(confirmAction);
    }
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      if (confirmAction === 'email') {
        const result = await apiPost<{ analysis: AgentCustomerAnalysis; letterId: string }>(`/agent/customer-analyses/${current.id}/save-email-draft`, {
          expectedVersion: current.version, idempotencyKey: emailKey.current,
        });
        hydrate(result.analysis);
        toast.success('开发信草稿已保存', { description: '邮件没有发送' });
      } else {
        const result = await apiPost<{ analysis: AgentCustomerAnalysis }>(`/agent/customer-analyses/${current.id}/schedule-followup`, {
          expectedVersion: current.version, idempotencyKey: followUpKey.current,
        });
        hydrate(result.analysis);
        toast.success('下一次跟进已安排');
      }
      setConfirmAction(null);
      setReviewed(false);
      await onRecordsChanged();
    } catch (reason) {
      setConfirmAction(null);
      setError(toErrorMessage(reason, '确认操作失败'));
      await load();
      await onRecordsChanged();
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在汇总客户资料并生成草稿…</div>;
  if (!analysis) return <div className="p-4"><Alert variant="destructive"><AlertTitle>无法打开客户分析</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div>;

  const emailLocked = analysis.emailStatus === 'saved';
  const followUpLocked = analysis.followUpStatus === 'scheduled';
  const sourceKinds = new Set(analysis.sources.map((source) => source.kind));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold">客户分析与邮件草稿</h3><p className="mt-1 text-xs text-muted-foreground">事实、缺口与建议分别展示；每一项均可追溯到 CRM 来源。</p></div>
        <Badge variant="outline">AI 生成 · 请核对</Badge>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertTriangle className="h-4 w-4" /><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="mb-4 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        <span>已读取 {analysis.sources.length} 个来源：</span>
        {(['profile', 'timeline', 'mail', 'followup', 'quotation'] as const).map((kind) => sourceKinds.has(kind) && <Badge key={kind} variant="muted">{{ profile: '档案', timeline: '时间线', mail: '邮件', followup: '跟进', quotation: '报价' }[kind]}</Badge>)}
      </div>

      <section className="mb-5" aria-labelledby="analysis-facts"><div className="mb-2 flex items-center gap-2"><FileText className="h-4 w-4 text-sky-600" /><h4 id="analysis-facts" className="text-sm font-semibold">事实摘要</h4><Badge variant="outline">仅陈述 CRM 已有信息</Badge></div><ClaimList items={analysis.facts} sources={analysis.sources} /></section>
      <section className="mb-5" aria-labelledby="analysis-gaps"><div className="mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><h4 id="analysis-gaps" className="text-sm font-semibold">信息缺口</h4></div><ClaimList items={analysis.gaps} sources={analysis.sources} /></section>
      <section className="mb-6" aria-labelledby="analysis-next"><div className="mb-2 flex items-center gap-2"><Lightbulb className="h-4 w-4 text-violet-600" /><h4 id="analysis-next" className="text-sm font-semibold">下一步建议</h4><Badge variant="outline">建议，不是事实</Badge></div><ClaimList items={analysis.recommendations} sources={analysis.sources} showRationale /></section>

      <section className="mb-5 rounded-xl border p-4" aria-labelledby="email-draft-title">
        <div className="mb-3 flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><h4 id="email-draft-title" className="text-sm font-semibold">英文邮件草稿</h4></div><p className="mt-1 text-xs text-muted-foreground">可编辑；保存后进入开发信草稿箱，不会发送。</p></div>{emailLocked && <Badge variant="developed"><CheckCircle2 className="h-3 w-3" />已保存</Badge>}</div>
        <div className="space-y-3"><div className="space-y-1.5"><Label htmlFor="agent-email-subject">Subject</Label><Input id="agent-email-subject" lang="en" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={emailLocked || saving} maxLength={300} /></div><div className="space-y-1.5"><Label htmlFor="agent-email-body">Email body</Label><Textarea id="agent-email-body" lang="en" value={bodyText} onChange={(event) => setBodyText(event.target.value)} disabled={emailLocked || saving} rows={10} maxLength={20000} /></div></div>
        {!emailLocked && <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => void saveEdits('email')} disabled={!hasEmailChanges(analysis) || saving}><Save className="h-4 w-4" />保存编辑</Button><Button type="button" onClick={() => { setReviewed(false); setConfirmAction('email'); }} disabled={!subject.trim() || !bodyText.trim() || saving}><Mail className="h-4 w-4" />保存为开发信草稿</Button></div>}
        {emailLocked && <Button type="button" variant="outline" className="mt-3" onClick={() => { setAgentOpen(false); navigate('/letters'); }}>前往开发信查看</Button>}
      </section>

      <section className="rounded-xl border p-4" aria-labelledby="followup-plan-title">
        <div className="mb-3 flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><h4 id="followup-plan-title" className="text-sm font-semibold">跟进计划</h4></div><p className="mt-1 text-xs text-muted-foreground">确认后写入客户的下一次跟进时间，并记录到时间线。</p></div>{followUpLocked && <Badge variant="developed"><CheckCircle2 className="h-3 w-3" />已安排</Badge>}</div>
        <div className="space-y-3"><div className="space-y-1.5"><Label htmlFor="agent-followup-method">跟进方式</Label><Select value={method} onValueChange={(value) => setMethod(value as FollowUpMethod)} disabled={followUpLocked || saving}><SelectTrigger id="agent-followup-method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">邮件</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem><SelectItem value="phone">电话</SelectItem><SelectItem value="chat">在线聊天</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="agent-followup-time">计划时间</Label><Input id="agent-followup-time" type="datetime-local" value={dueAt} min={localDateTime(new Date())} onChange={(event) => setDueAt(event.target.value)} disabled={followUpLocked || saving} /></div><div className="space-y-1.5"><Label htmlFor="agent-followup-content">跟进目的</Label><Textarea id="agent-followup-content" value={followUpContent} onChange={(event) => setFollowUpContent(event.target.value)} disabled={followUpLocked || saving} rows={4} /></div></div>
        {analysis.followUpPlan.reason && <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed"><p>建议依据：{analysis.followUpPlan.reason}</p><SourceBadges ids={analysis.followUpPlan.sourceIds} sources={analysis.sources} /><p className="mt-2 text-muted-foreground">{analysis.followUpPlan.manuallyEdited || hasFollowUpChanges(analysis) ? '跟进计划已人工编辑或正在编辑；上述依据来自原始建议，不代表修改后的内容已获来源验证。' : '依据来自已校验的 CRM 来源；请核对跟进目的和时间。'}</p></div>}
        {!followUpLocked && <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => void saveEdits('followup')} disabled={!hasFollowUpChanges(analysis) || saving}><Save className="h-4 w-4" />保存编辑</Button><Button type="button" onClick={() => { setReviewed(false); setConfirmAction('followup'); }} disabled={!dueAt || !followUpContent.trim() || saving}><CalendarClock className="h-4 w-4" />安排跟进</Button></div>}
        {followUpLocked && analysis.scheduledAt && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">已安排：{formatDateTime(analysis.scheduledAt)}</p>}
      </section>

      <Button type="button" variant="ghost" className="mt-4 w-full" onClick={clearAnalysis}>返回 Agent 对话</Button>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) { setConfirmAction(null); setReviewed(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirmAction === 'email' ? '确认保存开发信草稿？' : '确认安排下一次跟进？'}</AlertDialogTitle><AlertDialogDescription>{confirmAction === 'email' ? '将创建一条 draft 状态的开发信记录。系统不会发送邮件。' : `将把客户的下一次跟进时间更新为 ${dueAt ? formatDateTime(new Date(dueAt)) : '所选时间'}。`}</AlertDialogDescription></AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"><Checkbox checked={reviewed} onCheckedChange={(value) => setReviewed(value === true)} /><span>{confirmAction === 'email' ? '我已核对收件对象、英文主题和正文，仅保存草稿。' : '我已核对跟进时间和目的，确认写入客户记录。'}</span></label>
          <div className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />确认动作会记录操作人、时间和结果，并受幂等保护。Agent 没有直接发送邮件的能力。</div>
          <AlertDialogFooter><AlertDialogCancel disabled={saving}>返回核对</AlertDialogCancel><AlertDialogAction disabled={!reviewed || saving} onClick={(event) => { event.preventDefault(); void confirm(); }}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmAction === 'email' ? <Mail className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}{confirmAction === 'email' ? '确认保存草稿' : '确认安排跟进'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
