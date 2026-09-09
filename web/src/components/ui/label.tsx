/**
 * Label —— 表单标签，附带必填标记与错误提示的统一实现
 */
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'flex items-center gap-1 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      invalid && 'text-destructive',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';

/** 必填星号，统一各处写法 */
export function RequiredMark({ className }: { className?: string }): React.JSX.Element {
  return <span className={cn('text-destructive', className)}>*</span>;
}

/**
 * 字段下方的提示区：有错误显示错误（红），否则显示 hint（灰）。
 * 固定渲染一个占位高度可避免校验出现/消失时表单跳动，需要时传 reserve。
 */
export function FieldMessage({
  error,
  hint,
  className,
  reserve = false,
}: {
  error?: string | null;
  hint?: string | null;
  className?: string;
  reserve?: boolean;
}): React.JSX.Element | null {
  const text = error || hint;
  if (!text && !reserve) return null;

  return (
    <p
      className={cn(
        'mt-1 min-h-[1rem] text-xs leading-4',
        error ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {text}
    </p>
  );
}

export { Label };
