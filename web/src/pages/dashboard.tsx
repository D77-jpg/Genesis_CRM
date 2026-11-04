import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, RefreshCw, Sparkles, Target, Users } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, InlineLoader } from '@/components/common/empty-state';
import { SalesFunnel } from '@/components/dashboard/sales-funnel';
import { SalesWorkspaceSection } from '@/components/dashboard/sales-workspace';
import { useDashboardNavigation } from '@/components/dashboard/dashboard-navigation';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOverviewStats } from '@/hooks/use-queries';
import { usePageTitle } from '@/hooks/use-ui';
import { useMetaStore } from '@/store/meta.store';
import { useProjectStore } from '@/store/project.store';
import { MAIL_CHANNEL_LABEL, ROUTES } from '@/constants';
import { selectCanManageProjects, useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api';
import { useI18n } from '@/i18n';
import '@/components/dashboard/dashboard.css';

type MetricTone = 'mint' | 'violet' | 'amber' | 'rose';

/** 概览卡片：标签 + 柔色变化标签 + 大数字 + 说明（整体可点击，跳转到对应列表） */
function MetricCard({
  label,
  value,
  detail,
  chip,
  tone = 'violet',
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  chip: React.ReactNode;
  tone?: MetricTone;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="dashboard-metric">
      <span className="flex items-start justify-between gap-2">
        <span className="pt-0.5 text-[0.8125rem] font-medium text-foreground/70">{label}</span>
        <span className={cn('chip hidden shrink-0 sm:inline-flex', tone === 'violet' ? 'chip-violet' : 'chip-muted')}>{chip}</span>
      </span>
      <strong className="dashboard-metric-value">{value}</strong>
      <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span>
    </button>
  );
}

function BarList({ data, emptyLabel, total }: { data: { _id: string; count: number }[]; emptyLabel: string; total: number }): React.JSX.Element {
  if (!data.length) return <p className="py-5 text-sm text-muted-foreground">{emptyLabel}</p>;
  const max = Math.max(...data.map(item => item.count), 1);
  return <ul className="mt-4 space-y-3.5">{data.map(item => (
    <li key={item._id || '未填写'}>
      <div className="mb-1.5 flex justify-between gap-3 text-xs">
        <span className="truncate text-foreground/80">{item._id || '未填写'}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{item.count} · {total ? Math.round(item.count / total * 100) : 0}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-sm bg-muted" aria-hidden>
        <div className="h-full rounded-sm bg-primary/55" style={{ width: `${item.count / max * 100}%` }} />
      </div>
    </li>
  ))}</ul>;
}

function TrendChart({ data }: { data: { _id: string; count: number }[] }): React.JSX.Element {
  if (!data.length) return <p className="py-8 text-sm text-muted-foreground">还没有发送记录</p>;
  const max = Math.max(...data.map(item => item.count), 1);
  return (
    <div className="mt-4">
      <ul aria-label="近 14 天每日发送量" className="flex h-24 items-end gap-1.5 border-b border-border pb-px">
        {data.map(item => <li key={item._id} className="relative min-w-0 flex-1" title={`${item._id}：${item.count} 封`}>
          <span className="sr-only">{item._id}：{item.count} 封</span>
          <span aria-hidden className={cn('absolute inset-x-0 bottom-0 rounded-sm', item.count > 0 ? 'bg-primary/55' : 'bg-muted')}
            style={{ height: `${Math.max(3, item.count / max * 100)}%` }} />
        </li>)}
      </ul>
      <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{data[0]?._id.slice(5)}</span><span>共 {data.reduce((sum, item) => sum + item.count, 0)} 封</span><span>{data[data.length - 1]?._id.slice(5)}</span>
      </div>
    </div>
  );
}

export function DashboardPage(): React.JSX.Element {
  const { t, language } = useI18n();
  usePageTitle(t('dashboard.title'));
  const { data, loading, error, run } = useOverviewStats();
  const mailChannel = useMetaStore(state => state.mailChannel);
  const project = useProjectStore(state => state.activeProject);
  const canManage = useAuthStore(selectCanManageProjects);
  const [onboarding, setOnboarding] = React.useState<{ completedAt?: string; doneCount: number; totalCount: number } | null>(null);
  React.useEffect(() => {
    if (!canManage) {
      setOnboarding(null);
      return;
    }
    void apiGet<{ completedAt?: string; doneCount: number; totalCount: number }>('/projects/onboarding')
      .then(setOnboarding)
      .catch(() => undefined);
  }, [canManage, project?.id]);
  const { openCustomers, openLetters } = useDashboardNavigation();
  const date = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const metrics = data ? [
    {
      label: '客户总数',
      value: data.customer.total.toLocaleString('zh-CN'),
      detail: `其中 ${data.customer.withEmail} 位有邮箱`,
      chip: `${data.customer.withEmail} 位可发信`,
      tone: 'mint' as MetricTone,
      action: () => openCustomers(),
    },
    {
      label: '待开发客户',
      value: data.customer.pending.toLocaleString('zh-CN'),
      detail: '查看尚未开发的客户',
      chip: `占比 ${data.customer.total ? Math.round(data.customer.pending / data.customer.total * 100) : 0}%`,
      tone: 'amber' as MetricTone,
      action: () => openCustomers({ status: 'pending' }),
    },
    {
      label: '近 7 天发送',
      value: data.letter.sent7d.toLocaleString('zh-CN'),
      detail: `近 30 天 ${data.letter.sent30d} 封`,
      chip: `近 30 天 ${data.letter.sent30d} 封`,
      tone: 'mint' as MetricTone,
      action: () => openLetters(),
    },
    {
      label: '客户开发率',
      value: `${data.developmentRate}%`,
      detail: `已开发 ${data.customer.developed} / ${data.customer.total} 位`,
      chip: `${data.customer.developed}/${data.customer.total}`,
      tone: 'violet' as MetricTone,
      action: () => openCustomers(),
    },
  ] : [];

  return (
    <div className="workspace-page dashboard-page">
      <PageHeader title={t('dashboard.title')} description={`${project?.name || (language === 'zh' ? '当前项目' : 'Current project')} · ${date}`}
        actions={<>
          <Button variant="ghost" size="sm" onClick={() => void run()} loading={loading}>
            {!loading ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : null}刷新
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={ROUTES.prospecting}><Target className="h-4 w-4" aria-hidden />客户线索池</Link>
          </Button>
          <Button size="sm" onClick={() => openCustomers()}><Users className="h-4 w-4" aria-hidden />客户管理</Button>
        </>}
      />
      {canManage && onboarding && !onboarding.completedAt ? (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-medium">{t('dashboard.onboardingTitle')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('dashboard.onboardingDesc')}</p>
            </div>
          </div>
          <Button size="sm" asChild><Link to={ROUTES.onboarding}>{t('dashboard.onboardingCta')} · {onboarding.doneCount}/{onboarding.totalCount}</Link></Button>
        </div>
      ) : null}
      {mailChannel === 'mock' ? <Alert variant="warning"><AlertDescription>当前为「{MAIL_CHANNEL_LABEL.mock}」：开发信会完整记录并计入统计，不会真实投递。</AlertDescription></Alert> : null}
      {error ? <Alert variant="warning"><AlertDescription>{data ? '刷新失败，以下保留上次加载的数据。' : '统计数据暂时无法加载。'}</AlertDescription></Alert> : null}

      {error && !data ? <ErrorState title="工作台加载失败" description={error} onRetry={() => void run()} retrying={loading} />
        : !data ? <div className="panel py-12"><InlineLoader label="正在加载销售工作台…" /></div>
        : <>
          <section aria-label="业务概览" className="dashboard-metrics">
            {metrics.map(metric => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                detail={metric.detail}
                chip={metric.chip}
                tone={metric.tone}
                onClick={metric.action}
              />
            ))}
          </section>
          <SalesWorkspaceSection stats={data} />

          <details className="dashboard-analysis panel group">
            <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:px-5">
              <h2 className="section-title">业务分析</h2>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">销售阶段、客户分布与发送趋势</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="dashboard-analysis-grid">
              <div className="well p-4">
                <SalesFunnel byStatus={data.customer.byStatus} total={data.customer.total} />
              </div>
              <section aria-labelledby="industry-distribution-title" className="well p-4">
                <h3 id="industry-distribution-title" className="section-title">行业分布</h3>
                <p className="mt-1 text-xs text-muted-foreground">按数量排序，展示前 8 项</p>
                <BarList data={data.customer.byIndustry.slice(0, 8)} total={data.customer.total} emptyLabel="还没有填写行业" />
              </section>
              <section aria-labelledby="grade-distribution-title" className="well p-4">
                <h3 id="grade-distribution-title" className="section-title">客户等级</h3>
                <p className="mt-1 text-xs text-muted-foreground">按数量排序，展示前 6 项</p>
                <BarList data={data.customer.byGrade.slice(0, 6)} total={data.customer.total} emptyLabel="还没有设置等级" />
              </section>
              <section aria-labelledby="outreach-trend-title" className="well p-4">
                <h3 id="outreach-trend-title" className="section-title">近 14 天发送趋势</h3>
                <p className="mt-1 text-xs text-muted-foreground">累计开发信 {data.letter.total} 封 · 已发送 {data.letter.sent} 封</p>
                <TrendChart data={data.letter.byDay.slice(-14)} />
              </section>
            </div>
            <p className="mx-4 mb-4 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground sm:mx-5">近 7 天联系过 {data.customer.contacted7d} 位客户 · 当前 {data.customer.withoutEmail} 位客户缺少邮箱 · 草稿 {data.letter.draft} 封 · 发送失败 {data.letter.failed} 封</p>
          </details>
        </>}
    </div>
  );
}
