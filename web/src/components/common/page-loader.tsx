/**
 * 全屏加载态
 * ------------------------------------------------------------------
 * 用在两处：首屏恢复登录态、路由级代码分割的 Suspense 兜底。
 */
import type * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageLoader({
  label = '加载中…',
  className,
}: {
  label?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn('flex min-h-screen flex-col items-center justify-center gap-3 bg-background', className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
