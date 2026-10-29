import * as React from 'react';
import { AlertTriangle, Eraser, Loader2, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiPost } from '@/lib/api';
import type { DraftCleanupPlan, DraftCleanupPreview, DraftCleanupResult } from '@/types';

interface DraftCleanupDialogProps {
  open: boolean;
  customerIds: string[];
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}

function PlanSummary({ plan }: { plan: DraftCleanupPlan }): React.JSX.Element {
  const skipped = Boolean(plan.skipReason);
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{plan.name}</span>
        {skipped ? (
          <Badge variant="muted">跳过</Badge>
        ) : plan.removeCount > 0 ? (
          <Badge variant="pending">清理 {plan.removeCount} 封</Badge>
        ) : (
          <Badge variant="developed">仅补标注</Badge>
        )}
        {plan.keepCount > 0 ? <span className="text-xs text-muted-foreground">保留 {plan.keepCount} 封</span> : null}
        {plan.relabelCount > 0 ? <span className="text-xs text-muted-foreground">新标注 {plan.relabelCount} 封</span> : null}
      </div>
      {skipped ? <p className="mt-1 text-xs text-muted-foreground">{plan.skipReason}</p> : null}
      {plan.remove.length > 0 ? (
        <details className="mt-1.5 text-xs text-muted-foreground">
          <summary className="cursor-pointer">查看将删除的草稿（{plan.remove.length}）</summary>
          <ul className="mt-1 space-y-1">
            {plan.remove.map((item) => (
              <li key={item.id} className="flex flex-wrap gap-x-2">
                <span className="shrink-0">第 {item.step} 封</span>
                <span className="min-w-0 truncate">{item.subject}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/**
 * 老客户草稿整理：同一客户同一封保留一封，删除重复版本和已发送步骤的
 * 草稿，并给保留的草稿补上「第 N 封」标记。不会删除已发送记录。
 */
export function DraftCleanupDialog({
  open,
  customerIds,
  onOpenChange,
  onCompleted,
}: DraftCleanupDialogProps): React.JSX.Element {
  const [preview, setPreview] = React.useState<DraftCleanupPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const requestKey = customerIds.join(',');

  React.useEffect(() => {
    if (!open || customerIds.length === 0) return;
    let active = true;
    setPreview(null);
    setError('');
    setLoading(true);
    void apiPost<DraftCleanupPreview>('/customers/bulk/draft-cleanup/preview', { ids: customerIds })
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : '预览整理结果失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, requestKey, customerIds]);

  const handleSubmit = async (): Promise<void> => {
    if (!preview) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await apiPost<DraftCleanupResult>('/customers/bulk/draft-cleanup', { ids: customerIds });
      const details = [
        result.deleted > 0 ? `删除 ${result.deleted} 封重复草稿` : '',
        result.updated > 0 ? `补齐 ${result.updated} 条第几封标记` : '',
      ].filter(Boolean).join('，');
      const failedCount = result.failed.length;
      if (failedCount > 0) {
        toast.warning('草稿已部分整理', {
          description: `${details || '已完成能处理的部分'}；${failedCount} 个批次失败，请刷新后重试。`,
        });
      } else {
        toast.success('草稿已整理', {
          description: details || '没有需要清理的重复草稿。',
        });
      }
      onCompleted?.();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '整理草稿失败');
    } finally {
      setSubmitting(false);
    }
  };

  const plans = preview?.plans ?? [];
  const actionable = plans.filter((plan) => !plan.skipReason);
  const hasChanges = Boolean(preview && (preview.removed > 0 || preview.relabeled > 0 || preview.sentStepUpdates > 0));
  const buttonLabel = preview
    ? preview.removed > 0
      ? `清理 ${preview.removed} 封重复草稿`
      : '补齐第几封标记'
    : '准备中…';

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eraser className="h-4 w-4 text-primary" aria-hidden />
            整理重复草稿
          </DialogTitle>
          <DialogDescription>
            同一客户同一封只保留最合适的一封，删除重复版本和已发送步骤的旧草稿，并给保留的记录补上「第几封」标记。已发送记录不会被删除。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {loading ? (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              正在核对这 {customerIds.length} 位客户的草稿…
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          {preview && !loading ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['选中客户', preview.customers],
                  ['将清理', preview.removed],
                  ['保留草稿', preview.kept],
                  ['补标注', preview.relabeled + preview.sentStepUpdates],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              {!hasChanges ? (
                <p className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                  这些客户的草稿已经干净，不需要整理。
                </p>
              ) : null}

              {actionable.length ? (
                <section aria-label="整理明细">
                  <h3 className="text-sm font-semibold">整理明细</h3>
                  <ul className="mt-1 divide-y">
                    {actionable.map((plan) => <PlanSummary key={plan.customerId} plan={plan} />)}
                  </ul>
                </section>
              ) : null}

              {plans.length > actionable.length ? (
                <p className="text-xs text-muted-foreground">
                  另有 {plans.length - actionable.length} 位客户没有需要整理的草稿。
                </p>
              ) : null}
            </>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={loading || submitting || !hasChanges} onClick={() => void handleSubmit()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Tags className="h-4 w-4" aria-hidden />}
            {submitting ? '整理中…' : buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
