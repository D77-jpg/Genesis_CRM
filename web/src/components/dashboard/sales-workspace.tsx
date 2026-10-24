import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, ChevronRight, Inbox, Mail, MessageSquare, Users } from 'lucide-react';
import { CustomerStatusBadge, LetterStatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { countryInfo } from '@/lib/country';
import { CountryFlag } from '@/components/common/country-flag';
import { cn } from '@/lib/utils';
import { formatDate, formatRelative, initials } from '@/lib/format';
import { customerDetailPath, FOLLOW_UP_METHOD_LABEL, FOLLOW_UP_RESULT_LABEL, ROUTES } from '@/constants';
import { useDashboardNavigation } from './dashboard-navigation';
import type { CustomerBrief, DevelopmentLetter, OverviewStats, RecentFollowUpItem } from '@/types';

function CustomerRow({ customer, overdue, recent = false }: {
  customer: CustomerBrief; overdue?: boolean; recent?: boolean;
}): React.JSX.Element {
  // 副标题优先公司名，其次等级；国家与行业跟在后面，便于快速判断客户画像
  const companyLabel = customer.company && customer.company !== customer.name
    ? customer.company : customer.grade ? `${customer.grade} 级客户` : '客户档案';
  const marketLabel = [countryInfo(customer.country)?.name, customer.industry].filter(Boolean).join(' · ');
  const subtitle = marketLabel ? `${companyLabel} · ${marketLabel}` : companyLabel;
  const dateLabel = recent ? formatRelative(customer.createdAt) : overdue
    ? `已逾期 · ${formatDate(customer.nextFollowUpAt)}` : '今天跟进';
  return (
    <li>
      <Link to={customerDetailPath(customer.id)} className="dashboard-customer-row group">
        <span className="flex min-w-0 items-center gap-3">
          <span className="avatar-bubble flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold" aria-hidden>
            {initials(customer.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium group-hover:text-primary">{customer.name}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <CountryFlag value={customer.country} />
              <span className="truncate">{subtitle}</span>
            </span>
            <span className={cn("mt-0.5 block text-xs text-muted-foreground sm:hidden", overdue && "text-destructive")}>{dateLabel}</span>
          </span>
        </span>
        <span className="dashboard-customer-status"><CustomerStatusBadge status={customer.status} /></span>
        <span className={cn('dashboard-customer-date text-xs text-muted-foreground', overdue && 'font-medium text-destructive')}>
          {dateLabel}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground/70 transition-colors group-hover:text-primary" aria-hidden />
      </Link>
    </li>
  );
}

function RecentFollowUpRow({ item }: { item: RecentFollowUpItem }): React.JSX.Element {
  return (
    <li>
      <Link to={customerDetailPath(item.customerId)} className="group -mx-2 block rounded-xl border-b border-border/60 px-2 py-4 transition-colors last:border-0 hover:bg-accent/70">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium group-hover:text-primary">{item.customerName}</span>
          <time dateTime={new Date(item.followUpAt).toISOString()} className="text-xs text-muted-foreground">{formatRelative(item.followUpAt)}</time>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {FOLLOW_UP_METHOD_LABEL[item.method] ?? item.method} · {FOLLOW_UP_RESULT_LABEL[item.result] ?? item.result}
          {item.customerCompany && item.customerCompany !== item.customerName ? ` · ${item.customerCompany}` : ''}
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.content}</p>
      </Link>
    </li>
  );
}

function RecentLetterRow({ letter }: { letter: DevelopmentLetter }): React.JSX.Element {
  return (
    <li className="border-b border-border/60 last:border-0">
      <Link to={letter.customer ? customerDetailPath(letter.customer.id) : ROUTES.letters}
        className="group -mx-2 flex items-start gap-3 rounded-xl px-2 py-4 transition-colors hover:bg-accent/70">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden>
          <Mail className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:text-primary">{letter.subject || '（无主题）'}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{letter.recipientName} · {letter.recipientEmail}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <LetterStatusBadge status={letter.status} />
          <span className="text-xs text-muted-foreground">{letter.sentAt ? formatRelative(letter.sentAt) : '未发送'}</span>
        </span>
      </Link>
    </li>
  );
}

function ListEmpty({ icon: Icon, title, description, children }: React.PropsWithChildren<{
  icon: typeof Users; title: string; description: string;
}>): React.JSX.Element {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-4 py-8 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface" aria-hidden>
        <Icon className="h-6 w-6 text-muted-foreground/70" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/** 提醒行：图标气泡 + 文案 + 计数（参考稿 Priority tasks 的节奏） */
const REMINDER_ICONS = {
  overdue: CalendarCheck2,
  upcoming: ArrowRight,
  draft: MessageSquare,
  failed: Inbox,
  email: Users,
} as const;

const tabClass = 'px-3 text-xs sm:text-sm';

export function SalesWorkspaceSection({ stats }: { stats: OverviewStats }): React.JSX.Element {
  const { workspace, customer, letter } = stats;
  const { openCustomers, openLetters } = useDashboardNavigation();
  const dueCount = workspace.followUpToday + workspace.followUpOverdue;

  return (
    <section aria-labelledby="customer-worklist-title" className="dashboard-workbench">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="customer-worklist-title" className="section-title">客户工作清单</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {dueCount > 0 ? `今天待跟进 ${workspace.followUpToday} 位，另有 ${workspace.followUpOverdue} 位已逾期。`
                : customer.pending > 0 ? '今天没有到期跟进，从最近加入的客户开始开发。' : '今天没有到期跟进，可查看最近客户和沟通动态。'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => openCustomers()} className="hidden sm:inline-flex">
            全部客户 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>

        <Tabs defaultValue={dueCount > 0 ? 'followups' : 'customers'} className="mt-4">
          <TabsList aria-label="客户工作清单" className="w-fit max-w-full justify-start">
            <TabsTrigger value="followups" className={tabClass}>
              待跟进{dueCount > 0 ? <span className="chip chip-violet ml-1 px-1.5 py-0.5 text-[10px] leading-none">{dueCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="customers" className={tabClass}>最近客户</TabsTrigger>
            <TabsTrigger value="activity" className={tabClass}>跟进动态</TabsTrigger>
            <TabsTrigger value="letters" className={tabClass}>邮件记录</TabsTrigger>
          </TabsList>
          <TabsContent value="customers" className="mt-0">
            {workspace.recentCustomers.length ? (
              <>
                <div aria-hidden className="dashboard-customer-row dashboard-list-heading">
                  <span>客户 / 公司</span><span className="dashboard-customer-status">当前阶段</span>
                  <span className="dashboard-customer-date">加入时间</span><span />
                </div>
                <ul aria-label="最近加入的客户">{workspace.recentCustomers.map(item => <CustomerRow key={item.id} customer={item} recent />)}</ul>
                <div className="dashboard-list-footer">
                  <span>最近加入的 {workspace.recentCustomers.length} 位客户</span>
                  <button type="button" className="dashboard-text-action" onClick={() => openCustomers({}, 'createdAt')}>按加入时间查看全部 <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
                </div>
              </>
            ) : (
              <ListEmpty icon={Users} title="从第一位客户开始" description="在客户管理导入或新建客户，再安排跟进和发送开发信。">
                <Button size="sm" onClick={() => openCustomers()}>去客户管理</Button>
              </ListEmpty>
            )}
          </TabsContent>
          <TabsContent value="followups" className="mt-0">
            {workspace.overdueCustomers.length || workspace.todayFollowUpCustomers.length ? (
              <>
                {workspace.overdueCustomers.length ? (
                  <div>
                    <h3 className="pt-4 text-xs font-medium text-destructive">优先处理 · 已逾期 {workspace.followUpOverdue} 位</h3>
                    <ul aria-label="逾期客户">{workspace.overdueCustomers.map(item => <CustomerRow key={item.id} customer={item} overdue />)}</ul>
                  </div>
                ) : null}
                {workspace.todayFollowUpCustomers.length ? (
                  <div>
                    <h3 className="pt-4 text-xs font-medium text-muted-foreground">今天跟进 · {workspace.followUpToday} 位</h3>
                    <ul aria-label="今日待跟进客户">{workspace.todayFollowUpCustomers.map(item => <CustomerRow key={item.id} customer={item} />)}</ul>
                  </div>
                ) : null}
              </>
            ) : <ListEmpty icon={CalendarCheck2} title="今天没有到期跟进" description="可以查看未来的跟进安排，或从最近客户中选择下一位开发对象。" />}
            <div className="dashboard-list-footer flex-wrap">
              <button type="button" className="dashboard-text-action" onClick={() => openCustomers({ followUp: 'today' })}>查看今日跟进 <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
              <button type="button" className="dashboard-text-action" onClick={() => openCustomers({ followUp: 'overdue' })}>查看全部逾期 <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
          </TabsContent>
          <TabsContent value="activity" className="mt-0">
            {workspace.recentFollowUps.length
              ? <ul aria-label="最近跟进动态">{workspace.recentFollowUps.map(item => <RecentFollowUpRow key={item.id} item={item} />)}</ul>
              : <ListEmpty icon={MessageSquare} title="还没有跟进记录" description="进入客户详情记录沟通结果，最近的跟进会汇总在这里。" />}
          </TabsContent>
          <TabsContent value="letters" className="mt-0">
            {stats.recentLetters.length
              ? <ul aria-label="最近开发信">{stats.recentLetters.map(item => <RecentLetterRow key={item.id} letter={item} />)}</ul>
              : <ListEmpty icon={Inbox} title="还没有开发信记录" description="从客户详情撰写开发信，审核后手动发送。" />}
            <div className="dashboard-list-footer"><span>最新 {stats.recentLetters.length} 条记录</span>
              <button type="button" className="dashboard-text-action" onClick={() => openLetters()}>全部开发信 <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <aside aria-labelledby="dashboard-reminders-title" className="dashboard-reminders">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="dashboard-reminders-title" className="section-title">工作提醒</h2>
            <p className="mt-1 text-xs text-muted-foreground">从这里继续处理未完成的事项</p>
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden>
            <CalendarCheck2 className="h-4 w-4" />
          </span>
        </div>
        <ul className="mt-3 space-y-0.5">
          {[
            { key: 'overdue' as const, label: '逾期跟进', value: workspace.followUpOverdue, urgent: true, action: () => openCustomers({ followUp: 'overdue' }) },
            { key: 'upcoming' as const, label: '未来跟进', value: workspace.followUpUpcoming, action: () => openCustomers({ followUp: 'upcoming' }) },
            { key: 'draft' as const, label: '待发送草稿', value: letter.draft, action: () => openLetters('draft') },
            { key: 'failed' as const, label: '发送失败', value: letter.failed, urgent: true, action: () => openLetters('failed') },
            { key: 'email' as const, label: '客户缺少邮箱', value: customer.withoutEmail, action: () => openCustomers({ hasEmail: 'no' }) },
          ].map(item => {
            const Icon = REMINDER_ICONS[item.key];
            return (
              <li key={item.label}>
                <button type="button" onClick={item.action} className="group flex min-h-12 w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-muted-foreground" aria-hidden>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/80 group-hover:text-foreground">{item.label}</span>
                  <span className={cn('font-semibold tabular-nums', item.urgent && item.value > 0 ? 'chip chip-rose px-2 py-0.5 text-[11px]' : 'text-foreground')}>{item.value}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 rounded-xl bg-surface p-3.5">
          <h3 className="text-xs font-medium text-muted-foreground">今日进度</h3>
          <dl className="mt-2.5 grid grid-cols-2 gap-3">
            <div><dt className="text-2xs text-muted-foreground">已发送开发信</dt><dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{workspace.lettersSentToday}<span className="ml-1 text-xs font-normal text-muted-foreground">封</span></dd></div>
            <div><dt className="text-2xs text-muted-foreground">新增客户</dt><dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{workspace.newCustomersToday}<span className="ml-1 text-xs font-normal text-muted-foreground">位</span></dd></div>
          </dl>
        </div>
      </aside>
    </section>
  );
}
