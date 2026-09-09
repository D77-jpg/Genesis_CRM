/**
 * 路由守卫
 * ------------------------------------------------------------------
 * 与路由表分文件：路由表只描述「路径 → 页面」的映射，
 * 守卫只负责鉴权与全局副作用，职责单一、便于单测。
 */
import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { PageLoader } from '@/components/common/page-loader';
import { useAuthStore } from '@/store/auth.store';
import { useMetaStore } from '@/store/meta.store';
import { ROUTES } from '@/constants';

/** 路由切换后回到顶部（详情页的 #letters 锚点由页面自己处理） */
export function ScrollToTop(): null {
  const { pathname } = useLocation();

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return null;
}

/** 需要登录才能访问的区域：校验通过则渲染 AppShell（子路由由其 Outlet 承接） */
export function ProtectedRoute(): React.JSX.Element {
  const status = useAuthStore((state) => state.status);
  const initialized = useAuthStore((state) => state.initialized);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const fetchMeta = useMetaStore((state) => state.fetchMeta);
  const location = useLocation();

  // 首屏：有 token 就校验，没有就直接进入未登录态
  React.useEffect(() => {
    if (!initialized) void bootstrap();
  }, [initialized, bootstrap]);

  // 登录成功后拉一次元数据（占位符定义、我方公司信息、邮件通道）
  React.useEffect(() => {
    if (status === 'authenticated') void fetchMeta();
  }, [status, fetchMeta]);

  if (!initialized) {
    return <PageLoader label="正在恢复登录状态…" />;
  }

  if (status !== 'authenticated') {
    // 记住来路，登录成功后直接跳回，省去二次点击
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={ROUTES.login} replace state={{ from }} />;
  }

  return <AppShell />;
}

/** 已登录时不再显示登录页 */
export function GuestRoute({ children }: { children: React.ReactNode }): React.JSX.Element {
  const status = useAuthStore((state) => state.status);
  const initialized = useAuthStore((state) => state.initialized);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  React.useEffect(() => {
    if (!initialized) void bootstrap();
  }, [initialized, bootstrap]);

  if (!initialized) return <PageLoader label="正在校验登录状态…" />;
  if (status === 'authenticated') return <Navigate to={ROUTES.dashboard} replace />;
  return <>{children}</>;
}

/**
 * 仅管理员可访问的区域（如用户管理）。
 * 入口在侧边栏已按角色隐藏，这里是直接敲 URL 时的兜底：非管理员一律回仪表盘。
 * 必须嵌在 ProtectedRoute 之内使用，此时登录态与 user 已就绪。
 */
export function AdminRoute({ children }: { children: React.ReactNode }): React.JSX.Element {
  const role = useAuthStore((state) => state.user?.role);
  if (role !== 'admin') return <Navigate to={ROUTES.dashboard} replace />;
  return <>{children}</>;
}
