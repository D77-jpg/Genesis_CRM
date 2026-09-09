/**
 * 批量操作条
 * ------------------------------------------------------------------
 * 勾选任意一行后浮现，吸底显示，移动端也不会被表格挡住。
 * 删除走二次确认；改状态直接执行；标签 / 负责人 / 跟进时间弹BulkActionDialog确认后执行。
 * 执行结果由页面 toast。
 */
import * as React from 'react';
import { CalendarClock, Tag, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { CUSTOMER_STATUS_OPTIONS } from '@/constants';
import { cn } from '@/lib/utils';
import type { CustomerStatus } from '@/types';

/** 状态 Select 的占位值：不对应任何真实状态，选完即回到此值以显示 placeholder */
const STATUS_PLACEHOLDER = '__status_action__';

export interface BulkActionsBarProps {
  selectedCount: number;
  disabled?: boolean;
  busy?: boolean;
  /** 是否展示「分配负责人」（仅管理员；后端 bulk/owner 也限管理员） */
  canAssignOwner?: boolean;
  onStatusChange: (status: CustomerStatus) => void;
  /** 打开「批量分配负责人」弹窗 */
  onAssignOwner: () => void;
  /** 打开「批量标签（添加 / 删除）」弹窗 */
  onManageTags: () => void;
  /** 打开「批量设置跟进时间」弹窗 */
  onSetFollowUp: () => void;
  onDelete: () => void;
  onClear: () => void;
  className?: string;
}

export function BulkActionsBar({
  selectedCount,
  disabled = false,
  busy = false,
  canAssignOwner = true,
  onStatusChange,
  onAssignOwner,
  onManageTags,
  onSetFollowUp,
  onDelete,
  onClear,
  className,
}: BulkActionsBarProps): React.JSX.Element | null {
  // 批量状态用「选完即清空」的受控 Select，允许对同一批客户重复设置同一状态
  const [statusValue, setStatusValue] = React.useState(STATUS_PLACEHOLDER);

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

      <Separator orientation="vertical" className="hidden h-5 sm:block" />

      <Select
        value={statusValue}
        onValueChange={(value) => {
          setStatusValue(STATUS_PLACEHOLDER);
          onStatusChange(value as CustomerStatus);
        }}
        disabled={busyOrDisabled}
      >
        <SelectTrigger className="h-8 w-auto min-w-[8.5rem] text-xs" aria-label="批量修改状态">
          <SelectValue placeholder="修改状态" />
        </SelectTrigger>
        <SelectContent>
          {CUSTOMER_STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
