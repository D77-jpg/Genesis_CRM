/**
 * 报价单列表（客户详情页「报价单」区）
 * ------------------------------------------------------------------
 * - 后端已按创建时间倒序返回，最新一条高亮并标「最新」
 * - 每行展示：状态徽章 + 编号 + 标题 + 总额（含币种） + 有效期 + 创建时间
 * - 操作：查看（详情 / 改状态）· 编辑 · 删除
 * - 删除确认交给区域组件统一持有（避免弹窗套弹窗），这里只负责触发 onDelete
 * - loading / error / empty 三态沿用 InlineLoader / ErrorState / EmptyState
 * - 操作按钮在移动端常驻可见，桌面端悬停显现，兼顾触屏与整洁
 */
import * as React from 'react';
import { CalendarClock, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QuotationStatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, InlineLoader } from '@/components/common/empty-state';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Quotation } from '@/types';

export interface QuotationListProps {
  quotations: Quotation[];
  loading: boolean;
  error: string | null;
  /** 写操作进行中（禁用行内按钮，避免并发） */
  busy?: boolean;
  onRetry: () => void;
  onAdd: () => void;
  onView: (quotation: Quotation) => void;
  onEdit: (quotation: Quotation) => void;
  onDelete: (quotation: Quotation) => void;
}

/** 行内操作按钮的统一样式：移动端常驻，桌面端悬停 / 聚焦显现 */
const ACTION_CLASS =
  'h-8 text-muted-foreground opacity-100 transition-opacity hover:text-foreground focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100';

export function QuotationList({
  quotations,
  loading,
  error,
  busy = false,
  onRetry,
  onAdd,
  onView,
  onEdit,
  onDelete,
}: QuotationListProps): React.JSX.Element {
  const addButton = (
    <Button type="button" size="sm" onClick={onAdd}>
      <Plus className="h-4 w-4" aria-hidden />
      新增报价
    </Button>
  );

  if (loading && quotations.length === 0) {
    return <InlineLoader label="正在加载报价单…" />;
  }

  if (error && quotations.length === 0) {
    return <ErrorState title="报价单加载失败" description={error} onRetry={onRetry} retrying={loading} />;
  }

  if (quotations.length === 0) {
    return (
      <EmptyState
        title="还没有报价单"
        description="为该客户创建报价单，系统会自动核算明细金额与总额，并留档到客户动态。"
        action={addButton}
      />
    );
  }

  return (
    <ul className="space-y-3">
      {quotations.map((item, index) => {
        const isLatest = index === 0;
        return (
          <li
            key={item.id}
            className={cn(
              'group rounded-lg border p-3.5 transition-colors',
              isLatest ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
            )}
          >
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              {/* 左：状态 / 编号 / 标题 / 有效期 / 创建时间 */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <QuotationStatusBadge status={item.status} />
                  <Badge variant="outline" className="font-mono text-xs tracking-tight">
                    {item.quotationNo}
                  </Badge>
                  {isLatest ? (
                    <Badge variant="default" className="gap-1">
                      最新
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium" title={item.title}>
                  {item.title}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                    有效期 {item.validityDate ? formatDate(item.validityDate) : '未设置'}
                  </span>
                  <span aria-hidden>·</span>
                  <span>创建于 {formatDateTime(item.createdAt)}</span>
                </p>
              </div>

              {/* 右：总额 + 操作 */}
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-base font-semibold tabular-nums text-primary">
                  {formatMoney(item.totalAmount, item.currency)}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(ACTION_CLASS, 'gap-1.5')}
                    onClick={() => onView(item)}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    查看
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(ACTION_CLASS, 'w-8')}
                    aria-label={`编辑报价单 ${item.quotationNo}`}
                    disabled={busy}
                    onClick={() => onEdit(item)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(ACTION_CLASS, 'w-8 hover:text-destructive')}
                    aria-label={`删除报价单 ${item.quotationNo}`}
                    disabled={busy}
                    onClick={() => onDelete(item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
