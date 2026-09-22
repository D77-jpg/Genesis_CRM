/**
 * 顶部栏：移动端菜单开关 + 当前页面标题 + 邮件通道提示 + 主题切换 + 用户菜单
 */
import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, FlaskConical, Menu, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { NAV_ITEMS } from './sidebar';
import { MAIL_CHANNEL_LABEL, ROUTES } from '@/constants';
import { useMetaStore } from '@/store/meta.store';
import { ProjectSwitcher } from './project-switcher';
import { useUiStore } from '@/store/ui.store';

/** 根据当前路径推断标题（客户详情页会带上「客户详情」） */
function resolveTitle(pathname: string): string {
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
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="打开导航菜单"
      >
        <Menu className="h-4 w-4" />
      </Button>

      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">{title}</h2>

      <ProjectSwitcher />

      {/* mock 通道时明确告知用户「不会真的发出去」，避免误判 */}
      {channel === 'mock' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 sm:inline-flex dark:text-amber-400">
              <FlaskConical className="h-3 w-3" aria-hidden />
              {MAIL_CHANNEL_LABEL.mock}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[16rem]">
            当前为模拟发送：开发信会完整记录，但不会真正投递邮件。
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={agentOpen ? 'secondary' : 'ghost'}
            size="icon"
            className="h-10 w-10 sm:h-9 sm:w-9"
            onClick={toggleAgent}
            aria-label={agentOpen ? '关闭业务 Agent' : '打开业务 Agent'}
            aria-expanded={agentOpen}
          >
            <Bot className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">业务 Agent · Ctrl/Cmd + Shift + A</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={scratchpadOpen ? 'secondary' : 'ghost'}
            size="icon"
            className="h-10 w-10 sm:h-9 sm:w-9"
            onClick={toggleScratchpad}
            aria-label={scratchpadOpen ? '关闭个人随手记' : '打开个人随手记'}
            aria-expanded={scratchpadOpen}
          >
            <StickyNote className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">个人随手记 · Ctrl/Cmd + Shift + M</TooltipContent>
      </Tooltip>

      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
