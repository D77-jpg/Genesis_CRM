import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Shared search/filter surface; it never owns query state or changes requests. */
export function WorkspaceToolbar({
  children, className, label = '搜索与筛选',
}: React.PropsWithChildren<{ className?: string; label?: string }>): React.JSX.Element {
  return <div role="region" aria-label={label} className={cn('workspace-toolbar', className)}>{children}</div>;
}

export function SectionHeading({
  title, description, actions,
}: { title: string; description?: string; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
