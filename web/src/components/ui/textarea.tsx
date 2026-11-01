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
        'flex min-h-[76px] w-full rounded-md border border-input/80 bg-card px-2.5 py-2 text-[0.8125rem] shadow-none',
        'placeholder:text-muted-foreground/75 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15',
        'focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-55',
      ].join(' '),
      invalid && 'border-destructive focus-visible:ring-destructive',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
