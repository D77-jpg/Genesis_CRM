/**
 * AppShell —— 登录后的整体骨架
 * ------------------------------------------------------------------
 * 结构：淡薰衣草画布上的一整块白色「悬浮岛」（大圆角 + 柔和阴影）；
 * 岛内左侧为可折叠导航栏，右侧是顶栏（标题 + 工具区）+ 可滚动内容区。
 * 移动端：整屏铺满，导航收进左侧抽屉。
 */
import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { useUiStore } from '@/store/ui.store';
import { useIsMobile } from '@/hooks/use-ui';
import { useEscapeKey } from '@/hooks/use-ui';
import { cn } from '@/lib/utils';
import { ScratchpadPanel } from '@/components/scratchpad/scratchpad-panel';
import { AgentPanel } from '@/components/agent/agent-panel';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const SIDEBAR_WIDTH = '15rem';
const SIDEBAR_WIDTH_COLLAPSED = '4.75rem';

export function AppShell(): React.JSX.Element {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const isMobile = useIsMobile();
  const location = useLocation();
  const scrollRef = React.useRef<HTMLElement | null>(null);

  // 路由变化时自动收起移动端抽屉，并把内容区滚回顶部
  React.useEffect(() => {
    setMobileNavOpen(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname, setMobileNavOpen]);

  // 抽屉展开时锁定背景滚动
  React.useEffect(() => {
    if (isMobile && mobileNavOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, mobileNavOpen]);

  useEscapeKey(() => setMobileNavOpen(false), mobileNavOpen && isMobile);

  const sidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH;

  return (
    <div className="workspace-shell h-dvh overflow-hidden">
      <a href="#workspace-main" className="workspace-skip-link">跳转到主要内容</a>

      {/* 主面板：铺满窗口、直角贴合（不再有外框留白和圆角） */}
      <div className="workspace-shell-body flex h-full w-full overflow-hidden bg-card">
        {/* 桌面端侧栏 */}
        <aside
          className="hidden shrink-0 border-r border-border/60 transition-[width] duration-200 ease-out lg:block"
          style={{ width: sidebarWidth }}
        >
          <Sidebar collapsed={collapsed} onToggleCollapse={toggleSidebar} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenMobileNav={() => setMobileNavOpen(true)} />

          <main
            id="workspace-main"
            ref={scrollRef}
            tabIndex={-1}
            className="workspace-main no-print min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5 sm:py-6"
          >
            <div className="mx-auto min-w-0 w-full max-w-[var(--workspace-content-width)]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      {/* 移动端导航抽屉 */}
      <Dialog open={mobileNavOpen && isMobile} onOpenChange={setMobileNavOpen}>
        <DialogContent
          hideClose
          aria-describedby={undefined}
          className={cn('left-0 top-0 h-dvh max-h-none w-[17rem] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none border-0 p-0 sm:p-0')}
        >
          <DialogTitle className="sr-only">主导航</DialogTitle>
          <Sidebar collapsed={false} onToggleCollapse={toggleSidebar} mobile onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>

      <ScratchpadPanel />
      <AgentPanel />
    </div>
  );
}
