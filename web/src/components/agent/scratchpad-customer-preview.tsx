import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Save, ShieldCheck, UserPlus, XCircle } from 'lucide-react';
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
import { useUiStore } from '@/store/ui.store';
import type { AgentCustomerField, AgentCustomerPreview, AgentCustomerPreviewFields, CustomerPriority } from '@/types';

const FIELD_LABELS: Record<AgentCustomerField, string> = {
  company: '公司', name: '联系人', email: '邮箱', phone: '电话', country: '国家 / 地区', industry: '行业',
  requirementNotes: '客户需求', leadSource: '业务来源', priority: '优先级',
};

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function FieldLabel({ field, preview }: { field: AgentCustomerField; preview: AgentCustomerPreview }) {
  const uncertain = preview.uncertainties.find((item) => item.field === field);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`agent-customer-${field}`}>{FIELD_LABELS[field]}</Label>
      {uncertain && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">待核对</Badge>}
      {uncertain && <span className="basis-full text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">{uncertain.reason}</span>}
    </div>
  );
}

export function ScratchpadCustomerPreviewView({ previewId, onRecordsChanged }: { previewId: string; onRecordsChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const clearPreview = useUiStore((state) => state.clearAgentCustomerPreview);
  const setAgentOpen = useUiStore((state) => state.setAgentOpen);
  const [preview, setPreview] = React.useState<AgentCustomerPreview | null>(null);
  const [fields, setFields] = React.useState<AgentCustomerPreviewFields | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [reviewed, setReviewed] = React.useState(false);
  const [duplicateAccepted, setDuplicateAccepted] = React.useState(false);
  const [error, setError] = React.useState('');
  const confirmKey = React.useRef(newKey());

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet<AgentCustomerPreview>(`/agent/scratchpad-customer/previews/${previewId}`);
      setPreview(data);
      setFields(data.fields);
    } catch (reason) {
      setError(toErrorMessage(reason, '客户预览加载失败'));
    } finally { setLoading(false); }
  }, [previewId]);

  React.useEffect(() => { void load(); }, [load]);

  function change<K extends keyof AgentCustomerPreviewFields>(field: K, value: AgentCustomerPreviewFields[K]) {
    setFields((current) => current ? { ...current, [field]: value } : current);
  }

  async function save(): Promise<AgentCustomerPreview | null> {
    if (!preview || !fields || saving) return null;
    setSaving(true);
    setError('');
    try {
      const updated = await apiPut<AgentCustomerPreview>(`/agent/scratchpad-customer/previews/${preview.id}`, {
        expectedVersion: preview.version, fields,
      });
      setPreview(updated);
      setFields(updated.fields);
      toast.success('预览已保存并重新查重');
      return updated;
    } catch (reason) {
      setError(toErrorMessage(reason, '预览保存失败'));
      return null;
    } finally { setSaving(false); }
  }

  async function confirmCreate() {
    let current = preview;
    if (!current || !fields) return;
    const changed = JSON.stringify(fields) !== JSON.stringify(current.fields);
    if (changed) current = await save();
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      const result = await apiPost<{ preview: AgentCustomerPreview; customerId: string }>(`/agent/scratchpad-customer/previews/${current.id}/confirm`, {
        expectedVersion: current.version,
        idempotencyKey: confirmKey.current,
        duplicateAcknowledged: duplicateAccepted,
      });
      setPreview(result.preview);
      setFields(result.preview.fields);
      setConfirmOpen(false);
      toast.success('客户已创建', { description: '原随手记保持不变' });
      await onRecordsChanged();
    } catch (reason) {
      setConfirmOpen(false);
      setError(toErrorMessage(reason, '客户创建失败，随手记未改动'));
      await load();
      await onRecordsChanged();
    } finally { setSaving(false); }
  }

  async function cancel() {
    if (!preview || saving) return;
    setSaving(true);
    setError('');
    try {
      const cancelled = await apiPost<AgentCustomerPreview>(`/agent/scratchpad-customer/previews/${preview.id}/cancel`);
      setPreview(cancelled);
      toast.info('已取消创建', { description: '原随手记没有改动' });
      await onRecordsChanged();
    } catch (reason) { setError(toErrorMessage(reason)); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在提取并检查重复客户…</div>;
  if (!preview || !fields) return <div className="p-4"><Alert variant="destructive"><AlertTitle>无法打开预览</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div>;

  const inactive = preview.status === 'cancelled' || preview.status === 'created';
  const hasChanges = JSON.stringify(fields) !== JSON.stringify(preview.fields);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold">随手记转客户</h3><p className="mt-1 text-xs text-muted-foreground">AI 提取结果可编辑；只有明确确认后才会创建。</p></div>
        <Badge variant="outline">AI 生成</Badge>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><XCircle className="h-4 w-4" /><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}。原随手记没有改动。</AlertDescription></Alert>}
      {preview.status === 'created' && <Alert className="mb-4 border-emerald-500/30 bg-emerald-500/5"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><AlertTitle>客户已创建</AlertTitle><AlertDescription>已完成审计记录，原随手记仍保留。</AlertDescription></Alert>}
      {preview.status === 'cancelled' && <Alert className="mb-4"><XCircle className="h-4 w-4" /><AlertTitle>已取消</AlertTitle><AlertDescription>没有创建客户，随手记保持原样。</AlertDescription></Alert>}

      {preview.duplicates.length > 0 && (
        <Alert className="mb-4 border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" /><AlertTitle>发现 {preview.duplicates.length} 个可能重复客户</AlertTitle>
          <AlertDescription className="mt-2 space-y-2">
            {preview.duplicates.map((item) => <div key={item.customerId} className="rounded-md border bg-background/70 p-2"><p className="font-medium text-foreground">{item.name}{item.company ? ` · ${item.company}` : ''}</p><p className="mt-1 text-xs">{item.reasons.join('、')}</p></div>)}
          </AlertDescription>
        </Alert>
      )}

      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {(['company', 'name', 'email', 'phone', 'country', 'industry', 'leadSource'] as AgentCustomerField[]).map((field) => (
          <div key={field} className="space-y-1.5"><FieldLabel field={field} preview={preview} /><Input id={`agent-customer-${field}`} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} value={String(fields[field])} onChange={(event) => change(field as keyof AgentCustomerPreviewFields, event.target.value as never)} disabled={inactive || saving} autoComplete={field === 'email' ? 'email' : field === 'phone' ? 'tel' : field === 'company' ? 'organization' : field === 'name' ? 'name' : 'off'} /></div>
        ))}
        <div className="space-y-1.5"><FieldLabel field="priority" preview={preview} /><Select value={fields.priority} onValueChange={(value) => change('priority', value as CustomerPriority)} disabled={inactive || saving}><SelectTrigger id="agent-customer-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">高</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="low">低</SelectItem></SelectContent></Select></div>
        <div className="space-y-1.5"><FieldLabel field="requirementNotes" preview={preview} /><Textarea id="agent-customer-requirementNotes" value={fields.requirementNotes} onChange={(event) => change('requirementNotes', event.target.value)} rows={4} disabled={inactive || saving} /></div>

        {!inactive && <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur"><Button type="button" variant="ghost" onClick={() => void cancel()} disabled={saving}>取消创建</Button><Button type="submit" variant="outline" disabled={!hasChanges || saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存并查重</Button><Button type="button" onClick={() => { setReviewed(false); setDuplicateAccepted(false); setConfirmOpen(true); }} disabled={saving}><UserPlus className="h-4 w-4" />确认创建客户</Button></div>}
      </form>

      {preview.status === 'created' && preview.createdCustomerId && <div className="mt-4 flex gap-2"><Button type="button" onClick={() => { setAgentOpen(false); navigate(`/customers/${preview.createdCustomerId}`); }}>查看客户</Button><Button type="button" variant="outline" onClick={clearPreview}>返回对话</Button></div>}
      {preview.status === 'cancelled' && <Button type="button" variant="outline" className="mt-4" onClick={clearPreview}><RotateCcw className="h-4 w-4" />返回 Agent 对话</Button>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认创建客户？</AlertDialogTitle><AlertDialogDescription>这会在当前项目中创建一条客户记录。原随手记不会被清空或修改。</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <label className="flex cursor-pointer items-start gap-2"><Checkbox checked={reviewed} onCheckedChange={(value) => setReviewed(value === true)} /><span>我已核对公司、联系人和联系方式，确认创建。</span></label>
            {preview.duplicates.length > 0 && <label className="flex cursor-pointer items-start gap-2 text-amber-700 dark:text-amber-300"><Checkbox checked={duplicateAccepted} onCheckedChange={(value) => setDuplicateAccepted(value === true)} /><span>我已查看可能重复的客户，仍要继续创建。</span></label>}
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />确认动作会记录操作人、时间和执行结果，并受幂等保护。</div>
          <AlertDialogFooter><AlertDialogCancel disabled={saving}>返回核对</AlertDialogCancel><AlertDialogAction disabled={!reviewed || (preview.duplicates.length > 0 && !duplicateAccepted) || saving} onClick={(event) => { event.preventDefault(); void confirmCreate(); }}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}确认创建</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
