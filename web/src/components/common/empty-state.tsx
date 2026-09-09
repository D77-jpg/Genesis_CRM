/**
 * 空态 / 错误态 / 加载态 —— 列表与详情页的统一占位
 */
import * as React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StateBlockProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

function StateBlock({ icon, title, description, action, className }: StateBlockProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-14 text-center', className)}>
      {icon ? <div className="mb-1 text-muted-foreground/70">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** 数据为空（还没有任何记录） */
export function EmptyState({
  title = '暂无数据',
  description,
  action,
  className,
}: Omit<StateBlockProps, 'icon'>): React.JSX.Element {
  return (
    <StateBlock
      icon={<Inbox className="h-9 w-9" strokeWidth={1.4} aria-hidden />}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

/** 有筛选条件但没匹配到结果 */
export function NoResultState({
  title = '没有匹配的结果',
  description = '试试调整搜索关键词或清空筛选条件',
  action,
  className,
}: Omit<StateBlockProps, 'icon'>): React.JSX.Element {
  return (
    <StateBlock
      icon={<SearchX className="h-9 w-9" strokeWidth={1.4} aria-hidden />}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

/** 请求失败 */
export function ErrorState({
  title = '加载失败',
  description,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <StateBlock
      icon={<AlertTriangle className="h-9 w-9 text-status-failed" strokeWidth={1.4} aria-hidden />}
      title={title}
      description={description}
      className={className}
      action={
        onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} loading={retrying}>
            {!retrying ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : null}
            重新加载
          </Button>
        ) : null
      }
    />
  );
}

/** 行内加载指示 */
export function InlineLoader({ label = '加载中…', className }: { label?: string; className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
