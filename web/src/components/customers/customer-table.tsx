/**
 * 客户表格
 * ------------------------------------------------------------------
 * - 桌面端：语义化表格，行点击进详情，Checkbox 与操作按钮阻止冒泡
 * - 移动端（< 768px）：卡片列表，避免横向滚动带来的糟糕体验
 * - 表头支持排序（姓名 / 公司 / 状态 / 开发信数 / 下次跟进 / 最近联系 / 更新时间）
 */
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Mail, MailOpen, MoreHorizontal, Pencil, Phone, Send, Trash2, TriangleAlert, User, Users } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  SortableHeader,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton, TableSkeleton } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDangerItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { CustomerStatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, NoResultState } from '@/components/common/empty-state';
import { CUSTOMER_SOURCE_LABEL, customerDetailPath } from '@/constants';
import { formatDate, formatDateTime, formatRelative, getFollowUpState, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CustomerSortField } from '@/store/customer.store';
import type { Customer } from '@/types';

export interface CustomerTableProps {
  customers: Customer[];
  loading: boolean;
  error: string | null;
  selectedIds: string[];
  sortBy: CustomerSortField;
  sortOrder: 'asc' | 'desc';
  /** 是否存在筛选条件：决定空态展示「暂无数据」还是「没有匹配结果」 */
  hasFilters: boolean;
  /** 是否展示「负责人」列 / 徽章（仅管理员；业务员的客户都归自己，无需展示） */
  showOwner?: boolean;
  onSort: (field: CustomerSortField) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onRetry: () => void;
  onEdit: (customer: Customer) => void;
  onSend: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  onCreate: () => void;
  onImport: () => void;
  onResetFilters: () => void;
}

/** 姓名 + 公司的组合单元格，公司缺失时显示来源 */
function CustomerIdentity({ customer }: { customer: Customer }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        aria-hidden
      >
        {initials(customer.name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{customer.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {customer.company || CUSTOMER_SOURCE_LABEL[customer.source] || '未填写公司'}
          {customer.title ? ` · ${customer.title}` : ''}
        </span>
      </span>
    </div>
  );
}

/** 邮箱单元格：有邮箱时可一键复制地址 */
function EmailCell({ email }: { email?: string }): React.JSX.Element {
  if (!email) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MailOpen className="h-3.5 w-3.5" aria-hidden />
            无邮箱
          </span>
        </TooltipTrigger>
        <TooltipContent>该客户未填写邮箱，发送开发信时需要手动指定收件人</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <a
      href={`mailto:${email}`}
      className="inline-flex max-w-[16rem] items-center gap-1.5 truncate text-xs text-foreground underline-offset-2 hover:text-primary hover:underline"
      onClick={(event) => event.stopPropagation()}
    >
      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{email}</span>
    </a>
  );
}

/** 下一次跟进单元格：未设置 / 今天 / 已逾期 / 未来，逾期用红色 + 图标强调 */
function FollowUpCell({ value }: { value?: string | Date | null }): React.JSX.Element {
  const state = getFollowUpState(value);
  if (state === 'none') {
    return <span className="text-xs text-muted-foreground">未设置</span>;
  }
  const label = formatDate(value);
  if (state === 'overdue') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>跟进已逾期（原定 {formatDateTime(value)}），请尽快联系</TooltipContent>
      </Tooltip>
    );
  }
  if (state === 'today') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        今天
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/** 行尾操作菜单 */
function RowActions({
  customer,
  onEdit,
  onSend,
  onDelete,
}: {
  customer: Customer;
  onEdit: (customer: Customer) => void;
  onSend: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`更多操作：${customer.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onSend(customer); }}>
          <Send className="h-4 w-4" aria-hidden />
          发送开发信
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onEdit(customer); }}>
          <Pencil className="h-4 w-4" aria-hidden />
          编辑信息
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuDangerItem onClick={(event) => { event.stopPropagation(); onDelete(customer); }}>
          <Trash2 className="h-4 w-4" aria-hidden />
          删除客户
        </DropdownMenuDangerItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CustomerTable({
  customers,
  loading,
  error,
  selectedIds,
  sortBy,
  sortOrder,
  hasFilters,
  showOwner = true,
  onSort,
  onToggleSelect,
  onToggleSelectAll,
  onRetry,
  onEdit,
  onSend,
  onDelete,
  onCreate,
  onImport,
  onResetFilters,
}: CustomerTableProps): React.JSX.Element {
  const navigate = useNavigate();
  const pageIds = React.useMemo(() => customers.map((item) => item.id), [customers]);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id));

  /* ---------------------------- 加载 / 错误 / 空态 ---------------------------- */

  if (error) {
    return <ErrorState title="客户列表加载失败" description={error} onRetry={onRetry} retrying={loading} />;
  }

  if (loading && customers.length === 0) {
    return (
      <div className="p-3">
        <TableSkeleton rows={8} columns={showOwner ? 9 : 8} />
      </div>
    );
  }

  if (customers.length === 0) {
    return hasFilters ? (
      <NoResultState
        title="没有匹配的客户"
        description="没有符合当前搜索与筛选条件的客户，试试放宽条件"
        action={
          <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
            清空筛选条件
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="还没有客户数据"
        description="从 Excel 批量导入现有客户名单，或手动新增一个客户开始建档"
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" size="sm" onClick={onImport}>
              导入 Excel
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCreate}>
              <Users className="h-3.5 w-3.5" aria-hidden />
              新建客户
            </Button>
          </div>
        }
      />
    );
  }

  /* ---------------------------- 移动端卡片列表 ---------------------------- */

  const mobileList = (
    <ul className="divide-y md:hidden">
      {customers.map((customer) => (
        <li
          key={customer.id}
          className={cn(
            'cursor-pointer p-3 transition-colors hover:bg-muted/50',
            selected.has(customer.id) && 'bg-primary/5',
          )}
          onClick={() => navigate(customerDetailPath(customer.id))}
        >
          <div className="flex items-start gap-2.5">
            <Checkbox
              checked={selected.has(customer.id)}
              onCheckedChange={() => onToggleSelect(customer.id)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`选择 ${customer.name}`}
              className="mt-1.5"
            />
            {/*
             * Link 只包裹姓名区域：EmailCell 内部是 mailto <a>，
             * 若整块用 Link 包裹会产生 <a> 嵌套 <a> 的非法 DOM（浏览器会自动拆散结构）。
             * 卡片其余区域改由 <li> 的 onClick 承担跳转。
             */}
            <div className="min-w-0 flex-1">
              <Link
                to={customerDetailPath(customer.id)}
                className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CustomerIdentity customer={customer} />
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <CustomerStatusBadge status={customer.status} />
                {customer.grade ? <Badge variant="secondary">{customer.grade} 级</Badge> : null}
                {customer.industry ? <Badge variant="muted">{customer.industry}</Badge> : null}
                {showOwner && customer.owner ? (
                  <Badge variant="outline" className="gap-1 font-normal">
                    <User className="h-3 w-3" aria-hidden />
                    {customer.owner.name}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="truncate">
                  <EmailCell email={customer.email} />
                </div>
                {customer.phone ? (
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-1.5 hover:text-primary"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {customer.phone}
                  </a>
                ) : null}
                <div className="flex items-center gap-3 pt-0.5">
                  <span>开发信 {customer.letterCount}</span>
                  <span>更新于 {formatRelative(customer.updatedAt)}</span>
                </div>
                {customer.nextFollowUpAt ? (
                  <div className="pt-0.5">
                    <FollowUpCell value={customer.nextFollowUpAt} />
                  </div>
                ) : null}
              </div>
            </div>
            <RowActions customer={customer} onEdit={onEdit} onSend={onSend} onDelete={onDelete} />
          </div>
        </li>
      ))}
    </ul>
  );

  /* ---------------------------- 桌面端表格 ---------------------------- */

  return (
    <div className="relative">
      {mobileList}

      <div className="hidden md:block">
        <Table aria-label="客户列表">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-3">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={() => onToggleSelectAll(pageIds)}
                  aria-label="全选当前页"
                  disabled={loading}
                />
              </TableHead>
              <SortableHeader field="name" activeField={sortBy} activeOrder={sortOrder} onSort={(f) => onSort(f as CustomerSortField)}>
                客户
              </SortableHeader>
              <TableHead className="min-w-[14rem]">联系方式</TableHead>
              <SortableHeader field="industry" activeField={sortBy} activeOrder={sortOrder} onSort={(f) => onSort(f as CustomerSortField)}>
                行业 / 地区
              </SortableHeader>
              <SortableHeader field="status" activeField={sortBy} activeOrder={sortOrder} onSort={(f) => onSort(f as CustomerSortField)}>
                状态
              </SortableHeader>
              {showOwner ? <TableHead className="min-w-[7rem]">负责人</TableHead> : null}
              <SortableHeader
                field="letterCount"
                activeField={sortBy}
                activeOrder={sortOrder}
                onSort={(f) => onSort(f as CustomerSortField)}
                className="text-center"
              >
                开发信
              </SortableHeader>
              <SortableHeader
                field="nextFollowUpAt"
                activeField={sortBy}
                activeOrder={sortOrder}
                onSort={(f) => onSort(f as CustomerSortField)}
              >
                下次跟进
              </SortableHeader>
              <SortableHeader
                field="lastContactAt"
                activeField={sortBy}
                activeOrder={sortOrder}
                onSort={(f) => onSort(f as CustomerSortField)}
              >
                最近联系
              </SortableHeader>
              <SortableHeader field="updatedAt" activeField={sortBy} activeOrder={sortOrder} onSort={(f) => onSort(f as CustomerSortField)}>
                更新时间
              </SortableHeader>
              <TableHead className="w-12 pr-3">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody className={cn(loading && 'pointer-events-none opacity-60')}>
            {customers.map((customer) => (
              <TableRow
                key={customer.id}
                data-state={selected.has(customer.id) ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => navigate(customerDetailPath(customer.id))}
              >
                <TableCell className="pl-3" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(customer.id)}
                    onCheckedChange={() => onToggleSelect(customer.id)}
                    aria-label={`选择 ${customer.name}`}
                  />
                </TableCell>

                <TableCell>
                  <Link
                    to={customerDetailPath(customer.id)}
                    className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <CustomerIdentity customer={customer} />
                  </Link>
                </TableCell>

                <TableCell>
                  <div className="space-y-1">
                    <EmailCell email={customer.email} />
                    {customer.phone ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {customer.phone}
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="truncate">{customer.industry || '—'}</div>
                    <div className="truncate">{customer.country || '—'}</div>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <CustomerStatusBadge status={customer.status} />
                    {customer.grade ? <Badge variant="secondary">{customer.grade} 级</Badge> : null}
                  </div>
                </TableCell>

                {showOwner ? (
                  <TableCell className="whitespace-nowrap text-xs">
                    {customer.owner ? (
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="max-w-[8rem] truncate">{customer.owner.name}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">未分配</span>
                    )}
                  </TableCell>
                ) : null}

                <TableCell className="text-center">
                  {customer.letterCount > 0 ? (
                    <Link
                      to={`${customerDetailPath(customer.id)}#letters`}
                      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold tabular-nums text-primary transition-colors hover:bg-primary/20"
                      title="查看开发信记录"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {customer.letterCount}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">0</span>
                  )}
                </TableCell>

                <TableCell className="whitespace-nowrap">
                  <FollowUpCell value={customer.nextFollowUpAt} />
                </TableCell>

                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {customer.lastContactAt ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{formatRelative(customer.lastContactAt)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{formatDateTime(customer.lastContactAt)}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span>未联系</span>
                  )}
                </TableCell>

                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(customer.updatedAt)}
                </TableCell>

                <TableCell className="pr-3" onClick={(event) => event.stopPropagation()}>
                  <RowActions customer={customer} onEdit={onEdit} onSend={onSend} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* 刷新时的顶部进度条，比整表骨架更轻量 */}
        {loading && (
          <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
        )}
      </div>
    </div>
  );
}

/** 表格上方的轻量骨架（首屏使用） */
export function CustomerTablePlaceholder(): React.JSX.Element {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
