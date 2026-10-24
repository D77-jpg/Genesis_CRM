/**
 * Input —— 文本输入框（圆角胶囊风、淡薰衣草描边、柔和聚焦环）
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
        'flex h-10 w-full rounded-xl border border-input/80 bg-card px-3.5 py-1 text-sm shadow-none',
        'transition-[border-color,box-shadow] file:border-0 file:bg-card file:text-sm file:font-medium file:text-foreground',
        'placeholder:text-muted-foreground/80',
        'focus-visible:outline-none focus-visible:border-primary/45 focus-visible:ring-4 focus-visible:ring-primary/12 focus-visible:ring-offset-0',
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
