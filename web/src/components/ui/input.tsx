/**
 * Input —— shadcn/ui 风格文本输入框
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
    aria-invalid={invalid || undefined}
    className={cn(
      [
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
        'transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        'read-only:bg-muted/40',
      ].join(' '),
      invalid && 'border-destructive focus-visible:ring-destructive',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
