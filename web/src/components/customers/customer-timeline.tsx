/**
 * 客户时间线
 * ------------------------------------------------------------------
 * 把客户的重要事件按时间倒序串成一条竖线，让销售一眼看清：
 *   之前发生过什么 · 最近一次联系是什么时候 · 下一步要做什么。
 * 事件来源（见后端 timeline.service）：
 *   created（建档）/ letter（开发信）/ followup（跟进）/ quotation（报价单）/
 *   status_changed（状态变化）/ followup_scheduled（跟进计划变更）。
 */
import * as React from 'react';
import {
  CalendarClock,
  Flag,
  Mail,
  NotebookPen,
  ReceiptText,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, InlineLoader } from '@/components/common/empty-state';
import { CustomerStatusBadge, LetterStatusBadge, QuotationStatusBadge } from '@/components/common/status-badge';
import {
  FOLLOW_UP_METHOD_LABEL,
  FOLLOW_UP_RESULT_LABEL,
  MAIL_CHANNEL_LABEL,
  TIMELINE_EVENT_LABEL,
} from '@/constants';
import { formatDate, formatDateTime, formatMoney, getFollowUpState } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TimelineEvent, TimelineEventType } from '@/types';

export interface CustomerTimelineProps {
  items: TimelineEvent[];
  loading: boolean;
  lastContactAt?: string | Date | null;
}

/** 每种事件的图标 + 主色，做「明显但简洁」的区分 */
const EVENT_VISUAL: Record<TimelineEventType, { icon: React.ReactNode; dotClass: string }> = {
  created: { icon: <UserPlus className="h-3.5 w-3.5" aria-hidden />, dotClass: 'bg-slate-400 text-white' },
  letter: { icon: <Mail className="h-3.5 w-3.5" aria-hidden />, dotClass: 'bg-blue-500 text-white' },
  followup: { icon: <NotebookPen className="h-3.5 w-3.5" aria-hidden />, dotClass: 'bg-emerald-500 text-white' },
  quotation: { icon: <ReceiptText className="h-3.5 w-3.5" aria-hidden />, dotClass: 'bg-teal-600 text-white' },
  status_changed: { icon: <RefreshCw className="h-3.5 w-3.5" aria-hidden />, dotClass: 'bg-violet-500 text-white' },
  followup_scheduled: { icon: <CalendarClock className="h-3.5 w-3.5" aria-hidden />, dotClass: 'bg-amber-500 text-white' },
};

/** 下一次跟进计划的时间文案（逾期红 / 今天琥珀 / 未来常规 / 清除） */
function scheduledText(value?: string | Date | null): { text: string; className: string } {
  if (!value) return { text: '已清除下一次跟进时间', className: 'text-muted-foreground' };
  const state = getFollowUpState(value);
  const date = formatDate(value);
  if (state === 'overdue') return { text: `下一次跟进调整为 ${date}（已逾期）`, className: 'text-destructive' };
  if (state === 'today') return { text: `下一次跟进调整为 ${date}（今天）`, className: 'text-amber-600 dark:text-amber-400' };
  return { text: `下一次跟进调整为 ${date}`, className: 'text-muted-foreground' };
}

/** 单个事件的正文描述 */
function EventBody({ event }: { event: TimelineEvent }): React.JSX.Element | null {
  switch (event.type) {
    case 'letter': {
      const letter = event.letter;
      if (!letter) return null;
      return (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{letter.subject || '（无主题）'}</span>
          <LetterStatusBadge status={letter.status} />
          <span className="text-xs text-muted-foreground">
            {MAIL_CHANNEL_LABEL[letter.channel] ?? letter.channel}
          </span>
        </div>
      );
    }
    case 'followup': {
      const followUp = event.followUp;
      if (!followUp) return null;
      return (
        <div className="mt-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{FOLLOW_UP_METHOD_LABEL[followUp.method] ?? followUp.method}</Badge>
            <Badge variant="secondary">{FOLLOW_UP_RESULT_LABEL[followUp.result] ?? followUp.result}</Badge>
            {followUp.nextFollowUpAt ? (
              <span className="text-xs text-muted-foreground">
                下次跟进 {formatDate(followUp.nextFollowUpAt)}
              </span>
            ) : null}
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {followUp.content}
          </p>
        </div>
      );
    }
    case 'quotation': {
      const quotation = event.quotation;
      if (!quotation) return null;
      return (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{quotation.title || '（无标题）'}</span>
          <QuotationStatusBadge status={quotation.status} />
          <span className="text-xs text-muted-foreground">
            {quotation.quotationNo} · {formatMoney(quotation.totalAmount, quotation.currency)}
          </span>
        </div>
      );
    }
    case 'status_changed': {
      const change = event.statusChange;
      return (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          {change?.from ? <CustomerStatusBadge status={change.from} showDot={false} /> : <span className="text-muted-foreground">（原状态）</span>}
          <span className="text-muted-foreground">→</span>
          {change?.to ? (
            <CustomerStatusBadge status={change.to} showDot={false} />
          ) : (
            <span className="text-muted-foreground">（新状态）</span>
          )}
        </div>
      );
    }
    case 'followup_scheduled': {
      const hint = scheduledText(event.nextFollowUpAt);
      return <p className={cn('mt-1 text-sm', hint.className)}>{hint.text}</p>;
    }
    default:
      return null;
  }
}

export function CustomerTimeline({ items, loading, lastContactAt }: CustomerTimelineProps): React.JSX.Element {
  if (loading && items.length === 0) {
    return <InlineLoader label="正在加载客户动态…" />;
  }

  if (items.length === 0) {
    return <EmptyState title="暂无客户动态" description="客户的建档、开发信、跟进与状态变化都会汇总到这里。" />;
  }

  return (
    <div>
      {lastContactAt ? (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Flag className="h-3.5 w-3.5" aria-hidden />
          最近一次联系：{formatDateTime(lastContactAt)}
        </p>
      ) : null}

      <ol className="relative space-y-4 border-l border-border pl-5">
        {items.map((event) => {
          const visual = EVENT_VISUAL[event.type] ?? EVENT_VISUAL.created;
          return (
            <li key={event.id} className="relative">
              <span
                className={cn(
                  'absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-background',
                  visual.dotClass,
                )}
                aria-hidden
              >
                {visual.icon}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{TIMELINE_EVENT_LABEL[event.type] ?? event.type}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(event.at)}</span>
              </div>
              <EventBody event={event} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
