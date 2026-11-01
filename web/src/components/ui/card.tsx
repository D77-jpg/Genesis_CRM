/**
 * Card — quiet bounded surface for grouping related content.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('panel min-w-0 rounded-lg border border-border bg-card text-card-foreground', className)}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex min-w-0 flex-col gap-1 p-3.5 sm:p-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-[0.875rem] font-semibold leading-snug tracking-[-0.01em]', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-3.5 pt-0 sm:p-4 sm:pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-wrap items-center gap-2 border-t border-border p-3.5 sm:p-4', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

/**
 * 统计卡片（仪表盘 / AI 用量）：标签 + 柔色变化标签 + 大数字 + 说明。
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  badge,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** 右上角柔色变化标签，例如 +4 / -8% */
  badge?: React.ReactNode;
  tone?: 'default' | 'pending' | 'developed' | 'failed' | 'primary';
  className?: string;
}): React.JSX.Element {
  const toneClass = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-muted text-muted-foreground',
    pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    developed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    failed: 'bg-destructive/10 text-destructive',
  }[tone];

  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words pt-0.5 text-xs font-medium text-muted-foreground">{label}</p>
        {badge ? (
          <span className={cn('chip shrink-0', toneClass)}>{badge}</span>
        ) : icon ? (
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', toneClass)}>{icon}</div>
        ) : null}
      </div>
      <p className="mt-3 break-all text-[1.5rem] font-semibold leading-none tracking-[-0.025em] tabular-nums">
        {value}
      </p>
      {hint ? <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
