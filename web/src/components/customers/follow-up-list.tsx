/**
 * 跟进记录历史列表
 * ------------------------------------------------------------------
 * - 按跟进时间倒序（后端已排好），最新一条高亮并带「最新」标记
 * - 每条可编辑（复用新增弹窗）/ 删除（危险操作，走 ConfirmDialog）
 * - 展示：方式 / 结果徽章 + 跟进时间 + 内容 + 下一次跟进
 */
import * as React from 'react';
import { CalendarClock, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, ErrorState, InlineLoader } from '@/components/common/empty-state';
import { FOLLOW_UP_METHOD_LABEL, FOLLOW_UP_RESULT_LABEL } from '@/constants';
import { formatDate, formatDateTime, getFollowUpState } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { FollowUp } from '@/types';

export interface FollowUpListProps {
  followUps: FollowUp[];
  loading: boolean;
  error: string | null;
  /** 删除进行中（禁用按钮） */
  busy?: boolean;
  onRetry: () => void;
  onDelete: (followUp: FollowUp) => void | Promise<void>;
  /** 编辑按钮点击（由父级打开弹窗并预填该记录） */
  onEdit: (followUp: FollowUp) => void;
  /** 新增按钮点击（由父级打开弹窗） */
  onAdd: () => void;
}

/** 下一次跟进时间的提示文案与颜色（逾期红 / 今天琥珀 / 未来常规） */
function nextFollowUpHint(value?: string | Date | null): { text: string; className: string } | null {
  if (!value) return null;
  const state = getFollowUpState(value);
  const date = formatDate(value);
  if (state === 'overdue') return { text: `下次跟进 ${date}（已逾期）`, className: 'text-destructive' };
  if (state === 'today') return { text: `下次跟进 ${date}（今天）`, className: 'text-amber-600 dark:text-amber-400' };
  return { text: `下次跟进 ${date}`, className: 'text-muted-foreground' };
}

export function FollowUpList({
  followUps,
  loading,
  error,
  busy = false,
  onRetry,
  onDelete,
  onEdit,
  onAdd,
}: FollowUpListProps): React.JSX.Element {
  const [deleteTarget, setDeleteTarget] = React.useState<FollowUp | null>(null);

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    await onDelete(deleteTarget);
    setDeleteTarget(null);
  }, [deleteTarget, onDelete]);

  if (loading && followUps.length === 0) {
    return <InlineLoader label="正在加载跟进记录…" />;
  }

  if (error && followUps.length === 0) {
    return <ErrorState title="跟进记录加载失败" description={error} onRetry={onRetry} retrying={loading} />;
  }

  if (followUps.length === 0) {
    return (
      <EmptyState
        title="还没有跟进记录"
        description="记录每一次与客户的沟通，方便回顾进展与安排下一步。"
        action={
          <Button type="button" size="sm" onClick={onAdd}>
            <NotebookPen className="h-4 w-4" aria-hidden />
            新增跟进
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ol className="space-y-3">
        {followUps.map((item, index) => {
          const isLatest = index === 0;
          const hint = nextFollowUpHint(item.nextFollowUpAt);
          return (
            <li
              key={item.id}
              className={cn(
                'group rounded-lg border p-3.5 transition-colors',
                isLatest ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1.5">
                  {FOLLOW_UP_METHOD_LABEL[item.method] ?? item.method}
                </Badge>
                <Badge variant="secondary">{FOLLOW_UP_RESULT_LABEL[item.result] ?? item.result}</Badge>
                {isLatest ? (
                  <Badge variant="default" className="gap-1">
                    最新
                  </Badge>
                ) : null}
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {formatDateTime(item.followUpAt)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="编辑该跟进记录"
                  onClick={() => onEdit(item)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="删除该跟进记录"
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.content}</p>

              {hint ? <p className={cn('mt-2 text-xs', hint.className)}>{hint.text}</p> : null}
            </li>
          );
        })}
      </ol>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除跟进记录"
        description={
          deleteTarget
            ? `确定要删除 ${formatDate(deleteTarget.followUpAt)} 的这条跟进记录吗？删除后无法恢复。`
            : undefined
        }
        confirmText="删除"
        variant="destructive"
        loading={busy}
        onConfirm={confirmDelete}
      />
    </>
  );
}
