/**
 * Card —— 页面区块容器（白色悬浮卡片：大圆角 + 极轻描边 + 柔和阴影）
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('panel min-w-0 rounded-2xl border border-border/80 bg-card text-card-foreground', className)}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex min-w-0 flex-col gap-1.5 p-4 sm:p-5', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] sm:text-base', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs leading-relaxed text-muted-foreground sm:text-sm', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-wrap items-center gap-2 border-t border-border/70 p-4 sm:p-5', className)} {...props} />
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
    primary: 'chip-violet',
    pending: 'chip-violet',
    developed: 'chip-mint',
    failed: 'chip-rose',
  }[tone];

  return (
    <Card className={cn('p-4 sm:p-[1.375rem]', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words pt-0.5 text-[0.8125rem] font-medium text-foreground/70">{label}</p>
        {badge ? (
          <span className={cn('chip shrink-0', toneClass)}>{badge}</span>
        ) : icon ? (
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', toneClass)}>{icon}</div>
        ) : null}
      </div>
      <p className="mt-3 break-all text-[1.75rem] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[2rem]">
        {value}
      </p>
      {hint ? <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
