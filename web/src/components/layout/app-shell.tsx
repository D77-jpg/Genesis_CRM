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
import { selectIsReadOnly, useAuthStore } from '@/store/auth.store';
import { useI18n } from '@/i18n';

const SIDEBAR_WIDTH = '15rem';
const SIDEBAR_WIDTH_COLLAPSED = '3.75rem';

export function AppShell(): React.JSX.Element {
  const { t } = useI18n();
  const readOnly = useAuthStore(selectIsReadOnly);
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
    <div className="workspace-shell overflow-hidden">
      <a href="#workspace-main" className="workspace-skip-link">{t('app.skip')}</a>

      {/* App frame: flush white chrome, neutral canvas, content owns the hierarchy. */}
      <div className="workspace-shell-body flex h-full w-full overflow-hidden bg-background">
        {/* 桌面端侧栏 */}
        <aside
          className="hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 ease-out lg:block"
          style={{ width: sidebarWidth }}
        >
          <Sidebar collapsed={collapsed} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onOpenMobileNav={() => setMobileNavOpen(true)}
            sidebarCollapsed={collapsed}
            onToggleSidebar={toggleSidebar}
          />

          <main
            id="workspace-main"
            ref={scrollRef}
            tabIndex={-1}
            className="workspace-main no-print min-w-0 flex-1 overflow-y-auto bg-background px-4 py-4 sm:px-4 sm:py-4"
          >
            <div className="mx-auto min-w-0 w-full max-w-[var(--workspace-content-width)]">
              {readOnly ? (
                <div role="status" className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  <span><strong className="font-medium">{t('role.readOnlyTitle')}</strong> · {t('role.readOnlyDesc')}</span>
                </div>
              ) : null}
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
          className={cn('left-0 top-0 h-dvh max-h-none w-[16rem] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none border-0 p-0 sm:p-0')}
        >
          <DialogTitle className="sr-only">{t('nav.main')}</DialogTitle>
          <Sidebar collapsed={false} mobile onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>

      <ScratchpadPanel />
      <AgentPanel />
    </div>
  );
}
