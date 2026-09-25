import * as React from 'react';
import { toast } from 'sonner';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { stripHtml } from '@/lib/format';
import { useProjectStore } from '@/store/project.store';
import type { LetterTemplate, TemplateSuggestion } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  template: LetterTemplate | null;
  onClose: () => void;
  onCopied: () => Promise<void>;
}

/** Suggestion preview is read-only: the sole template write is an explicit, separately confirmed copy. */
export function TemplateSuggestionDialog({ template, onClose, onCopied }: Props): React.JSX.Element {
  const projectId = useProjectStore((state) => state.activeProject?.id);
  const [suggestion, setSuggestion] = React.useState<TemplateSuggestion | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [checked, setChecked] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState('');
  const sequence = React.useRef(0);
  const confirmationKey = React.useRef<string | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; };
  }, []);
  const context = React.useRef(projectId);
  context.current = projectId;
  const current = (token: number, owner: string | undefined) => mounted.current && sequence.current === token && context.current === owner;

  React.useEffect(() => {
    sequence.current++;
    setSuggestion(null);
    setError(null);
    setBusy(false);
    setChecked(false);
    setConfirmation('');
    confirmationKey.current = null;
    if (!template || !projectId) return;
    const token = sequence.current;
    const owner = projectId;
    const key = crypto.randomUUID();
    setBusy(true);
    void (async () => {
      try {
        const generated = await apiPost<TemplateSuggestion>(`/templates/${template.id}/suggestions`, { idempotencyKey: key });
        if (!current(token, owner)) return;
        // Fetch the persisted preview, not a locally reconstructed suggestion.
        const fetched = await apiGet<TemplateSuggestion>(`/templates/${template.id}/suggestions/${generated.id}`);
        if (current(token, owner)) setSuggestion(fetched);
      } catch (caught) {
        if (current(token, owner)) setError(toErrorMessage(caught, '建议加载失败'));
      } finally {
        if (current(token, owner)) setBusy(false);
      }
    })();
  }, [template, projectId]);

  const copy = async () => {
    if (!template || !suggestion || !checked || confirmation.trim() !== '确认创建副本' || busy || suggestion.status !== 'preview') return;
    const token = sequence.current;
    const owner = projectId;
    const requestKey = confirmationKey.current ?? crypto.randomUUID();
    confirmationKey.current = requestKey;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<TemplateSuggestion>(`/templates/${template.id}/suggestions/${suggestion.id}/copy`, {
        expectedVersion: suggestion.version, requestKey,
      });
      if (!current(token, owner)) return;
      if (result.status !== 'copied' || !result.createdTemplateId) throw new Error('服务器未确认新副本，未刷新模板列表');
      setSuggestion(result);
      await onCopied();
      if (current(token, owner)) {
        toast.success('建议副本已创建；原模板未修改');
        onClose();
      }
    } catch (caught) {
      if (current(token, owner)) {
        setError(toErrorMessage(caught, '创建副本失败，请检查状态后重试'));
        // The server may have committed before a network failure; refresh status before another confirmation.
        try {
          const latest = await apiGet<TemplateSuggestion>(`/templates/${template.id}/suggestions/${suggestion.id}`);
          if (current(token, owner)) { setSuggestion(latest); setChecked(false); setConfirmation(''); if (latest.status !== 'preview' || latest.version !== suggestion.version) confirmationKey.current = null; }
        } catch { /* Keep error visible; do not retry the write automatically. */ }
      }
    } finally {
      if (current(token, owner)) setBusy(false);
    }
  };

  const close = async () => {
    if (busy) return;
    const token = ++sequence.current;
    const owner = projectId;
    const preview = suggestion;
    const source = template;
    onClose();
    if (source && preview?.status === 'preview') {
      try {
        await apiPost<TemplateSuggestion>(`/templates/${source.id}/suggestions/${preview.id}/cancel`);
      } catch (caught) {
        if (current(token, owner)) toast.error('取消建议失败', { description: toErrorMessage(caught) });
      }
    }
  };

  return (
    <Dialog open={Boolean(template)} onOpenChange={(open) => { if (!open) void close(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>建议副本 · 人工核对</DialogTitle>
          <DialogDescription>建议只生成预览；明确确认后才会创建新模板，绝不覆盖原模板。与普通「复制模板」操作独立。</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] space-y-4 overflow-y-auto text-sm">
          {busy && !suggestion ? <p role="status">正在生成并获取建议预览…</p> : null}
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
          {suggestion ? <>
            <p>模型：<strong>{suggestion.model}</strong>（规则生成，非 OpenAI；未据此推断效果） · 状态：{suggestion.status}</p>
            <p>原模板快照：{suggestion.sourceTemplateSnapshot.name} · 主题：{suggestion.sourceTemplateSnapshot.subject}</p>
            <p>核实已发送：{suggestion.sourceSummary.sentCount} 封；最低样本门槛：{suggestion.sourceSummary.minimumSampleSize}。其余漏斗数字未接入可信统计，不作为效果依据。</p>
            <ul className="list-disc space-y-1 pl-5">{suggestion.explanation.map((line, index) => <li key={index}>{line}</li>)}</ul>
            <section className="space-y-2 rounded-md border p-3">
              <h3 className="font-semibold">拟创建的新模板（只读预览）</h3>
              <p>名称：{suggestion.suggested.name}</p>
              <p>分类：{suggestion.suggested.category}</p>
              <p>主题：{suggestion.suggested.subject}</p>
              <p className="whitespace-pre-wrap break-words">正文预览：{stripHtml(suggestion.suggested.content, 2000)}</p>
              <p className="text-xs text-muted-foreground">正文仅作纯文本预览；请检查占位符及排版。确认后新副本保存服务器原始建议 HTML，不改原模板。</p>
            </section>
            {suggestion.status === 'preview' ? <>
              <Label className="flex items-start gap-2">
                <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} disabled={busy} />
                我已人工核对名称、主题、正文及占位符，明确同意创建独立副本（不覆盖原模板）
              </Label>
              <Label htmlFor="suggestion-confirm">请输入「确认创建副本」以执行创建</Label>
              <Input id="suggestion-confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
            </> : <p>此建议已{suggestion.status === 'copied' ? '创建副本' : '取消'}，无法再次确认。</p>}
          </> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void close()} disabled={busy}>{suggestion?.status === 'preview' ? '取消建议' : '关闭'}</Button>
          <Button type="button" onClick={() => void copy()} loading={busy && Boolean(suggestion)} disabled={!suggestion || suggestion.status !== 'preview' || !checked || confirmation.trim() !== '确认创建副本' || busy}>确认创建独立副本</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
