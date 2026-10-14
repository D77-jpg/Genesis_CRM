/**
 * AppShell —— 登录后的整体骨架
 * ------------------------------------------------------------------
 * 结构：左侧固定侧边栏 + 右侧（顶部栏 + 内容区）。
 * 侧边栏宽度通过 CSS 变量下发，内容区用它做左内边距，
 * 折叠动画只需修改变量值，不用在多处同步宽度数字。
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

const SIDEBAR_WIDTH = '14.5rem';
const SIDEBAR_WIDTH_COLLAPSED = '4.5rem';

export function AppShell(): React.JSX.Element {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const isMobile = useIsMobile();
  const location = useLocation();

  // 路由变化时自动收起移动端抽屉
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, setMobileNavOpen]);

  // 从桌面端切到移动端时复位折叠状态，避免抽屉宽度异常
  React.useEffect(() => {
    if (isMobile && mobileNavOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, mobileNavOpen]);

  useEscapeKey(() => setMobileNavOpen(false), mobileNavOpen && isMobile);

  const sidebarWidth = collapsed && !isMobile ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH;

  return (
    <div className="workspace-shell min-h-screen bg-background" style={{ ['--sidebar-width' as string]: sidebarWidth }}>
      <a href="#workspace-main" className="workspace-skip-link">跳转到主要内容</a>
      {/* 桌面端固定侧栏 */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border transition-[width] duration-200 ease-out lg:block"
        style={{ width: sidebarWidth }}
      >
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleSidebar} />
      </aside>

      {/* 移动端抽屉 */}
      <Dialog open={mobileNavOpen && isMobile} onOpenChange={setMobileNavOpen}>
          <DialogContent
            hideClose
            aria-describedby={undefined}
            className={cn('left-0 top-0 h-dvh max-h-none w-[16rem] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none border-0 p-0 sm:p-0')}
          >
            <DialogTitle className="sr-only">主导航</DialogTitle>
            <Sidebar collapsed={false} onToggleCollapse={toggleSidebar} mobile onNavigate={() => setMobileNavOpen(false)} />
          </DialogContent>
      </Dialog>

      <div className="flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ease-out lg:pl-[var(--sidebar-width)]">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main id="workspace-main" tabIndex={-1} className="workspace-main no-print min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto min-w-0 w-full max-w-[var(--workspace-content-width)]">
            <Outlet />
          </div>
        </main>
      </div>
      <ScratchpadPanel />
      <AgentPanel />
    </div>
  );
}
