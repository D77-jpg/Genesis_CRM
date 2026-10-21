import { FilePenLine, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PendingDraftFeed } from '@/hooks/use-pending-drafts';
import type { DevelopmentLetter, LetterReview } from '@/types';

/** 列表里的审核状态：未审核 / 已通过 / 不通过，与弹窗内口径一致 */
function reviewView(review?: LetterReview): { label: string; variant: 'pending' | 'developed' | 'failed' } {
  if (review?.decision === 'approved') return { label: '审核已通过', variant: 'developed' };
  if (review?.decision === 'rejected') return { label: '不通过', variant: 'failed' };
  return { label: '待审核', variant: 'pending' };
}

/** 行内按钮：已通过只需查看，不通过给一次重新审核的机会 */
function actionLabel(review?: LetterReview): string {
  if (review?.decision === 'approved') return '查看草稿';
  if (review?.decision === 'rejected') return '重新审核';
  return '审核草稿';
}

export function PendingDrafts({
  feed,
  onOpenDraft,
  busy = false,
}: {
  feed: PendingDraftFeed;
  onOpenDraft: (letter: DevelopmentLetter) => void;
  busy?: boolean;
}) {
  const showRejected = feed.view === 'rejected';
  return (
    <section aria-label="开发信草稿" className="min-w-0 rounded-xl border border-primary/20 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FilePenLine className="h-4 w-4 text-primary" aria-hidden />
          {feed.customerId ? '当前客户的开发信草稿' : '开发信草稿'}
          <span className="text-sm tabular-nums text-muted-foreground">{feed.total}</span>
        </h2>
        <div className="flex items-center gap-1.5">
          <div role="group" aria-label="草稿筛选" className="flex items-center gap-1 rounded-lg border p-1">
            <Button
              type="button"
              size="sm"
              variant={showRejected ? 'ghost' : 'secondary'}
              className={cn('rounded-md', showRejected && 'text-muted-foreground')}
              aria-pressed={!showRejected}
              onClick={() => feed.setView('todo')}
            >
              待处理
            </Button>
            <Button
              type="button"
              size="sm"
              variant={showRejected ? 'secondary' : 'ghost'}
              className={cn('rounded-md', !showRejected && 'text-muted-foreground')}
              aria-pressed={showRejected}
              onClick={() => feed.setView('rejected')}
            >
              不通过
            </Button>
          </div>
          <Button type="button" variant="ghost" className="min-h-11" disabled={feed.loading} onClick={feed.refresh}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            刷新草稿
          </Button>
        </div>
      </div>

      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {showRejected
          ? '标记为不通过的草稿不会发送，留在这里备查；想改用其中一封，打开后点「审核通过并发送」。'
          : '发之前先自己过一遍：内容没问题就「审核通过并发送」，觉得不能用就标记「不通过」。不通过的草稿不会发送，也不占这张清单。'}
      </p>

      {feed.error ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{feed.error}</span>
          <Button type="button" variant="outline" className="min-h-11" onClick={feed.refresh}>
            重试加载草稿
          </Button>
        </div>
      ) : null}

      {!feed.items.length && feed.loading ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          正在查找草稿…
        </p>
      ) : null}

      {!feed.loading && !feed.error && !feed.items.length ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {showRejected
            ? '没有标记为不通过的草稿。'
            : '没有待处理的草稿。新生成或保存的草稿会自动出现在这里。'}
        </p>
      ) : null}

      <ul className="mt-3 divide-y">
        {feed.items.map((letter) => {
          const status = reviewView(letter.review);
          const label = actionLabel(letter.review);
          return (
            <li key={letter.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold leading-6">{letter.subject || '（无主题）'}</p>
                {!feed.customerId ? (
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {letter.customer?.name || letter.recipientName} · {letter.recipientEmail}
                  </p>
                ) : null}
                <p className="mt-1 line-clamp-2 break-words text-sm leading-6 text-muted-foreground">
                  {letter.contentText || '打开草稿查看正文'}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  <span>更新于 {formatRelative(letter.updatedAt)}</span>
                </p>
              </div>
              <Button
                type="button"
                className="min-h-11 shrink-0 self-start sm:self-center"
                disabled={busy}
                aria-label={`${label}：${letter.subject || '无主题'}`}
                onClick={() => onOpenDraft(letter)}
              >
                <FilePenLine className="h-4 w-4" aria-hidden />
                {label}
              </Button>
            </li>
          );
        })}
      </ul>

      {feed.totalPages > 1 ? (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" className="min-h-11" disabled={feed.loading || feed.page <= 1} onClick={() => feed.setPage(feed.page - 1)}>
            上一页草稿
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">{feed.page} / {feed.totalPages}</span>
          <Button type="button" variant="outline" className="min-h-11" disabled={feed.loading || feed.page >= feed.totalPages} onClick={() => feed.setPage(feed.page + 1)}>
            下一页草稿
          </Button>
        </div>
      ) : null}
    </section>
  );
}
