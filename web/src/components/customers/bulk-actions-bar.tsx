/**
 * 批量操作条
 * ------------------------------------------------------------------
 * 勾选任意一行后浮现，吸底显示，移动端也不会被表格挡住。
 * 删除走二次确认；标签 / 负责人 / 跟进时间弹 BulkActionDialog 确认后执行。
 * 客户状态由系统根据操作自动维护，不提供人工批量改状态。
 * 执行结果由页面 toast。
 */
import * as React from 'react';
import { CalendarClock, Eraser, Sparkles, Tag, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export interface BulkActionsBarProps {
  selectedCount: number;
  disabled?: boolean;
  busy?: boolean;
  /** 是否展示「分配负责人」（仅管理员；后端 bulk/owner 也限管理员） */
  canAssignOwner?: boolean;
  /** 打开「批量分配负责人」弹窗 */
  onAssignOwner: () => void;
  /** 打开「批量标签（添加 / 删除）」弹窗 */
  onManageTags: () => void;
  /** 打开「批量设置跟进时间」弹窗 */
  onSetFollowUp: () => void;
  onPrepareDrafts?:()=>void;
  /** 老客户按历史补齐第 1/2/3 封中缺失的步骤 */
  onBackfillSequences?: () => void;
  /** 清理老客户的重复草稿并补齐第几封标记 */
  onCleanupDrafts?: () => void;
  onDelete: () => void;
  onClear: () => void;
  className?: string;
}

export function BulkActionsBar({
  selectedCount,
  disabled = false,
  busy = false,
  canAssignOwner = true,
  onAssignOwner,
  onManageTags,
  onSetFollowUp,
  onPrepareDrafts,
  onBackfillSequences,
  onCleanupDrafts,
  onDelete,
  onClear,
  className,
}: BulkActionsBarProps): React.JSX.Element | null {
  if (selectedCount === 0) return null;

  const busyOrDisabled = disabled || busy;

  return (
    <div
      className={cn(
        'sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-card/95 px-3 py-2 shadow-lg backdrop-blur',
        'animate-in slide-in-from-bottom-2 duration-200',
        className,
      )}
      role="toolbar"
      aria-label="批量操作"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        已选
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold tabular-nums text-primary-foreground">
          {selectedCount}
        </span>
        项
      </span>

      {onPrepareDrafts ? (
        <Button variant="outline" className="min-h-11" disabled={busyOrDisabled || selectedCount > 20} onClick={onPrepareDrafts}>
          批量生成首封草稿
        </Button>
      ) : null}
      {onBackfillSequences ? (
        <Button variant="outline" className="min-h-11" disabled={busyOrDisabled || selectedCount > 20} onClick={onBackfillSequences}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          补齐三封开发信
        </Button>
      ) : null}
      {onCleanupDrafts ? (
        <Button variant="outline" className="min-h-11" disabled={busyOrDisabled || selectedCount > 20} onClick={onCleanupDrafts}>
          <Eraser className="h-3.5 w-3.5" aria-hidden />
          整理重复草稿
        </Button>
      ) : null}
      <Separator orientation="vertical" className="hidden h-5 sm:block" />

      {canAssignOwner ? (
        <Button type="button" size="sm" variant="outline" disabled={busyOrDisabled} onClick={onAssignOwner}>
          <UserRound className="h-3.5 w-3.5" aria-hidden />
          分配负责人
        </Button>
      ) : null}

      <Button type="button" size="sm" variant="outline" disabled={busyOrDisabled} onClick={onManageTags}>
        <Tag className="h-3.5 w-3.5" aria-hidden />
        标签
      </Button>

      <Button type="button" size="sm" variant="outline" disabled={busyOrDisabled} onClick={onSetFollowUp}>
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        设置跟进
      </Button>

      <Button type="button" size="sm" variant="destructive" disabled={busyOrDisabled} onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        删除所选
      </Button>

      <Button type="button" size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onClear}>
        <X className="h-3.5 w-3.5" aria-hidden />
        取消选择
      </Button>
    </div>
  );
}
