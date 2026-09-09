/**
 * 销售漏斗 / 状态分布
 * ------------------------------------------------------------------
 * 按销售流程顺序（待开发 → … → 已成交 / 已流失）展示每个状态的客户数量，
 * 条形宽度相对「最大阶段」按比例收缩，形成漏斗观感；同时标注占总数的百分比。
 * 点击任一阶段 → 跳到客户列表并自动按该状态筛选（复用客户 store 的筛选能力）。
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useCustomerStore } from '@/store/customer.store';
import {
  CUSTOMER_STATUS_BAR_CLASS,
  CUSTOMER_STATUS_LABEL,
  CUSTOMER_STATUS_VALUES,
  ROUTES,
} from '@/constants';
import type { CustomerStatus } from '@/types';

export interface SalesFunnelProps {
  byStatus: Record<CustomerStatus, number>;
  /** 客户总数，用于计算各阶段占比 */
  total: number;
}

export function SalesFunnel({ byStatus, total }: SalesFunnelProps): React.JSX.Element {
  const navigate = useNavigate();
  const resetFilters = useCustomerStore((state) => state.resetFilters);
  const setFilters = useCustomerStore((state) => state.setFilters);

  const goStatus = React.useCallback(
    (status: CustomerStatus) => {
      resetFilters();
      setFilters({ status });
      navigate(ROUTES.customers);
    },
    [resetFilters, setFilters, navigate],
  );

  const counts = CUSTOMER_STATUS_VALUES.map((status) => byStatus[status] ?? 0);
  const max = Math.max(...counts, 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
          销售漏斗
        </CardTitle>
        <CardDescription>各销售阶段的客户数量，点击某一阶段可查看对应客户</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">还没有客户，导入后即可看到销售漏斗</p>
        ) : (
          <ul className="space-y-2.5">
            {CUSTOMER_STATUS_VALUES.map((status) => {
              const count = byStatus[status] ?? 0;
              const percent = total > 0 ? Math.round((count / total) * 100) : 0;
              const widthPct = count > 0 ? Math.max(3, (count / max) * 100) : 0;
              return (
                <li key={status}>
                  <button
                    type="button"
                    onClick={() => goStatus(status)}
                    disabled={count === 0}
                    className={cn(
                      'w-full rounded-md px-1 py-0.5 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      count > 0 ? 'hover:bg-muted/60' : 'cursor-default opacity-70',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className={cn('h-2 w-2 shrink-0 rounded-full', CUSTOMER_STATUS_BAR_CLASS[status])}
                          aria-hidden
                        />
                        {CUSTOMER_STATUS_LABEL[status]}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {count.toLocaleString('zh-CN')} · {percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="presentation">
                      <div
                        className={cn('h-full rounded-full transition-[width] duration-500', CUSTOMER_STATUS_BAR_CLASS[status])}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
