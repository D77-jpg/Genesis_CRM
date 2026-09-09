/**
 * 占位符工具条
 * ------------------------------------------------------------------
 * 点击按钮即可把 {{token}} 插入到编辑器光标处。
 * 对于当前客户档案里取不到值的占位符，按钮会显示为「缺值」样式，
 * 并在 tooltip 中说明发送时会用什么兜底文案。
 */
import * as React from 'react';
import { Braces } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { PLACEHOLDER_FALLBACK, type PlaceholderValues } from '@/lib/placeholder';
import type { PlaceholderDef } from '@/constants';
import { cn } from '@/lib/utils';

export interface PlaceholderBarProps {
  defs: PlaceholderDef[];
  /** 当前客户的占位符取值，用于标记「缺值」 */
  values?: PlaceholderValues | null;
  onInsert: (def: PlaceholderDef) => void;
  disabled?: boolean;
  className?: string;
}

export function PlaceholderBar({
  defs,
  values = null,
  onInsert,
  disabled = false,
  className,
}: PlaceholderBarProps): React.JSX.Element {
  // 按 group 归类，保持「客户信息」在前
  const groups = React.useMemo(() => {
    const map = new Map<PlaceholderDef['group'], PlaceholderDef[]>();
    for (const def of defs) {
      const list = map.get(def.group);
      if (list) list.push(def);
      else map.set(def.group, [def]);
    }
    return Array.from(map.entries());
  }, [defs]);

  return (
    <div className={cn('space-y-2 rounded-md border bg-muted/30 p-2.5', className)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Braces className="h-3.5 w-3.5" aria-hidden />
        插入客户信息占位符
        <span className="hidden font-normal sm:inline">（发送时自动替换为真实内容）</span>
      </p>

      <div className="space-y-2">
        {groups.map(([group, items]) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-2xs text-muted-foreground/80">{group}</span>
            {items.map((def) => {
              const raw = values?.[def.key] ?? '';
              const missing = values !== null && (!raw || raw === PLACEHOLDER_FALLBACK[def.key]);
              const fallback = PLACEHOLDER_FALLBACK[def.key];

              const button = (
                <button
                  key={def.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onInsert(def)}
                  title={def.token}
                  className={cn(
                    'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    missing
                      ? 'border-dashed border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400'
                      : 'border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
                  )}
                >
                  {def.label}
                </button>
              );

              return (
                <Tooltip key={def.key}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent className="max-w-[18rem] text-xs">
                    <code className="mr-1 rounded bg-black/10 px-1 dark:bg-white/10">{def.token}</code>
                    {missing
                      ? `当前客户没有${def.label}，发送时会替换为「${fallback || '（空）'}」`
                      : `当前值：${raw}`}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
