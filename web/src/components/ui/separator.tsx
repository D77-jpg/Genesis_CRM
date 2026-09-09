/**
 * Separator / Skeleton —— 分隔线与加载骨架
 */
import * as React from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '@/lib/utils';

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separator.displayName = 'Separator';

/** 骨架屏占位块 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

/** 表格骨架：加载列表时保持行高不塌陷 */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }): React.JSX.Element {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cn('h-4', colIndex === 0 ? 'w-[18%]' : colIndex === columns - 1 ? 'w-[10%]' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export { Separator, Skeleton };
