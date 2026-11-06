import {GlobalSiteNotifications} from '@/components/customers/globalsite-inquiries';
/**
 * Top bar — a compact utility strip. Page titles live in the content area;
 * this bar holds project context, global customer search and quick tools.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Menu, PanelLeftClose, PanelLeftOpen, Search, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { ThemeToggle } from './theme-toggle';
import { LanguageToggle } from './language-toggle';
import { UserMenu } from './user-menu';
import { ProjectSwitcher } from './project-switcher';
import { ROUTES } from '@/constants';
import { useMetaStore } from '@/store/meta.store';
import { useUiStore } from '@/store/ui.store';
import { useCustomerStore } from '@/store/customer.store';
import { useI18n } from '@/i18n';

/** Customer search is the cross-workspace entry point; Enter applies the real list filter. */
function GlobalSearch(): React.JSX.Element {
  const navigate = useNavigate();
  const setFilters = useCustomerStore((state) => state.setFilters);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState('');
  const shortcutKey = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  const { t } = useI18n();

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const query = value.trim();
    if (!query) return;
    setFilters({ search: query });
    navigate(ROUTES.customers);
    setValue('');
  }

  return (
    <form onSubmit={submit} role="search" className="relative hidden w-full max-w-[22rem] md:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={t('header.searchAria')}
        aria-keyshortcuts="Control+K Meta+K"
        placeholder={t('header.searchPlaceholder')}
        className="h-8 w-full rounded-md border border-transparent bg-muted/70 pl-8 pr-12 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/80 hover:bg-muted focus:border-border focus:bg-card focus:ring-2 focus:ring-primary/10"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {shortcutKey}
      </kbd>    </form>
  );
}

export interface HeaderProps {
  onOpenMobileNav: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function Header({ onOpenMobileNav, sidebarCollapsed, onToggleSidebar }: HeaderProps): React.JSX.Element {
  const { t } = useI18n();
  const channel = useMetaStore((state) => state.mailChannel);
  const scratchpadOpen = useUiStore((state) => state.scratchpadOpen);
  const toggleScratchpad = useUiStore((state) => state.toggleScratchpad);
  const agentOpen = useUiStore((state) => state.agentOpen);
  const toggleAgent = useUiStore((state) => state.toggleAgent);

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-4 lg:px-5">
      <Button type="button" variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label={t('nav.open')}>
        <Menu className="h-4 w-4" />
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden lg:inline-flex"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
            aria-pressed={sidebarCollapsed}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}</TooltipContent>
      </Tooltip>

      <ProjectSwitcher />
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {channel === 'mock' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mr-1 hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                {t('header.mock')}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[16rem]">
              {t('header.mockHint')}
            </TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={agentOpen ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={toggleAgent}
              aria-label={agentOpen ? t('header.assistantClose') : t('header.assistantOpen')}
              aria-expanded={agentOpen}
            >
              <Bot className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('header.assistant')} · Ctrl/Cmd + Shift + A</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={scratchpadOpen ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={toggleScratchpad}
              aria-label={scratchpadOpen ? t('header.scratchpadClose') : t('header.scratchpadOpen')}
              aria-expanded={scratchpadOpen}
            >
              <StickyNote className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('header.scratchpad')} · Ctrl/Cmd + Shift + M</TooltipContent>
        </Tooltip>

        <GlobalSiteNotifications />
        <LanguageToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
