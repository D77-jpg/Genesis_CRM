/**
 * 页面头部：标题 + 描述 + 右侧操作区 + 可选面包屑/返回按钮
 */
import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 右侧操作按钮区 */
  actions?: React.ReactNode;
  /** 显示返回按钮（详情页） */
  backTo?: string;
  backLabel?: string;
  className?: string;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  backTo,
  backLabel = '返回',
  className,
  children,
}: PageHeaderProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <header className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {backTo ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navigate(backTo)}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {backLabel}
            </Button>
          ) : null}
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
