/**
 * 左侧导航栏
 * ------------------------------------------------------------------
 * 桌面端：悬浮岛内的固定侧栏，可折叠成图标条；移动端：覆盖式抽屉。
 * 两种形态共用同一份 NAV_ITEMS 与渲染逻辑，避免维护两套结构。
 */
import * as React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BookOpen,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  Target,
  UserCog,
  Users,
  X,
} from 'lucide-react';
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
  { to: ROUTES.prospecting, label: '今日开发', icon: Target, end: false },
  { to: '/mail', label: '邮件中心', icon: Mail, end: false },
  { to: ROUTES.letters, label: '开发信记录', icon: Mail, end: false },
  { to: '/knowledge', label: '知识库', icon: BookOpen, end: false },
  { to: ROUTES.templates, label: '模板中心', icon: FileText, end: false },
  { to: ROUTES.users, label: '用户管理', icon: UserCog, end: false, adminOnly: true },
  { to: ROUTES.projects, label: '项目工作空间', icon: FolderKanban, end: false, adminOnly: true },
  { to: ROUTES.agentDiagnostics, label: 'AI 使用情况', icon: ShieldCheck, end: false, adminOnly: true },
  { to: ROUTES.aiSettings, label: 'AI 配置', icon: Settings2, end: false, adminOnly: true },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** 移动端抽屉是否展开 */
  mobile?: boolean;
  onNavigate?: () => void;
}

function BrandMark(): React.JSX.Element {
  return (
    <span className="brand-mark flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.875rem] text-white">
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M7.2 16.8a4.6 4.6 0 0 1 0-9.2h9.6a4.6 4.6 0 0 1 0 9.2H7.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <circle cx="12" cy="12.2" r="2.1" fill="currentColor" />
      </svg>
    </span>
  );
}

function Brand({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const fallbackCompanyName = useMetaStore((state) => state.meta?.company?.name);
  const project = useProjectStore((state) => state.activeProject);
  const subtitle = project?.companyName || fallbackCompanyName || 'Customer Dev Letter Manager';

  return (
    <div className={cn('flex h-[3.75rem] shrink-0 items-center gap-2.5 border-b border-border/60 px-3.5', collapsed && 'justify-center px-0')}>
      <BrandMark />
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-[0.875rem] font-semibold leading-tight tracking-[-0.01em]" title={project?.name}>
            {project?.name || '外贸 CRM'}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground" title={subtitle}>
            {subtitle}
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
    <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3" aria-label="主导航">
      {[
        { label: '业务工作台', items: items.filter((item) => !item.adminOnly) },
        { label: '管理与配置', items: items.filter((item) => item.adminOnly) },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.label} className="space-y-0.5">
            {!collapsed ? (
              <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{group.label}</p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-border/70" aria-hidden />
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'group flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 py-2 text-[0.8125rem] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-primary-soft text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                <item.icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggleCollapse, mobile = false, onNavigate }: SidebarProps): React.JSX.Element {
  // 移动端抽屉始终展开显示文字
  const isCollapsed = collapsed && !mobile;

  return (
    <div className="flex h-full flex-col bg-card text-foreground">
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <Brand collapsed={isCollapsed} />
        </div>
        {mobile && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="关闭导航"
            className="mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <NavList collapsed={isCollapsed} onNavigate={onNavigate} />

      {!mobile && (
        <div className="shrink-0 border-t border-border/60 p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            className={cn(
              'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
              isCollapsed && 'justify-center px-0',
            )}
          >
            {isCollapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden /> : <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />}
            {!isCollapsed && <span>折叠侧边栏</span>}
          </button>
        </div>
      )}
    </div>
  );
}
