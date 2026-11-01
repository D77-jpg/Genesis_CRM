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
import { apiGet, apiPost } from '@/lib/api';
import type { AgentTask } from '@/components/agent/agent-tasks';
import type { OutreachSequencePreview, OutreachSequencePlan, OutreachSequenceResult } from '@/types';

const WORKFLOW_STEPS = ['locate_customer', 'research_customer', 'analyze_customer', 'save_draft', 'verify_draft'];
const WORKFLOW_LABELS: Record<string, string> = {
  locate_customer: '定位客户',
  research_customer: '分析客户背景',
  analyze_customer: '分析与起草',
  save_draft: '保存草稿',
  verify_draft: '核对结果',
};
const TERMINAL_STATUSES = new Set<AgentTask['status']>(['awaiting_review', 'completed', 'failed', 'cancelled', 'waiting_input', 'paused']);

interface GenerationTask {
  taskId: string;
  customerId: string;
  step: number;
  status: AgentTask['status'];
  currentStep?: string;
  completedSteps: string[];
  error?: string;
}

interface GenerationState {
  tasks: GenerationTask[];
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  percent: number;
  done: boolean;
  creationFailed: number;
}

function taskProgress(task: GenerationTask): number {
  if (TERMINAL_STATUSES.has(task.status)) return 1;
  const completed = task.completedSteps.filter((step) => WORKFLOW_STEPS.includes(step)).length;
  return Math.min(0.95, completed / WORKFLOW_STEPS.length);
}

function summarizeGeneration(tasks: GenerationTask[], creationFailed: number): GenerationState {
  const completed = tasks.filter((task) => TERMINAL_STATUSES.has(task.status)).length;
  const succeeded = tasks.filter((task) => task.status === 'awaiting_review' || task.status === 'completed').length;
  const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled' || task.status === 'waiting_input' || task.status === 'paused').length;
  const rawPercent = tasks.length ? tasks.reduce((total, task) => total + taskProgress(task), 0) / tasks.length : 0;
  const percent = tasks.length > 0 && completed === tasks.length
    ? 100
    : Math.max(2, Math.min(99, Math.round(rawPercent * 100)));
  return {
    tasks,
    total: tasks.length,
    completed,
    succeeded,
    failed,
    percent,
    done: tasks.length > 0 && completed === tasks.length,
    creationFailed,
  };
}

function taskStatusLabel(task: GenerationTask): string {
  if (task.status === 'awaiting_review' || task.status === 'completed') return '草稿已生成';
  if (task.status === 'failed') return task.error || '生成失败';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'waiting_input') return '需要补充资料';
  if (task.status === 'paused') return '已暂停';
  if (task.status === 'queued') return '排队中';
  return task.currentStep ? WORKFLOW_LABELS[task.currentStep] ?? '正在生成' : '正在生成';
}

function ProgressBar({ percent, label }: { percent: number; label: string }): React.JSX.Element {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
    </div>
  );
}

function GenerationPanel({
  generation,
  plans,
}: {
  generation: GenerationState;
  plans?: OutreachSequencePlan[];
}): React.JSX.Element {
  const names = new Map((plans ?? []).map((plan) => [plan.customerId, plan.name]));
  return (
    <section className="rounded-lg border border-border/70 bg-muted/20 p-3.5" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{generation.done ? '草稿生成完成' : '正在生成开发信草稿'}</p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {generation.completed}/{generation.total}
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar
          percent={generation.percent}
          label={`补齐开发信进度 ${generation.percent}%`}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {generation.done
          ? generation.failed > 0 || generation.creationFailed > 0
            ? `有 ${generation.failed + generation.creationFailed} 封未完成，请在销售助手的任务里查看原因。`
            : '已自动更新到开发信记录，不会自动发送。'
          : '生成期间可以保持当前页面，完成后会直接出现在开发信记录中。'}
      </p>
      <ul className="mt-3 space-y-2">
        {generation.tasks.map((task) => (
          <li key={task.taskId} className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">
              {names.get(task.customerId) ?? '客户'} · 第 {task.step} 封
            </span>
            <span className={task.status === 'failed' || task.status === 'cancelled' || task.status === 'waiting_input' || task.status === 'paused' ? 'shrink-0 text-destructive' : 'shrink-0 text-muted-foreground'}>
              {taskStatusLabel(task)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface OutreachSequenceDialogProps {
  open: boolean;
  customerIds: string[];
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void | Promise<void>;
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
        {!skipped && plan.lastError ? <span className="text-destructive">上次失败：{plan.lastError}</span> : null}
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
  const [generation, setGeneration] = React.useState<GenerationState | null>(null);
  const [error, setError] = React.useState('');
  const requestKey = customerIds.join(',');

  React.useEffect(() => {
    if (!open || !requestKey) return;
    const ids = requestKey.split(',');
    let active = true;
    setPreview(null);
    setGeneration(null);
    setError('');
    setLoading(true);
    void apiPost<OutreachSequencePreview>('/customers/bulk/outreach-sequence/preview', { ids })
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
  }, [open, requestKey]);

  const handleSubmit = async (): Promise<void> => {
    if (!preview || preview.totalDrafts === 0) return;
    setSubmitting(true);
    setGeneration(null);
    setError('');
    try {
      const result = await apiPost<OutreachSequenceResult>('/customers/bulk/outreach-sequence', { ids: customerIds });
      if (result.created.length === 0) {
        setError(result.failed[0]?.message || '没有创建生成任务');
        return;
      }

      const tasks: GenerationTask[] = result.created.map((created) => ({
        taskId: created.taskId,
        customerId: created.customerId,
        step: created.step,
        status: 'queued',
        completedSteps: [],
      }));
      setGeneration(summarizeGeneration(tasks, result.failed.length));
      toast.info(`已开始生成 ${tasks.length} 封草稿`, {
        description: '进度会自动更新，完成后直接写入开发信记录，无需刷新页面。',
      });

      // The API creates durable AgentTasks; poll their real workflow state so
      // the dialog can show progress and refresh the letter history at the
      // exact moment the drafts become available.
      for (let attempt = 0; attempt < 300; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        const polled = await Promise.all(tasks.map(async (task) => {
          const current = await apiGet<AgentTask>(`/agent/tasks/${task.taskId}`);
          return {
            ...task,
            status: current.status,
            currentStep: current.currentStep,
            completedSteps: current.completedSteps ?? [],
            error: current.error?.message,
          };
        }));
        const next = summarizeGeneration(polled, result.failed.length);
        setGeneration(next);
        if (!next.done) continue;

        try {
          await onCompleted?.();
        } catch {
          toast.warning('草稿已生成，但列表自动刷新失败，请点击刷新');
        }
        if (next.failed > 0) {
          if (next.succeeded === 0) {
            toast.error('草稿生成未完成', {
              description: '请打开销售助手查看失败原因后重试。',
            });
          } else {
            toast.success(`${next.succeeded} 封草稿已生成`, {
              description: `${next.failed} 封未完成，请在销售助手的任务里查看原因。`,
            });
          }
        } else {
          toast.success(`${next.succeeded} 封草稿已生成`, {
            description: '已自动更新到开发信记录，不会自动发送。',
          });
        }
        return;
      }
      throw new Error('生成时间较长，任务仍在后台运行，请稍后在销售助手中查看');
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
      <DialogContent className="max-w-2xl" hideClose={submitting}>
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

          {generation ? <GenerationPanel generation={generation} plans={preview?.plans} /> : null}

          {preview && !loading && !generation ? (
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
          {generation ? (
            <Button type="button" disabled={submitting} onClick={() => onOpenChange(false)}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />生成中…</> : '完成'}
            </Button>
          ) : (
            <>
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
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
