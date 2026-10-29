import * as React from 'react';
import { AlertTriangle, FilePenLine, Loader2, Sparkles } from 'lucide-react';
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
import type { OutreachSequencePreview, OutreachSequencePlan, OutreachSequenceResult } from '@/types';

interface OutreachSequenceDialogProps {
  open: boolean;
  customerIds: string[];
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}

function StepBadges({ steps }: { steps: number[] }): React.JSX.Element {
  return (
    <span className="flex flex-wrap gap-1">
      {steps.map((step) => (
        <Badge key={step} variant="outline">第 {step} 封</Badge>
      ))}
    </span>
  );
}

function PlanRow({ plan }: { plan: OutreachSequencePlan }): React.JSX.Element {
  const skipped = Boolean(plan.skipReason);
  return (
    <li className="flex flex-col gap-1.5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{plan.name}</span>
        {skipped ? <Badge variant="muted">跳过</Badge> : <Badge variant="developed">将补齐 {plan.missingSteps.length} 封</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>已发送 {plan.sentCount} 封</span>
        {plan.draftSteps.length ? <span>已有草稿：{plan.draftSteps.join('、')}</span> : null}
        {!skipped ? <StepBadges steps={plan.missingSteps} /> : null}
        {skipped ? <span>{plan.skipReason}</span> : null}
      </div>
    </li>
  );
}

/**
 * 老客户补齐三封开发信：先预览，再按缺失步骤创建草稿任务。
 * 不重新生成已发送的步骤；所有生成结果都停留在草稿状态。
 */
export function OutreachSequenceDialog({
  open,
  customerIds,
  onOpenChange,
  onCompleted,
}: OutreachSequenceDialogProps): React.JSX.Element {
  const [preview, setPreview] = React.useState<OutreachSequencePreview | null>(null);
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
    void apiPost<OutreachSequencePreview>('/customers/bulk/outreach-sequence/preview', { ids: customerIds })
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : '预览生成失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, requestKey, customerIds]);

  const handleSubmit = async (): Promise<void> => {
    if (!preview || preview.totalDrafts === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await apiPost<OutreachSequenceResult>('/customers/bulk/outreach-sequence', { ids: customerIds });
      const failed = result.failed.length;
      toast.success(`已创建 ${result.created.length} 封开发信草稿`, {
        description: failed
          ? `${failed} 个步骤创建失败，可在对应客户的任务里重试。`
          : '草稿会陆续出现在客户详情的「当前客户的开发信草稿」中，不会自动发送。',
      });
      onCompleted?.();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建草稿任务失败');
    } finally {
      setSubmitting(false);
    }
  };

  const eligible = preview ? preview.plans.filter((plan) => !plan.skipReason) : [];
  const skipped = preview ? preview.plans.filter((plan) => plan.skipReason) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            补齐三封开发信
          </DialogTitle>
          <DialogDescription>
            按每个客户已发送和已有草稿的进度，只补缺失的步骤。所有内容只生成草稿，不会自动发送。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {loading ? (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              正在核对这 {customerIds.length} 位客户的历史记录…
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
                  ['选中客户', preview.plans.length],
                  ['将补齐', preview.eligible],
                  ['生成草稿', preview.totalDrafts],
                  ['跳过', preview.skipped],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              {preview.totalDrafts === 0 ? (
                <p className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                  这些客户没有需要补的步骤，或暂不满足补齐条件。
                </p>
              ) : null}

              {eligible.length ? (
                <section aria-label="将补齐的客户">
                  <h3 className="text-sm font-semibold">将补齐</h3>
                  <ul className="mt-1 divide-y">
                    {eligible.map((plan) => <PlanRow key={plan.customerId} plan={plan} />)}
                  </ul>
                </section>
              ) : null}

              {skipped.length ? (
                <details className="rounded-lg border border-border/70 bg-muted/10 p-3">
                  <summary className="cursor-pointer text-sm font-medium">跳过的客户（{skipped.length}）</summary>
                  <ul className="mt-1 divide-y">
                    {skipped.map((plan) => <PlanRow key={plan.customerId} plan={plan} />)}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={loading || submitting || !preview || preview.totalDrafts === 0}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FilePenLine className="h-4 w-4" aria-hidden />}
            {submitting ? '创建中…' : preview ? `开始生成 ${preview.totalDrafts} 封草稿` : '准备中…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
