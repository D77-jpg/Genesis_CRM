/**
 * 侧边导航
 * ------------------------------------------------------------------
 * 桌面端为固定侧栏（可折叠成图标条），移动端为覆盖式抽屉。
 * 两种形态共用同一份导航渲染逻辑，避免维护两套结构。
 */
import * as React from 'react';
import { NavLink } from 'react-router-dom';
import { FileText, FolderKanban, LayoutDashboard, Mail, PanelLeftClose, PanelLeftOpen, UserCog, Users, X } from 'lucide-react';
import { ROUTES } from '@/constants';
import { useMetaStore } from '@/store/meta.store';
import { selectIsAdmin, useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/project.store';

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** 精确匹配（根路径必须为 true，否则任何页面都会高亮） */
  end?: boolean;
  /** 仅管理员可见（业务员看不到入口，路由层还有 AdminRoute 兜底） */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.dashboard, label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: ROUTES.customers, label: '客户管理', icon: Users, end: false },
  { to: '/mail', label: '邮件中心', icon: Mail, end: false },
  { to: ROUTES.letters, label: '开发信记录', icon: Mail, end: false },
  { to: ROUTES.templates, label: '模板中心', icon: FileText, end: false },
  { to: ROUTES.users, label: '用户管理', icon: UserCog, end: false, adminOnly: true },
  { to: ROUTES.projects, label: '项目工作空间', icon: FolderKanban, end: false, adminOnly: true },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 移动端抽屉是否展开 */
  mobile?: boolean;
  onNavigate?: () => void;
}

function Brand({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const fallbackCompanyName = useMetaStore((state) => state.meta?.company?.name);
  const project = useProjectStore((state) => state.activeProject);

  return (
    <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3', collapsed && 'justify-center px-0')}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Mail className="h-4 w-4" aria-hidden />
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">{project?.name || '外贸 CRM'}</span>
          <span className="block truncate text-2xs text-muted-foreground">
            {project?.companyName || fallbackCompanyName || 'Customer Dev Letter Manager'}
          </span>
        </span>
      )}
    </div>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }): React.JSX.Element {
  const isAdmin = useAuthStore(selectIsAdmin);
  // 按角色过滤导航：带 adminOnly 的项仅管理员可见
  const items = React.useMemo(() => NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin), [isAdmin]);

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="主导航">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed && 'justify-center px-0',
              isActive
                ? 'bg-sidebar-accent text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggleCollapse, mobile = false, onNavigate }: SidebarProps): React.JSX.Element {
  // 移动端抽屉始终展开显示文字
  const isCollapsed = collapsed && !mobile;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <Brand collapsed={isCollapsed} />
        </div>
        {mobile && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="关闭导航"
            className="mr-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <NavList collapsed={isCollapsed} onNavigate={onNavigate} />

      {!mobile && (
        <div className="shrink-0 border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground',
              'transition-colors hover:bg-sidebar-accent/60 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden /> : <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />}
            {!collapsed && <span>折叠侧边栏</span>}
          </button>
        </div>
      )}
    </div>
  );
}
