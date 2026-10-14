import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useMediaQuery } from '@/hooks/use-ui';

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

/** Phone panels trap focus; desktop panels remain a nonmodal part of the workspace. */
export function WorkspaceDrawer({
  title, onClose, className, children,
}: React.PropsWithChildren<{ title: string; onClose: () => void; className?: string }>): React.JSX.Element {
  const phone = useMediaQuery('(max-width: 639.98px)');
  return (
    <Dialog open modal={phone} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        className={cn('left-auto top-0 max-h-none max-w-none translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:p-0', className, 'z-50')}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
