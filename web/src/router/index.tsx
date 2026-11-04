/**
 * 路由表
 * ------------------------------------------------------------------
 *   /login                  公开（已登录时反向重定向到仪表盘）
 *   /reset-password         公开（邮件重置密码链接）
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
import { GuestRoute, ProtectedRoute, AdminRoute, PlatformRoute, ScrollToTop } from './guards';
import { PageLoader } from '@/components/common/page-loader';
import { ROUTES } from '@/constants';

const LoginPage = React.lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })));
const ResetPasswordPage = React.lazy(() => import('@/pages/reset-password').then((m) => ({ default: m.ResetPasswordPage })));
const DashboardPage = React.lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })));
const CustomersPage = React.lazy(() => import('@/pages/customers').then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = React.lazy(() =>
  import('@/pages/customer-detail').then((m) => ({ default: m.CustomerDetailPage })),
);
const ProspectingPage = React.lazy(() => import('@/pages/prospecting').then((m) => ({ default: m.ProspectingPage })));
const OutreachAutomationPage = React.lazy(() => import('@/pages/outreach-automation').then((m) => ({ default: m.OutreachAutomationPage })));
const MailPage = React.lazy(() => import('@/pages/mail').then(m => ({ default: m.MailPage })));
const LettersPage = React.lazy(() => import('@/pages/letters').then((m) => ({ default: m.LettersPage })));
const KnowledgePage = React.lazy(() => import('@/pages/knowledge').then(m=>({default:m.KnowledgePage})));
const TemplatesPage = React.lazy(() => import('@/pages/templates').then((m) => ({ default: m.TemplatesPage })));
const ProductsPage = React.lazy(() => import('@/pages/products').then((m) => ({ default: m.ProductsPage })));
const UsersPage = React.lazy(() => import('@/pages/users').then((m) => ({ default: m.UsersPage })));
const ProjectsPage = React.lazy(() => import('@/pages/projects').then((m) => ({ default: m.ProjectsPage })));
const OnboardingPage = React.lazy(() => import('@/pages/onboarding').then((m) => ({ default: m.OnboardingPage })));
const MailCompliancePage = React.lazy(() => import('@/pages/mail-compliance').then((m) => ({ default: m.MailCompliancePage })));
const AgentDiagnosticsPage = React.lazy(() => import('@/pages/agent-diagnostics').then((m) => ({ default: m.AgentDiagnosticsPage })));
const AiSettingsPage = React.lazy(() => import('@/pages/ai-settings').then((m) => ({ default: m.AiSettingsPage })));
const OrganizationPage = React.lazy(() => import('@/pages/organization').then((m) => ({ default: m.OrganizationPage })));
const BillingPage = React.lazy(() => import('@/pages/billing').then((m) => ({ default: m.BillingPage })));
const PlatformPage = React.lazy(() => import('@/pages/platform').then((m) => ({ default: m.PlatformPage })));
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
    path: ROUTES.resetPassword,
    element: withSuspense(<ResetPasswordPage />),
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
      { path: 'prospecting', element: withSuspense(<ProspectingPage />) },
      { path: 'outreach-automation', element: withSuspense(<OutreachAutomationPage />) },
      { path: 'mail', element: withSuspense(<MailPage />) },
      { path: 'letters', element: withSuspense(<LettersPage />) },
      { path: 'knowledge', element: withSuspense(<KnowledgePage />) },
      { path: 'templates', element: withSuspense(<TemplatesPage />) },
      { path: 'products', element: withSuspense(<ProductsPage />) },
      {
        path: 'users',
        element: <AdminRoute>{withSuspense(<UsersPage />)}</AdminRoute>,
      },
      { path: 'onboarding', element: withSuspense(<OnboardingPage />) },
      {
        path: 'projects',
        element: <AdminRoute roles={['admin', 'project_admin']}>{withSuspense(<ProjectsPage />)}</AdminRoute>,
      },
      {
        path: 'mail-compliance',
        element: <AdminRoute roles={['admin', 'project_admin']}>{withSuspense(<MailCompliancePage />)}</AdminRoute>,
      },
      {
        path: 'agent-diagnostics',
        element: <AdminRoute>{withSuspense(<AgentDiagnosticsPage />)}</AdminRoute>,
      },
      {
        path: 'ai-settings',
        element: <AdminRoute>{withSuspense(<AiSettingsPage />)}</AdminRoute>,
      },
      {
        path: 'organization',
        element: <AdminRoute roles={['admin', 'project_admin']}>{withSuspense(<OrganizationPage />)}</AdminRoute>,
      },
      {
        path: 'billing',
        element: <AdminRoute>{withSuspense(<BillingPage />)}</AdminRoute>,
      },
      {
        path: 'platform',
        element: <PlatformRoute>{withSuspense(<PlatformPage />)}</PlatformRoute>,
      },
      { path: '*', element: withSuspense(<NotFoundPage />) },
    ],
  },
]);
