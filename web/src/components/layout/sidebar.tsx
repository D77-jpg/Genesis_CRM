/**
 * 左侧导航栏
 * ------------------------------------------------------------------
 * 桌面端：悬浮岛内的固定侧栏，可折叠成图标条；移动端：覆盖式抽屉。
 * 两种形态共用同一份 NAV_ITEMS 与渲染逻辑，避免维护两套结构。
 */
import * as React from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  BookOpen,
  Bot,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Mail,
  Package,
  Settings2,
  ShieldCheck,
  Target,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { ROUTES } from '@/constants';
import { useMetaStore } from '@/store/meta.store';
import { selectCanManageProjects, selectIsAdmin, useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/project.store';
import { ProjectLogo, projectLogoSrc } from '@/components/projects/project-logo';
import { useI18n, type TranslationKey } from '@/i18n';

export interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  /** 精确匹配（根路径必须为 true，否则任何页面都会高亮） */
  end?: boolean;
  /** Only system admins can see this entry. */
  adminOnly?: boolean;
  /** Admins and project admins can see this entry. */
  managerOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.dashboard, labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: ROUTES.customers, labelKey: 'nav.customers', icon: Users, end: false },
  { to: ROUTES.prospecting, labelKey: 'nav.prospecting', icon: Target, end: false },
  { to: ROUTES.outreachAutomation, labelKey: 'nav.outreach', icon: Bot, end: false },
  { to: '/mail', labelKey: 'nav.mail', icon: Mail, end: false },
  { to: ROUTES.letters, labelKey: 'nav.letters', icon: Mail, end: false },
  { to: '/knowledge', labelKey: 'nav.knowledge', icon: BookOpen, end: false },
  { to: ROUTES.products, labelKey: 'nav.products', icon: Package, end: false },
  { to: ROUTES.templates, labelKey: 'nav.templates', icon: FileText, end: false },
  { to: ROUTES.onboarding, labelKey: 'nav.onboarding', icon: ShieldCheck, end: false, managerOnly: true },
  { to: ROUTES.users, labelKey: 'nav.users', icon: UserCog, end: false, adminOnly: true },
  { to: ROUTES.projects, labelKey: 'nav.projects', icon: FolderKanban, end: false, managerOnly: true },
  { to: ROUTES.mailCompliance, labelKey: 'nav.compliance', icon: ShieldCheck, end: false, managerOnly: true },
  { to: ROUTES.agentDiagnostics, labelKey: 'nav.agentDiagnostics', icon: ShieldCheck, end: false, adminOnly: true },
  { to: ROUTES.aiSettings, labelKey: 'nav.aiSettings', icon: Settings2, end: false, adminOnly: true },
];

interface SidebarProps {
  collapsed: boolean;
  /** 移动端抽屉是否展开 */
  mobile?: boolean;
  onNavigate?: () => void;
}

function BrandMark(): React.JSX.Element {
  return (
    <span className="brand-mark flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white">
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M7.2 16.8a4.6 4.6 0 0 1 0-9.2h9.6a4.6 4.6 0 0 1 0 9.2H7.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <circle cx="12" cy="12.2" r="2.1" fill="currentColor" />
      </svg>
    </span>
  );
}

function Brand({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const fallbackCompanyName = useMetaStore((state) => state.meta?.company?.name);
  const project = useProjectStore((state) => state.activeProject);
  const subtitle = project?.companyName || fallbackCompanyName || 'Customer Development CRM';
  const hasLogo = Boolean(project && projectLogoSrc(project));

  return (
    <div className={cn('flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3', collapsed && 'justify-center px-0')}>
      <Link to={ROUTES.dashboard} className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" aria-label={t('nav.backDashboard')}>
        {project ? <ProjectLogo project={project} size={collapsed ? 'sm' : 'md'} compact={collapsed} className={collapsed ? undefined : 'dark:rounded dark:bg-white dark:px-1 dark:py-0.5'} /> : <BrandMark />}
        {!collapsed && !hasLogo ? (
          <span className="min-w-0">
            <span className="block truncate text-[0.8125rem] font-semibold leading-tight tracking-[-0.01em]">
              {project?.name || 'Genesis CRM'}
            </span>
            <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground" title={subtitle}>
              {subtitle}
            </span>
          </span>
        ) : null}
      </Link>
    </div>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const isAdmin = useAuthStore(selectIsAdmin);
  const canManageProjects = useAuthStore(selectCanManageProjects);
  // 按角色过滤导航：管理员入口和项目管理员入口分别控制
  const items = React.useMemo(
    () => NAV_ITEMS.filter((item) => (!item.adminOnly || isAdmin) && (!item.managerOnly || canManageProjects)),
    [isAdmin, canManageProjects],
  );

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label={t('nav.main')}>
      {[
        { label: t('nav.workspace'), items: items.filter((item) => !item.adminOnly && !item.managerOnly) },
        { label: t('nav.manage'), items: items.filter((item) => item.adminOnly || item.managerOnly) },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.label} className="space-y-0.5">
            {!collapsed ? (
              <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/65">{group.label}</p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-border" aria-hidden />
            )}
            {group.items.map((item) => (
              <NavLink
                key={`${group.label}-${item.labelKey}-${item.to}`}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                title={collapsed ? t(item.labelKey) : undefined}
                className={({ isActive }) =>
                  cn(
                    'group flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/65 hover:text-foreground',
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
              </NavLink>
            ))}
          </div>
        ))}
    </nav>
  );
}

/** The project rail keeps multi-project context visible without a second dropdown. */
function ProjectRail({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const { t } = useI18n();
  const items = useProjectStore((state) => state.items).filter((item) => item.status === 'active');
  const active = useProjectStore((state) => state.activeProject);
  const switchProject = useProjectStore((state) => state.switchProject);
  const activeRef = React.useRef<HTMLButtonElement | null>(null);

  // With many projects the rail scrolls independently. Keep the active project
  // visible when it changes, without moving the main workspace scroll.
  React.useEffect(() => {
    if (active?.id) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active?.id, items.length]);

  if (!items.length) return null;

  return (
    <div className="shrink-0 border-t border-border px-2 py-2">
      {!collapsed ? (
        <div className="mb-1 flex items-center justify-between px-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/65">{t('nav.projectsRail')}</p>
          <span className="text-[10px] tabular-nums text-muted-foreground/45">{items.length}</span>
        </div>
      ) : null}
      <div
        className={cn('sidebar-project-list max-h-[10rem] space-y-0.5 overflow-y-auto overscroll-contain pr-0.5', collapsed && 'max-h-[12rem]')}
        role="list"
        aria-label={t('nav.projectList')}
      >
        {items.map((project) => {
          const isActive = project.id === active?.id;
          return (
            <button
              key={project.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              onClick={() => void switchProject(project.id)}
              title={collapsed ? project.name : undefined}
              aria-pressed={isActive}
              className={cn(
                'flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[0.75rem] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/65 hover:text-foreground',
              )}
            >
              <ProjectLogo project={project} size="sm" compact />
              {!collapsed ? <span className="min-w-0 flex-1 truncate">{project.name}</span> : null}
              {!collapsed && isActive ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label={t('nav.currentProject')} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar({ collapsed, mobile = false, onNavigate }: SidebarProps): React.JSX.Element {
  const { t } = useI18n();
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
            aria-label={t('nav.close')}
            className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <NavList collapsed={isCollapsed} onNavigate={onNavigate} />

      <ProjectRail collapsed={isCollapsed} />
    </div>
  );
}
