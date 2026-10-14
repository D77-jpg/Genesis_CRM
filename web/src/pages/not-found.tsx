/**
 * 404 页面
 * ------------------------------------------------------------------
 * 在工作空间内展示清晰的兜底状态，保留返回与仪表盘入口。
 */
import type * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-ui';
import { ROUTES } from '@/constants';

export function NotFoundPage(): React.JSX.Element {
  usePageTitle('页面不存在');
  const navigate = useNavigate();

  return (
    <div className="workspace-page flex min-h-[65vh] items-center justify-center bg-background p-4">

      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
            <Compass className="h-6 w-6" />
          </span>
          <p className="text-4xl font-semibold tracking-tight">404</p>
          <h1 className="text-xl font-semibold tracking-tight">找不到这个页面</h1>
          <p className="text-xs leading-relaxed text-muted-foreground">
            链接可能已失效，或者该客户 / 开发信记录已经被删除。
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              返回上一页
            </Button>
            <Button type="button" size="sm" asChild>
              <Link to={ROUTES.dashboard}>回到仪表盘</Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link to={ROUTES.customers}>客户管理</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
