/**
 * Toaster —— sonner 全局轻提示，跟随应用主题切换深/浅色
 */
import type * as React from 'react';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';
import { useUiStore } from '@/store/ui.store';

export function Toaster(props: ToasterProps): React.JSX.Element {
  const theme = useUiStore((state) => state.theme);

  return (
    <SonnerToaster
      theme={theme}
      position="top-right"
      closeButton
      richColors
      duration={4000}
      toastOptions={{
        classNames: {
          toast: 'group toast rounded-2xl border-border/70 bg-card text-foreground shadow-[var(--shadow-pop)]',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
