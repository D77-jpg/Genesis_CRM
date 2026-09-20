/**
 * UI 状态：主题（深色/浅色）与侧边栏折叠
 * ------------------------------------------------------------------
 * 主题值持久化到 localStorage，index.html 里的内联脚本会在首屏前读取它，
 * 因此这里的读写格式必须与那段脚本兼容（JSON 字符串，脚本侧做了去引号处理）。
 */
import { create } from 'zustand';
import { STORAGE_KEYS } from '@/constants';
import { readStorage, writeStorage } from '@/lib/utils';

export type Theme = 'light' | 'dark';

/** 把主题落到 <html> 上（Tailwind darkMode: 'class'） */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

function detectInitialTheme(): Theme {
  const stored = readStorage<Theme | null>(STORAGE_KEYS.theme, null);
  if (stored === 'dark' || stored === 'light') return stored;
  // 与 index.html 内联脚本同源：以 <html> 上已有的类为准，避免二次闪烁
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

interface UiState {
  theme: Theme;
  /** 桌面端侧边栏是否折叠成图标条 */
  sidebarCollapsed: boolean;
  /** 移动端抽屉是否展开 */
  mobileNavOpen: boolean;
  /** 全局个人随手记面板是否展开 */
  scratchpadOpen: boolean;
  /** 全局只读 Agent 面板是否展开 */
  agentOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setScratchpadOpen: (open: boolean) => void;
  toggleScratchpad: () => void;
  setAgentOpen: (open: boolean) => void;
  toggleAgent: () => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  theme: detectInitialTheme(),
  sidebarCollapsed: readStorage<boolean>(STORAGE_KEYS.sidebar, false),
  mobileNavOpen: false,
  scratchpadOpen: false,
  agentOpen: false,

  setTheme: (theme) => {
    applyTheme(theme);
    writeStorage(STORAGE_KEYS.theme, theme);
    set({ theme });
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },

  setSidebarCollapsed: (collapsed) => {
    writeStorage(STORAGE_KEYS.sidebar, collapsed);
    set({ sidebarCollapsed: collapsed });
  },

  toggleSidebar: () => {
    get().setSidebarCollapsed(!get().sidebarCollapsed);
  },

  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  setScratchpadOpen: (open) => set({ scratchpadOpen: open, ...(open ? { agentOpen: false } : {}) }),
  toggleScratchpad: () => set((state) => ({ scratchpadOpen: !state.scratchpadOpen, agentOpen: state.scratchpadOpen ? state.agentOpen : false })),
  setAgentOpen: (open) => set({ agentOpen: open, ...(open ? { scratchpadOpen: false } : {}) }),
  toggleAgent: () => set((state) => ({ agentOpen: !state.agentOpen, scratchpadOpen: state.agentOpen ? state.scratchpadOpen : false })),
}));

// 模块加载时同步一次，保证 store 与 DOM 状态一致
applyTheme(useUiStore.getState().theme);
