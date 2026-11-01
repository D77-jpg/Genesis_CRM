/**
 * Button — compact, neutral-first controls. The primary action is the only
 * strongly colored button; everything else stays quiet.
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[0.8125rem] font-medium',
    'transition-[background-color,color,border-color,box-shadow] duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1',
    'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'btn-gradient active:translate-y-px',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:translate-y-px',
        outline:
          'border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-status-developed text-white hover:bg-status-developed/90',
      },
      size: {
        default: 'h-8 px-3 py-1.5',
        sm: 'h-7 px-2.5 text-xs',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7',
        'icon-xs': 'h-6 w-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 使用 Slot 模式时，样式会合并到唯一的子元素上（例如 <a>） */
  asChild?: boolean;
  /** 加载中：显示旋转图标并禁用点击 */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        data-ui="button"
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && !asChild ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button };
