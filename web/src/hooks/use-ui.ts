/**
 * 响应式断点 / 页面标题 / 快捷键等轻量 Hook
 */
import { useEffect, useState } from 'react';

/** 订阅 CSS 媒体查询，返回是否匹配（响应式布局切换用） */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** 移动端（< 1024px）判定：侧边栏改为抽屉 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 1023.98px)');
}

/** 设置浏览器标签页标题 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const suffix = '客户开发信管理工具';
    document.title = title ? `${title} · ${suffix}` : suffix;
  }, [title]);
}

/**
 * 按 Escape 关闭浮层（Dialog 已由 Radix 处理，这里用于自定义浮层与全局退出编辑态）。
 */
export function useEscapeKey(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler, active]);
}

/**
 * Ctrl/Cmd + S 保存快捷键。
 * 表单弹窗里用它提升录入效率，同时阻止浏览器默认的「保存网页」。
 */
export function useSaveShortcut(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler, active]);
}
