/**
 * Badge —— 柔色标签（无描边、浅底深字，参考稿的薄荷/玫瑰/紫罗兰胶囊）
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'chip-muted',
        outline: 'border border-border/80 bg-card text-muted-foreground',
        muted: 'chip-muted',
        destructive: 'chip-rose',
        /** 待开发：紫罗兰 */
        pending: 'chip-violet',
        /** 已开发：薄荷绿 */
        developed: 'chip-mint',
        failed: 'chip-rose',
        /** 琥珀色提醒 */
        warning: 'chip-amber',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
