/**
 * Input — compact 34px field with a quiet border and a single subtle focus ring.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** 校验失败态：红色边框 + 聚焦红环 */
  invalid?: boolean;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, invalid, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-ui="field"
    aria-invalid={invalid || undefined}
    className={cn(
      [
        'flex h-8 w-full rounded-md border border-input/80 bg-card px-2.5 py-1 text-[0.8125rem] shadow-none',
        'transition-[border-color,box-shadow] file:border-0 file:bg-card file:text-sm file:font-medium file:text-foreground',
        'placeholder:text-muted-foreground/75',
        'focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-55',
        'read-only:bg-surface',
      ].join(' '),
      invalid && 'border-destructive/60 focus-visible:border-destructive focus-visible:ring-destructive/15',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
