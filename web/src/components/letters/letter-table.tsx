/**
 * 开发信记录表格（「开发信记录」页专用）
 * ------------------------------------------------------------------
 * 与客户详情页的历史表格区别：这里跨客户展示，多了勾选、客户列与跳转，
 * 因此单独一个组件，避免用一堆可选 props 把 LetterHistoryTable 撑肿。
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Eye, FileText, MailWarning, RotateCw, Trash2, User } from 'lucide-react';
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
import { TableSkeleton } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { LetterStatusBadge } from '@/components/common/status-badge';
import { DataPagination } from '@/components/common/data-pagination';
import { EmptyState, ErrorState, NoResultState } from '@/components/common/empty-state';
import { copyToClipboard, formatDateTime, formatRelative, htmlToPlainText } from '@/lib/format';
import { toast } from 'sonner';
import { customerDetailPath, MAIL_CHANNEL_LABEL, ROUTES } from '@/constants';
import type { LetterSortField } from '@/store/letter.store';
import type { DevelopmentLetter } from '@/types';

export interface LetterTableProps {
  letters: DevelopmentLetter[];
  loading: boolean;
  error: string | null;
  selectedIds: string[];
  sortBy: LetterSortField;
  sortOrder: 'asc' | 'desc';
  hasFilters: boolean;
  busy?: boolean;
  onSort: (field: LetterSortField) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onView: (letter: DevelopmentLetter) => void;
  onResend: (letter: DevelopmentLetter) => void;
  onDelete: (letter: DevelopmentLetter) => void;
  onRetry: () => void;
  onResetFilters: () => void;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export function LetterTable({
  letters,
  loading,
  error,
  selectedIds,
  sortBy,
  sortOrder,
  hasFilters,
  busy = false,
  onSort,
  onToggleSelect,
  onToggleSelectAll,
  onView,
  onResend,
  onDelete,
  onRetry,
  onResetFilters,
  page,
  limit,
  total,
  totalPages,
  onPageChange,
  onLimitChange,
}: LetterTableProps): React.JSX.Element {
  const ids = React.useMemo(() => letters.map((letter) => letter.id), [letters]);
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
  const someSelected = ids.some((id) => selectedIds.includes(id));

  const copyText = React.useCallback(async (letter: DevelopmentLetter) => {
    const text = letter.contentText || htmlToPlainText(letter.content);
    if (!text.trim()) {
      toast.warning('该开发信没有可复制的正文');
      return;
    }
    const ok = await copyToClipboard(`${letter.subject}\n\n${text}`);
    if (ok) toast.success('已复制主题与正文');
    else toast.error('复制失败', { description: '浏览器阻止了剪贴板访问' });
  }, []);

  // SortableHeader 的 onSort 是宽类型 (field: string)，这里收窄到 LetterSortField
  const handleSort = React.useCallback((field: string) => onSort(field as LetterSortField), [onSort]);

  if (error) {
    return <ErrorState title="开发信记录加载失败" description={error} onRetry={onRetry} retrying={loading} />;
  }

  if (loading && letters.length === 0) {
    return (
      <div className="p-3">
        <TableSkeleton rows={8} columns={7} />
      </div>
    );
  }

  if (letters.length === 0) {
    return hasFilters ? (
      <NoResultState
        title="没有匹配的开发信"
        description="换个关键词，或者清空筛选条件看看全部记录"
        action={
          <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
            清空筛选
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="还没有任何开发信记录"
        description="到「客户管理」里选择一位客户，点击「发送开发信」即可开始"
        action={
          <Button type="button" size="sm" asChild>
            <Link to={ROUTES.customers}>去客户列表</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="relative">
      {/* 刷新时的顶部进度提示 */}
      {loading ? (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" aria-hidden>
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      ) : null}

      {/* 移动端卡片列表 */}
      <ul className="divide-y md:hidden">
        {letters.map((letter) => {
          const selected = selectedIds.includes(letter.id);
          return (
            <li key={letter.id} className={selected ? 'bg-primary/5 p-3' : 'p-3'}>
              <div className="flex items-start gap-2.5">
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => onToggleSelect(letter.id)}
                  aria-label={`选择 ${letter.subject || '开发信'}`}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onView(letter)}
                  >
                    <span className="block truncate text-sm font-medium">{letter.subject || '（无主题）'}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {letter.recipientName || '—'} · {letter.recipientEmail}
                    </span>
                  </button>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <LetterStatusBadge status={letter.status} />
                    <span className="text-2xs text-muted-foreground">
                      {letter.sentAt ? formatRelative(letter.sentAt) : '未发送'}
                    </span>
                    {letter.customer ? (
                      <Link
                        to={customerDetailPath(letter.customer.id)}
                        className="text-2xs text-primary underline-offset-2 hover:underline"
                      >
                        {letter.customer.name}
                      </Link>
                    ) : null}
                  </div>

                  <div className="mt-2 flex items-center gap-1">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="查看" onClick={() => onView(letter)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="重新发送"
                      disabled={busy || letter.status === 'draft'}
                      onClick={() => onResend(letter)}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="删除"
                      disabled={busy}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDelete(letter)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 桌面端表格 */}
      <div className="hidden md:block">
        <div className="table-scroll">
          <Table aria-label="开发信记录">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-3">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={() => onToggleSelectAll(ids)}
                    aria-label="全选本页"
                  />
                </TableHead>
                <SortableHeader field="subject" activeField={sortBy} activeOrder={sortOrder} onSort={handleSort} className="min-w-[16rem]">
                  主题 / 正文摘要
                </SortableHeader>
                <TableHead className="min-w-[12rem]">收件人</TableHead>
                <TableHead className="min-w-[10rem]">所属客户</TableHead>
                <SortableHeader field="status" activeField={sortBy} activeOrder={sortOrder} onSort={handleSort}>
                  状态
                </SortableHeader>
                <TableHead>通道</TableHead>
                <SortableHeader field="sentAt" activeField={sortBy} activeOrder={sortOrder} onSort={handleSort}>
                  发送时间
                </SortableHeader>
                <TableHead className="w-28 text-right pr-3">操作</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {letters.map((letter) => {
                const selected = selectedIds.includes(letter.id);
                return (
                  <TableRow key={letter.id} data-state={selected ? 'selected' : undefined}>
                    <TableCell className="pl-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => onToggleSelect(letter.id)}
                        aria-label={`选择 ${letter.subject || '开发信'}`}
                      />
                    </TableCell>

                    <TableCell>
                      <button
                        type="button"
                        className="block max-w-[24rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onView(letter)}
                      >
                        <span className="block truncate text-sm font-medium hover:text-primary hover:underline">
                          {letter.subject || '（无主题）'}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {htmlToPlainText(letter.content).replace(/\n+/g, ' ').slice(0, 90) || '（无正文）'}
                        </span>
                      </button>
                    </TableCell>

                    <TableCell>
                      <span className="block truncate text-xs">{letter.recipientName || '—'}</span>
                      <a
                        href={`mailto:${letter.recipientEmail}`}
                        className="block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {letter.recipientEmail}
                      </a>
                    </TableCell>

                    <TableCell>
                      {letter.customer ? (
                        <Link
                          to={customerDetailPath(letter.customer.id)}
                          className="inline-flex max-w-[12rem] items-center gap-1.5 text-xs hover:text-primary hover:underline"
                        >
                          <User className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{letter.customer.name}</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">客户已删除</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <LetterStatusBadge status={letter.status} />
                      {letter.status === 'failed' && letter.error ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="mt-1 inline-flex items-center gap-1 text-2xs text-status-failed">
                              <MailWarning className="h-3 w-3" aria-hidden />
                              查看原因
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[18rem]">{letter.error}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {MAIL_CHANNEL_LABEL[letter.channel] ?? letter.channel}
                    </TableCell>

                    <TableCell className="whitespace-nowrap">
                      {letter.sentAt ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground">{formatRelative(letter.sentAt)}</span>
                          </TooltipTrigger>
                          <TooltipContent>{formatDateTime(letter.sentAt)}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-muted-foreground">未发送</span>
                      )}
                    </TableCell>

                    <TableCell className="pr-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="查看"
                              onClick={() => onView(letter)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>查看详情</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="复制正文"
                              onClick={() => void copyText(letter)}
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>复制主题与正文</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="重新发送"
                              disabled={busy || letter.status === 'draft'}
                              onClick={() => onResend(letter)}
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {letter.status === 'draft' ? '草稿请在客户详情页编辑后发送' : '以原内容再发一次'}
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="删除"
                              disabled={busy}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => onDelete(letter)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>删除这条记录</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <DataPagination
        page={page}
        limit={limit}
        total={total}
        totalPages={totalPages}
        onPageChange={onPageChange}
        onLimitChange={onLimitChange}
        disabled={loading}
        extra={
          selectedIds.length > 0 ? (
            <span className="text-primary">
              已选 <span className="font-medium tabular-nums">{selectedIds.length}</span> 项
            </span>
          ) : null
        }
      />
    </div>
  );
}
