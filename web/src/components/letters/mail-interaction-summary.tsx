import type * as React from 'react';
import { Eye, Link2, Send } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import type { MailTrackingSummary } from '@/types';

export function MailInteractionSummary({
  sentAt,
  tracking,
  detailed = false,
}: {
  sentAt?: string | Date;
  tracking?: MailTrackingSummary;
  detailed?: boolean;
}): React.JSX.Element {
  if (!detailed) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="邮件互动情况">
        <span className="inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" aria-hidden />已发送</span>
        {tracking ? (
          <>
            <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden />{tracking.opened ? `已打开 × ${tracking.openCount}` : '未记录打开'}</span>
            <span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" aria-hidden />{tracking.clicked ? `已点击 × ${tracking.clickCount}` : '未记录点击'}</span>
            {(tracking.lastClickedAt || tracking.lastOpenedAt) && <span>最近互动 {formatDateTime(tracking.lastClickedAt || tracking.lastOpenedAt)}</span>}
          </>
        ) : <span>互动追踪未启用</span>}
      </div>
    );
  }

  const rows = [
    ['已发送', sentAt ? formatDateTime(sentAt) : '否'],
    ['已打开', tracking?.opened ? '是' : '暂无记录'],
    ['打开次数', tracking ? String(tracking.openCount) : '—'],
    ['最近打开时间', tracking?.lastOpenedAt ? formatDateTime(tracking.lastOpenedAt) : '—'],
    ['已点击', tracking?.clicked ? '是' : '暂无记录'],
    ['点击次数', tracking ? String(tracking.clickCount) : '—'],
    ['最近点击时间', tracking?.lastClickedAt ? formatDateTime(tracking.lastClickedAt) : '—'],
  ];
  return (
    <section className="space-y-3 rounded-md border bg-muted/20 p-3" aria-label="邮件行为追踪">
      <div className="flex items-center gap-2 text-sm font-medium"><Eye className="h-4 w-4 text-primary" aria-hidden />邮件互动</div>
      <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3 text-xs"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}
      </dl>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">点击过的链接</p>
        {tracking?.clickedLinks.length ? tracking.clickedLinks.map((link) => (
          <a key={`${link.url}-${link.clickedAt}`} href={link.url} target="_blank" rel="noreferrer" className="block break-all text-xs text-primary underline underline-offset-2">
            {link.url} <span className="text-muted-foreground">× {link.clickCount}{link.lastClickedAt ? ` · 最近 ${formatDateTime(link.lastClickedAt)}` : ''}</span>
          </a>
        )) : <p className="text-xs text-muted-foreground">暂无记录</p>}
      </div>
      <p className="text-2xs leading-relaxed text-muted-foreground">{tracking?.accuracyNotice || '纯文本邮件或追踪未启用，不会产生打开与点击数据。'}</p>
    </section>
  );
}
