/**
 * 仪表盘
 * ------------------------------------------------------------------
 * 汇总客户与开发信的核心指标，帮助快速判断「还有多少客户没开发」。
 * 数据来自 GET /api/stats/overview（一次请求拿全，避免首屏打太多接口）。
 * 图表用纯 CSS 条形图实现，不引入图表库，保持依赖精简。
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Building2,
  CircleDashed,
  FileSpreadsheet,
  MailCheck,
  MailWarning,
  Percent,
  Send,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, InlineLoader } from '@/components/common/empty-state';
import { LetterStatusBadge } from '@/components/common/status-badge';
import { SalesFunnel } from '@/components/dashboard/sales-funnel';
import { SalesWorkspaceSection } from '@/components/dashboard/sales-workspace';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useOverviewStats } from '@/hooks/use-queries';
import { usePageTitle } from '@/hooks/use-ui';
import { useMetaStore } from '@/store/meta.store';
import { formatRelative, initials } from '@/lib/format';
import { customerDetailPath, MAIL_CHANNEL_LABEL, ROUTES } from '@/constants';
import { cn } from '@/lib/utils';
import type { DevelopmentLetter } from '@/types';

/** 横向条形：行业 / 等级分布 */
function BarList({
  data,
  emptyLabel,
  tone = 'primary',
}: {
  data: { _id: string; count: number }[];
  emptyLabel: string;
  tone?: 'primary' | 'pending';
}): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(...data.map((item) => item.count), 1);
  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <ul className="space-y-2.5">
      {data.map((item) => {
        const percent = total > 0 ? Math.round((item.count / total) * 100) : 0;
        return (
          <li key={item._id || '未知'} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium" title={item._id || '未填写'}>
                {item._id || '未填写'}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.count} · {percent}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-500',
                  tone === 'primary' ? 'bg-primary' : 'bg-status-pending',
                )}
                style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** 纵向柱状：近 14 天发送量 */
function TrendChart({ data }: { data: { _id: string; count: number }[] }): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-10 text-center text-xs text-muted-foreground">还没有发送记录</p>;
  }

  const max = Math.max(...data.map((item) => item.count), 1);

  return (
    <div>
      {/*
        柱子用「绝对定位 + 底部对齐」而不是 flex 列里的百分比高度：
        若外层用 items-end，子列的高度会由内容决定（非确定值），
        此时柱子的 height: X% 无法解析，会被当成 auto 而渲染成 0 高。
      */}
      <div className="flex h-32 gap-1" role="img" aria-label="每日开发信发送量趋势">
        {data.map((item) => (
          <div
            key={item._id}
            className="group relative flex-1"
            title={`${item._id}：${item.count} 封`}
          >
            <div
              className={cn(
                'absolute inset-x-0 bottom-0 rounded-t-sm transition-colors',
                item.count > 0 ? 'bg-primary/70 group-hover:bg-primary' : 'bg-muted',
              )}
              style={{ height: `${Math.max(3, (item.count / max) * 100)}%` }}
            />
            {/* 数值悬停显示：盖在整列上，不占布局，避免把柱子顶出容器 */}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xs font-medium tabular-nums text-foreground opacity-0 transition-opacity group-hover:opacity-100">
              {item.count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-2xs text-muted-foreground">
        <span>{data[0]?._id?.slice(5) ?? ''}</span>
        <span className="tabular-nums text-muted-foreground/70">共 {data.reduce((sum, item) => sum + item.count, 0)} 封</span>
        <span>{data[data.length - 1]?._id?.slice(5) ?? ''}</span>
      </div>
    </div>
  );
}

/** 最近开发信列表项 */
function RecentLetterRow({ letter }: { letter: DevelopmentLetter }): React.JSX.Element {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground"
        aria-hidden
      >
        {initials(letter.recipientName)}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={letter.customer ? customerDetailPath(letter.customer.id) : ROUTES.letters}
          className="block truncate text-sm font-medium hover:text-primary hover:underline"
        >
          {letter.subject || '（无主题）'}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {letter.recipientName || '—'} · {letter.recipientEmail}
          {letter.customer?.company ? ` · ${letter.customer.company}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <LetterStatusBadge status={letter.status} />
        <span className="text-2xs text-muted-foreground">
          {letter.sentAt ? formatRelative(letter.sentAt) : '未发送'}
        </span>
      </div>
    </li>
  );
}

export function DashboardPage(): React.JSX.Element {
  usePageTitle('仪表盘');
  const { data, loading, error, run } = useOverviewStats();
  const mailChannel = useMetaStore((state) => state.mailChannel);
  const companyName = useMetaStore((state) => state.meta?.company?.name);

  // 趋势图只取最近 14 天，柱子太多会挤在一起
  const trend = React.useMemo(() => (data?.letter.byDay ?? []).slice(-14), [data]);
  const industries = React.useMemo(() => (data?.customer.byIndustry ?? []).slice(0, 8), [data]);
  const grades = React.useMemo(() => (data?.customer.byGrade ?? []).slice(0, 6), [data]);

  if (error && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="仪表盘" />
        <Card>
          <ErrorState title="统计数据加载失败" description={error} onRetry={() => void run()} retrying={loading} />
        </Card>
      </div>
    );
  }

  const customer = data?.customer;
  const letter = data?.letter;

  return (
    <div className="space-y-4">
      <PageHeader
        title="仪表盘"
        description={
          companyName
            ? `${companyName} · 客户开发与开发信发送总览`
            : '客户开发与开发信发送总览'
        }
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void run()} loading={loading}>
              {!loading ? <Activity className="h-4 w-4" aria-hidden /> : null}
              刷新
            </Button>
            <Button type="button" size="sm" asChild>
              <Link to={ROUTES.customers}>
                <Users className="h-4 w-4" aria-hidden />
                去客户管理
              </Link>
            </Button>
          </>
        }
      />

      {mailChannel === 'mock' ? (
        <Alert variant="warning">
          <AlertDescription>
            当前邮件通道为「{MAIL_CHANNEL_LABEL.mock}」：开发信会完整落库并计入统计，但不会真实投递。配置{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs">server/.env</code> 里的 SMTP_* 变量即可切换为真实发送。
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <Card>
          <InlineLoader label="正在统计…" />
        </Card>
      ) : (
        <>
          {/* ---------------------------- 指标卡 ---------------------------- */}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="客户总数"
              value={customer?.total.toLocaleString('zh-CN') ?? '—'}
              icon={<Users className="h-4 w-4" aria-hidden />}
              tone="primary"
              hint={
                customer ? (
                  <>
                    有邮箱 {customer.withEmail} · 无邮箱 {customer.withoutEmail}
                  </>
                ) : undefined
              }
            />
            <StatCard
              label="待开发"
              value={customer?.pending.toLocaleString('zh-CN') ?? '—'}
              icon={<CircleDashed className="h-4 w-4" aria-hidden />}
              tone="pending"
              hint="还没有发送过开发信的客户"
            />
            <StatCard
              label="已开发"
              value={customer?.developed.toLocaleString('zh-CN') ?? '—'}
              icon={<MailCheck className="h-4 w-4" aria-hidden />}
              tone="developed"
              hint={customer ? `近 7 天联系 ${customer.contacted7d} 位` : undefined}
            />
            <StatCard
              label="开发率"
              value={`${data?.developmentRate ?? 0}%`}
              icon={<Percent className="h-4 w-4" aria-hidden />}
              tone={((data?.developmentRate ?? 0) >= 50 ? 'developed' : 'pending') as 'developed' | 'pending'}
              hint="已开发客户 / 客户总数"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="开发信总数"
              value={letter?.total.toLocaleString('zh-CN') ?? '—'}
              icon={<Send className="h-4 w-4" aria-hidden />}
              tone="primary"
              hint={letter ? `已发送 ${letter.sent} · 草稿 ${letter.draft}` : undefined}
            />
            <StatCard
              label="近 7 天发送"
              value={letter?.sent7d.toLocaleString('zh-CN') ?? '—'}
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              tone="developed"
              hint={letter ? `近 30 天 ${letter.sent30d} 封` : undefined}
            />
            <StatCard
              label="发送失败"
              value={letter?.failed.toLocaleString('zh-CN') ?? '—'}
              icon={<MailWarning className="h-4 w-4" aria-hidden />}
              tone={letter && letter.failed > 0 ? 'failed' : 'default'}
              hint={letter && letter.failed > 0 ? '到开发信记录页查看失败原因' : '一切正常'}
            />
            <StatCard
              label="当前通道"
              value={<span className="text-base">{MAIL_CHANNEL_LABEL[letter?.channel ?? mailChannel] ?? '—'}</span>}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
              hint="由后端环境变量决定"
            />
          </div>

          {/* ---------------------------- 销售工作区 ---------------------------- */}

          {data?.workspace ? <SalesWorkspaceSection workspace={data.workspace} /> : null}

          {/* ---------------------------- 销售漏斗与分布 ---------------------------- */}

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {customer?.byStatus ? <SalesFunnel byStatus={customer.byStatus} total={customer.total} /> : null}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                  行业分布
                </CardTitle>
                <CardDescription>按客户数量排序，最多显示 8 项</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList data={industries} emptyLabel="还没有填写行业的客户" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-muted-foreground" aria-hidden />
                  等级分布
                </CardTitle>
                <CardDescription>用于区分重点客户</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList data={grades} emptyLabel="还没有设置客户等级" tone="pending" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
                  发送趋势
                </CardTitle>
                <CardDescription>最近 14 天每天的发送量</CardDescription>
              </CardHeader>
              <CardContent>
                <TrendChart data={trend} />
              </CardContent>
            </Card>
          </div>

          {/* ---------------------------- 最近开发信 ---------------------------- */}

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-muted-foreground" aria-hidden />
                  最近的开发信
                </CardTitle>
                <CardDescription>最新 6 条记录，点击主题可跳到对应客户</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link to={ROUTES.letters}>查看全部</Link>
              </Button>
            </CardHeader>

            <Separator />

            <CardContent className="pt-2">
              {data && data.recentLetters.length > 0 ? (
                <ul className="divide-y">
                  {data.recentLetters.map((letter) => (
                    <RecentLetterRow key={letter.id} letter={letter} />
                  ))}
                </ul>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium">还没有发送过开发信</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    先在「客户管理」里导入或新建客户，然后选择客户点击「发送开发信」
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Button type="button" size="sm" asChild>
                      <Link to={ROUTES.customers}>去客户管理</Link>
                    </Button>
                    <Badge variant="muted">演示账号 admin / password</Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
