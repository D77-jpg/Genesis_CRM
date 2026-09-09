/**
 * 销售工作区
 * ------------------------------------------------------------------
 * 让 Dashboard 从「看数字」变成「干活」：
 *  - 顶部 5 个可点击指标：今日待跟进 / 已逾期 / 即将跟进 / 今日发送开发信 / 今日新增客户
 *    点击跟进类指标会跳到客户列表并自动套用对应筛选（今天 / 逾期 / 未来）。
 *  - 下方三张清单卡：待跟进客户（逾期优先，红字提示）、最近跟进、最近开发客户；
 *    每一行都能点进对应客户详情。
 *
 * 逾期/今天/未来的判定与后端聚合、客户列表筛选口径一致（见 lib/format.getFollowUpState）。
 */
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  Briefcase,
  CalendarClock,
  CalendarDays,
  History,
  Send,
  UserPlus,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CustomerStatusBadge } from '@/components/common/status-badge';
import { cn } from '@/lib/utils';
import { formatDate, formatRelative, initials } from '@/lib/format';
import { useCustomerStore } from '@/store/customer.store';
import {
  customerDetailPath,
  FOLLOW_UP_METHOD_LABEL,
  FOLLOW_UP_RESULT_LABEL,
  ROUTES,
} from '@/constants';
import type { CustomerBrief, FollowUpFilter, RecentFollowUpItem, SalesWorkspace } from '@/types';

export interface SalesWorkspaceSectionProps {
  workspace: SalesWorkspace;
}

/** 待跟进 / 最近开发客户清单里的一行（可点进详情） */
function CustomerRow({ customer, note }: { customer: CustomerBrief; note?: React.ReactNode }): React.JSX.Element {
  return (
    <li>
      <Link
        to={customerDetailPath(customer.id)}
        className="flex items-start gap-3 rounded-md px-1 py-2 transition-colors hover:bg-muted/60"
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground"
          aria-hidden
        >
          {initials(customer.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{customer.name}</p>
          <p className="truncate text-xs text-muted-foreground">{customer.company || '未填写公司'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <CustomerStatusBadge status={customer.status} />
          {note ? <span className="text-2xs text-muted-foreground">{note}</span> : null}
        </div>
      </Link>
    </li>
  );
}

/** 最近跟进记录的一行 */
function RecentFollowUpRow({ item }: { item: RecentFollowUpItem }): React.JSX.Element {
  return (
    <li className="py-2.5">
      <Link to={customerDetailPath(item.customerId)} className="group block rounded-md px-1 transition-colors hover:bg-muted/60">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium group-hover:text-primary group-hover:underline">
            {item.customerName}
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground">{formatRelative(item.followUpAt)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{FOLLOW_UP_METHOD_LABEL[item.method] ?? item.method}</Badge>
          <Badge variant="muted">{FOLLOW_UP_RESULT_LABEL[item.result] ?? item.result}</Badge>
          {item.customerCompany ? (
            <span className="truncate text-2xs text-muted-foreground">{item.customerCompany}</span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.content}</p>
      </Link>
    </li>
  );
}

/** 清单空态 */
function ListEmpty({ text }: { text: string }): React.JSX.Element {
  return <p className="py-8 text-center text-xs text-muted-foreground">{text}</p>;
}

export function SalesWorkspaceSection({ workspace }: SalesWorkspaceSectionProps): React.JSX.Element {
  const navigate = useNavigate();
  const resetFilters = useCustomerStore((state) => state.resetFilters);
  const setFilters = useCustomerStore((state) => state.setFilters);
  const setSorting = useCustomerStore((state) => state.setSorting);

  // 跳到客户列表并套用「跟进时间」筛选（今天 / 逾期 / 未来）
  const goFollowUp = React.useCallback(
    (followUp: FollowUpFilter) => {
      resetFilters();
      setFilters({ followUp });
      navigate(ROUTES.customers);
    },
    [resetFilters, setFilters, navigate],
  );

  // 跳到客户列表并按「最新创建」排序，看今天新增的客户
  const goNewCustomers = React.useCallback(() => {
    resetFilters();
    setSorting('createdAt');
    navigate(ROUTES.customers);
  }, [resetFilters, setSorting, navigate]);

  const hasOverdue = workspace.followUpOverdue > 0;
  const hasToday = workspace.followUpToday > 0;

  return (
    <div className="space-y-3">
      {/* ---------------------------- 区块标题 ---------------------------- */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">销售工作区</h2>
        <span className="text-xs text-muted-foreground">今天的跟进任务与最近动态，点进去即可处理</span>
      </div>

      {/* ---------------------------- 指标（可点击） ---------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Link
          to={ROUTES.customers}
          onClick={() => goFollowUp('today')}
          className="block rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="今日待跟进"
            value={workspace.followUpToday.toLocaleString('zh-CN')}
            icon={<CalendarClock className="h-4 w-4" aria-hidden />}
            tone={hasToday ? 'primary' : 'default'}
            hint={hasToday ? '点击查看今天待跟进客户' : '今天没有待跟进'}
          />
        </Link>

        <Link
          to={ROUTES.customers}
          onClick={() => goFollowUp('overdue')}
          className="block rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="已逾期"
            value={workspace.followUpOverdue.toLocaleString('zh-CN')}
            icon={<AlarmClock className="h-4 w-4" aria-hidden />}
            tone={hasOverdue ? 'failed' : 'default'}
            hint={hasOverdue ? '有客户超过计划跟进时间' : '没有逾期客户'}
          />
        </Link>

        <Link
          to={ROUTES.customers}
          onClick={() => goFollowUp('upcoming')}
          className="block rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="即将跟进"
            value={workspace.followUpUpcoming.toLocaleString('zh-CN')}
            icon={<CalendarDays className="h-4 w-4" aria-hidden />}
            tone="default"
            hint="已安排的未来跟进"
          />
        </Link>

        <Link
          to={ROUTES.letters}
          className="block rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="今日发送开发信"
            value={workspace.lettersSentToday.toLocaleString('zh-CN')}
            icon={<Send className="h-4 w-4" aria-hidden />}
            tone={workspace.lettersSentToday > 0 ? 'developed' : 'default'}
            hint="点击查看开发信记录"
          />
        </Link>

        <Link
          to={ROUTES.customers}
          onClick={goNewCustomers}
          className="block rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="今日新增客户"
            value={workspace.newCustomersToday.toLocaleString('zh-CN')}
            icon={<UserPlus className="h-4 w-4" aria-hidden />}
            tone={workspace.newCustomersToday > 0 ? 'primary' : 'default'}
            hint="点击按最新创建查看"
          />
        </Link>
      </div>

      {/* ---------------------------- 清单 ---------------------------- */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* 待跟进客户：逾期优先 */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
                待跟进客户
              </CardTitle>
              <CardDescription>逾期优先，点击进入客户详情</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => goFollowUp('today')}>
              查看今天
            </Button>
          </CardHeader>
          <CardContent className="pt-2">
            {!hasOverdue && !hasToday ? (
              <ListEmpty text="太棒了，暂时没有待跟进的客户" />
            ) : (
              <div className="space-y-3">
                {workspace.overdueCustomers.length > 0 ? (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-destructive">
                      <AlarmClock className="h-3 w-3" aria-hidden />
                      已逾期 {workspace.followUpOverdue}
                    </p>
                    <ul className="divide-y">
                      {workspace.overdueCustomers.map((customer) => (
                        <CustomerRow
                          key={customer.id}
                          customer={customer}
                          note={<span className="font-medium text-destructive">逾期 {formatDate(customer.nextFollowUpAt)}</span>}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}

                {workspace.todayFollowUpCustomers.length > 0 ? (
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      今天 {workspace.followUpToday}
                    </p>
                    <ul className="divide-y">
                      {workspace.todayFollowUpCustomers.map((customer) => (
                        <CustomerRow key={customer.id} customer={customer} note="今天跟进" />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 最近跟进 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden />
              最近跟进
            </CardTitle>
            <CardDescription>最新的跟进沟通记录</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {workspace.recentFollowUps.length > 0 ? (
              <ul className="divide-y">
                {workspace.recentFollowUps.map((item) => (
                  <RecentFollowUpRow key={item.id} item={item} />
                ))}
              </ul>
            ) : (
              <ListEmpty text="还没有跟进记录，进入客户详情即可新增" />
            )}
          </CardContent>
        </Card>

        {/* 最近开发客户 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden />
              最近开发客户
            </CardTitle>
            <CardDescription>最新加入的客户</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {workspace.recentCustomers.length > 0 ? (
              <ul className="divide-y">
                {workspace.recentCustomers.map((customer) => (
                  <CustomerRow
                    key={customer.id}
                    customer={customer}
                    note={<span className={cn('tabular-nums')}>{formatRelative(customer.createdAt)}</span>}
                  />
                ))}
              </ul>
            ) : (
              <ListEmpty text="还没有客户，先在客户管理里导入或新建" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
