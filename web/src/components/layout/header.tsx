/**
 * 顶栏（悬浮岛内部）
 * ------------------------------------------------------------------
 * 左侧：移动端菜单开关 + 当前页面标题；右侧：邮件通道提示、项目切换、
 * 销售助手、随手记、主题与用户菜单。主导航在左侧栏。
 */
import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, FlaskConical, Menu, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { ProjectSwitcher } from './project-switcher';
import { NAV_ITEMS } from './sidebar';
import { MAIL_CHANNEL_LABEL, ROUTES } from '@/constants';
import { useMetaStore } from '@/store/meta.store';
import { useUiStore } from '@/store/ui.store';

/** 根据当前路径推断标题（客户详情页会显示「客户详情」） */
function resolveTitle(pathname: string): string {
  if (pathname.startsWith(`${ROUTES.customers}/`)) return '客户详情';
  const exact = NAV_ITEMS.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)));
  if (exact) return exact.label;
  if (pathname.startsWith(ROUTES.customers)) return '客户详情';
  if (pathname.startsWith('/login')) return '登录';
  return '页面未找到';
}

export function Header({ onOpenMobileNav }: { onOpenMobileNav: () => void }): React.JSX.Element {
  const { pathname } = useLocation();
  const channel = useMetaStore((state) => state.mailChannel);
  const title = React.useMemo(() => resolveTitle(pathname), [pathname]);
  const scratchpadOpen = useUiStore((state) => state.scratchpadOpen);
  const toggleScratchpad = useUiStore((state) => state.toggleScratchpad);
  const agentOpen = useUiStore((state) => state.agentOpen);
  const toggleAgent = useUiStore((state) => state.toggleAgent);

  return (
    <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/80 px-3 py-2.5 backdrop-blur-xl sm:px-4 lg:px-5">
      <Button type="button" variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label="打开导航菜单">
        <Menu className="h-4 w-4" />
      </Button>

      <p className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold tracking-[-0.01em] text-foreground/90">{title}</p>

      <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
        {/* mock 通道时明确告知用户「不会真的发出去」，避免误判 */}
        {channel === 'mock' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="chip-amber hidden items-center gap-1.5 sm:inline-flex">
                <FlaskConical className="h-3 w-3" aria-hidden />
                {MAIL_CHANNEL_LABEL.mock}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[16rem]">
              当前为模拟发送：开发信会完整记录，但不会真正投递邮件。
            </TooltipContent>
          </Tooltip>
        )}

        <ProjectSwitcher />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={agentOpen ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="rounded-xl"
              onClick={toggleAgent}
              aria-label={agentOpen ? '关闭销售助手' : '打开销售助手'}
              aria-expanded={agentOpen}
            >
              <Bot className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">销售助手 · Ctrl/Cmd + Shift + A</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={scratchpadOpen ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="rounded-xl"
              onClick={toggleScratchpad}
              aria-label={scratchpadOpen ? '关闭个人随手记' : '打开个人随手记'}
              aria-expanded={scratchpadOpen}
            >
              <StickyNote className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">个人随手记 · Ctrl/Cmd + Shift + M</TooltipContent>
        </Tooltip>

        <ThemeToggle className="rounded-xl" />
        <UserMenu />
      </div>
    </header>
  );
}
