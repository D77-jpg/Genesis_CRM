/**
 * Textarea —— 多行文本输入（客户备注等）
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    data-ui="field"
    aria-invalid={invalid || undefined}
    className={cn(
      [
        'flex min-h-[84px] w-full rounded-xl border border-input/80 bg-card px-3.5 py-2.5 text-sm shadow-none',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-55',
      ].join(' '),
      invalid && 'border-destructive focus-visible:ring-destructive',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
