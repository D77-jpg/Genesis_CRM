/**
 * Table —— 语义化表格元素 + 可排序表头
 * ------------------------------------------------------------------
 * 表格本身不接管数据，排序状态由调用方（store）持有，
 * SortableHeader 只负责渲染箭头与触发回调。
 */
import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="table-scroll relative w-full">
      <table ref={ref} className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('sticky top-0 z-10 bg-muted/70 backdrop-blur [&_tr]:border-b', className)} {...props} />
  ),
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  ),
);
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)} {...props} />
  ),
);
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-primary/5 data-[disabled]:opacity-60',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('px-3 py-2.5 align-middle', className)} {...props} />
  ),
);
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  ),
);
TableCaption.displayName = 'TableCaption';

/* ---------------------------- 可排序表头 ---------------------------- */

export interface SortableHeaderProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** 当前列对应的排序字段 */
  field: string;
  activeField: string;
  activeOrder: 'asc' | 'desc';
  onSort: (field: string) => void;
}

function SortableHeader({
  field,
  activeField,
  activeOrder,
  onSort,
  className,
  children,
  ...props
}: SortableHeaderProps): React.JSX.Element {
  const active = activeField === field;
  const Icon = active ? (activeOrder === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <TableHead className={cn('p-0', className)} aria-sort={active ? (activeOrder === 'asc' ? 'ascending' : 'descending') : 'none'} {...props}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'flex h-10 w-full items-center gap-1 px-3 text-left text-xs font-semibold uppercase tracking-wide transition-colors',
          'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'opacity-90' : 'opacity-40')} aria-hidden />
      </button>
    </TableHead>
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption, SortableHeader };
