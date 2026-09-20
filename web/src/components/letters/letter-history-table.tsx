/**
 * 开发信历史表格
 * ------------------------------------------------------------------
 * 用在客户详情页：展示该客户的所有开发信记录，支持查看 / 复制 / 重发 / 删除。
 * 「复制」直接复制纯文本正文，方便粘到微信、WhatsApp 等渠道跟进。
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Copy, Eye, MailWarning, RotateCw, Trash2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableHeader } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { LetterStatusBadge } from '@/components/common/status-badge';
import { MailInteractionSummary } from '@/components/letters/mail-interaction-summary';
import { DataPagination } from '@/components/common/data-pagination';
import { EmptyState, ErrorState } from '@/components/common/empty-state';
import { copyToClipboard, formatDateTime, formatRelative, htmlToPlainText } from '@/lib/format';
import { MAIL_CHANNEL_LABEL } from '@/constants';
import type { LetterSortField } from '@/store/letter.store';
import type { DevelopmentLetter } from '@/types';

export interface LetterHistoryTableProps {
  letters: DevelopmentLetter[];
  loading: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy?: LetterSortField;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: LetterSortField) => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onView: (letter: DevelopmentLetter) => void;
  onResend: (letter: DevelopmentLetter) => void;
  onDelete: (letter: DevelopmentLetter) => void;
  onRetry: () => void;
  /** 空态里的「发送第一封开发信」按钮 */
  onSendFirst?: () => void;
  /** 删除进行中，用于禁用行内按钮 */
  busy?: boolean;
}

export function LetterHistoryTable({
  letters,
  loading,
  error,
  page,
  limit,
  total,
  totalPages,
  sortBy = 'sentAt',
  sortOrder = 'desc',
  onSort,
  onPageChange,
  onLimitChange,
  onView,
  onResend,
  onDelete,
  onRetry,
  onSendFirst,
  busy = false,
}: LetterHistoryTableProps): React.JSX.Element {
  const copyText = React.useCallback(async (letter: DevelopmentLetter) => {
    const text = letter.contentText || htmlToPlainText(letter.content);
    if (!text.trim()) {
      toast.warning('该开发信没有可复制的正文');
      return;
    }
    const ok = await copyToClipboard(`${letter.subject}\n\n${text}`);
    if (ok) toast.success('已复制主题与正文');
    else toast.error('复制失败', { description: '浏览器拒绝了剪贴板访问' });
  }, []);

  if (error) {
    return <ErrorState title="开发信记录加载失败" description={error} onRetry={onRetry} retrying={loading} />;
  }

  if (loading && letters.length === 0) {
    return (
      <div className="p-3">
        <TableSkeleton rows={4} columns={6} />
      </div>
    );
  }

  if (letters.length === 0) {
    return (
      <EmptyState
        title="还没有发送过开发信"
        description="发送后会在这里留下完整记录，包括发送时间、通道与结果"
        action={
          onSendFirst ? (
            <Button type="button" size="sm" onClick={onSendFirst}>
              发送第一封开发信
            </Button>
          ) : undefined
        }
      />
    );
  }

  const sortable = (field: LetterSortField, label: string, className?: string): React.JSX.Element =>
    onSort ? (
      <SortableHeader
        field={field}
        activeField={sortBy}
        activeOrder={sortOrder}
        onSort={(value) => onSort(value as LetterSortField)}
        className={className}
      >
        {label}
      </SortableHeader>
    ) : (
      <TableHead className={className}>{label}</TableHead>
    );

  return (
    <div>
      <Table aria-label="开发信历史">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {sortable('subject', '主题')}
            <TableHead className="hidden min-w-[12rem] sm:table-cell">收件人</TableHead>
            {sortable('status', '状态')}
            <TableHead className="hidden lg:table-cell">通道</TableHead>
            {sortable('sentAt', '发送时间')}
            <TableHead className="w-32 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {letters.map((letter) => (
            <TableRow key={letter.id}>
              <TableCell>
                <button
                  type="button"
                  className="block max-w-[22rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onView(letter)}
                >
                  <span className="block truncate text-sm font-medium hover:text-primary hover:underline">
                    {letter.subject || '（无主题）'}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {htmlToPlainText(letter.content).replace(/\n+/g, ' ').slice(0, 80) || '（无正文）'}
                  </span>
                </button>
                {['sent', 'opened'].includes(letter.status) ? <div className="mt-1.5"><MailInteractionSummary sentAt={letter.sentAt} tracking={letter.tracking} /></div> : null}
              </TableCell>

              <TableCell className="hidden sm:table-cell">
                <span className="block truncate text-xs">{letter.recipientName || '—'}</span>
                <span className="block truncate text-xs text-muted-foreground">{letter.recipientEmail}</span>
              </TableCell>

              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <LetterStatusBadge status={letter.status} />
                  {letter.status === 'failed' && letter.error ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 text-2xs text-status-failed">
                          <MailWarning className="h-3 w-3" aria-hidden />
                          查看原因
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[18rem]">{letter.error}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              </TableCell>

              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
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

              <TableCell>
                <div className="flex items-center justify-end gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="查看" onClick={() => onView(letter)}>
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
                        <Copy className="h-3.5 w-3.5" />
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
                      {letter.status === 'draft' ? '草稿请编辑后发送' : '以原内容再发一次'}
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
          ))}
        </TableBody>
      </Table>

      <DataPagination
        page={page}
        limit={limit}
        total={total}
        totalPages={totalPages}
        onPageChange={onPageChange}
        onLimitChange={onLimitChange}
        disabled={loading}
      />
    </div>
  );
}
