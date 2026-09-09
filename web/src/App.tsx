/**
 * 应用根组件
 * ------------------------------------------------------------------
 * 只负责挂三件全局的东西：
 *  1. TooltipProvider —— 表格里大量 Tooltip，统一延迟设置避免鼠标划过就闪
 *  2. RouterProvider   —— 路由与守卫
 *  3. Toaster          —— sonner 全局轻提示
 */
import type * as React from 'react';
import { RouterProvider } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/popover';
import { Toaster } from '@/components/ui/sonner';
import { router } from '@/router';

export function App(): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={400}>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
