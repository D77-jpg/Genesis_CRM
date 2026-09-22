/**
 * 路由表
 * ------------------------------------------------------------------
 *   /login                  公开（已登录时反向重定向到仪表盘）
 *   ProtectedRoute          守卫：恢复登录态 → 未登录跳 /login → 渲染 AppShell
 *     /                     仪表盘
 *     /customers            客户管理
 *     /customers/:id        客户详情（支持 #letters 锚点直达开发信区）
 *     /letters              开发信记录
 *     /templates            开发信模板中心
 *     /users                用户管理（AdminRoute：仅管理员）
 *     *                     404
 *
 * 页面组件全部 React.lazy 分包：Quill 与 xlsx 体积不小，
 * 首屏只需要登录页 + 仪表盘，其余按需加载。
 */
import * as React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { GuestRoute, ProtectedRoute, AdminRoute, ScrollToTop } from './guards';
import { PageLoader } from '@/components/common/page-loader';
import { ROUTES } from '@/constants';

const LoginPage = React.lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })));
const DashboardPage = React.lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })));
const CustomersPage = React.lazy(() => import('@/pages/customers').then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = React.lazy(() =>
  import('@/pages/customer-detail').then((m) => ({ default: m.CustomerDetailPage })),
);
const MailPage = React.lazy(() => import('@/pages/mail').then(m => ({ default: m.MailPage })));
const LettersPage = React.lazy(() => import('@/pages/letters').then((m) => ({ default: m.LettersPage })));
const TemplatesPage = React.lazy(() => import('@/pages/templates').then((m) => ({ default: m.TemplatesPage })));
const UsersPage = React.lazy(() => import('@/pages/users').then((m) => ({ default: m.UsersPage })));
const ProjectsPage = React.lazy(() => import('@/pages/projects').then((m) => ({ default: m.ProjectsPage })));
const AgentDiagnosticsPage = React.lazy(() => import('@/pages/agent-diagnostics').then((m) => ({ default: m.AgentDiagnosticsPage })));
const NotFoundPage = React.lazy(() => import('@/pages/not-found').then((m) => ({ default: m.NotFoundPage })));

/** 懒加载页面的统一 Suspense 包装（局部工具，不对外导出） */
function withSuspense(node: React.ReactNode): React.JSX.Element {
  return <React.Suspense fallback={<PageLoader />}>{node}</React.Suspense>;
}

export const router = createBrowserRouter([
  {
    path: ROUTES.login,
    element: withSuspense(
      <GuestRoute>
        <LoginPage />
      </GuestRoute>,
    ),
  },
  {
    path: '/',
    element: (
      <>
        <ScrollToTop />
        <ProtectedRoute />
      </>
    ),
    children: [
      { index: true, element: withSuspense(<DashboardPage />) },
      { path: 'customers', element: withSuspense(<CustomersPage />) },
      { path: 'customers/:id', element: withSuspense(<CustomerDetailPage />) },
      { path: 'mail', element: withSuspense(<MailPage />) },
      { path: 'letters', element: withSuspense(<LettersPage />) },
      { path: 'templates', element: withSuspense(<TemplatesPage />) },
      {
        path: 'users',
        element: <AdminRoute>{withSuspense(<UsersPage />)}</AdminRoute>,
      },
      {
        path: 'projects',
        element: <AdminRoute>{withSuspense(<ProjectsPage />)}</AdminRoute>,
      },
      {
        path: 'agent-diagnostics',
        element: <AdminRoute>{withSuspense(<AgentDiagnosticsPage />)}</AdminRoute>,
      },
      { path: '*', element: withSuspense(<NotFoundPage />) },
    ],
  },
]);
