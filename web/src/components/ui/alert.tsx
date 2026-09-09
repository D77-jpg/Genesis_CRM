/**
 * Alert —— 页面内的静态提示条（导入结果、模拟发送提醒等）
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative flex w-full gap-3 rounded-md border p-3 text-sm [&>svg]:mt-0.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-border bg-background text-foreground',
        info: 'border-status-pending/30 bg-status-pending/10 text-foreground',
        success: 'border-status-developed/30 bg-status-developed/10 text-foreground',
        warning: 'border-amber-500/30 bg-amber-500/10 text-foreground',
        destructive: 'border-destructive/40 bg-destructive/10 text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h5 className={cn('mb-0.5 font-medium leading-none', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <div className={cn('text-xs leading-relaxed text-muted-foreground [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
