import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, ChevronRight, Inbox, Mail, MessageSquare, Users } from 'lucide-react';
import { CustomerStatusBadge, LetterStatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { formatDate, formatRelative, initials } from '@/lib/format';
import { customerDetailPath, FOLLOW_UP_METHOD_LABEL, FOLLOW_UP_RESULT_LABEL, ROUTES } from '@/constants';
import { useDashboardNavigation } from './dashboard-navigation';
import type { CustomerBrief, DevelopmentLetter, OverviewStats, RecentFollowUpItem } from '@/types';

function CustomerRow({ customer, overdue, recent = false }: {
  customer: CustomerBrief; overdue?: boolean; recent?: boolean;
}): React.JSX.Element {
  const subtitle = customer.company && customer.company !== customer.name
    ? customer.company : customer.grade ? `${customer.grade} 级客户` : '客户档案';
  const dateLabel = recent ? formatRelative(customer.createdAt) : overdue
    ? `已逾期 · ${formatDate(customer.nextFollowUpAt)}` : '今天跟进';
  return (
    <li>
      <Link to={customerDetailPath(customer.id)} className="dashboard-customer-row group">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden>
            {initials(customer.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium group-hover:text-primary">{customer.name}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
            <span className={cn("mt-0.5 block text-xs text-muted-foreground sm:hidden", overdue && "text-destructive")}>{dateLabel}</span>
          </span>
        </span>
        <span className="dashboard-customer-status"><CustomerStatusBadge status={customer.status} /></span>
        <span className={cn('dashboard-customer-date text-xs text-muted-foreground', overdue && 'font-medium text-destructive')}>
          {dateLabel}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
      </Link>
    </li>
  );
}

function RecentFollowUpRow({ item }: { item: RecentFollowUpItem }): React.JSX.Element {
  return (
    <li>
      <Link to={customerDetailPath(item.customerId)} className="group block border-b border-border/60 py-4 last:border-0 hover:bg-muted/30">
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
        className="group flex items-start gap-3 py-4 hover:bg-muted/30">
        <Mail className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
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
      <Icon className="mb-3 h-7 w-7 text-muted-foreground/70" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

const tabClass = 'min-h-11 rounded-none border-b-2 border-transparent bg-transparent px-1.5 py-3 text-xs shadow-none sm:px-2 sm:text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none';

export function SalesWorkspaceSection({ stats }: { stats: OverviewStats }): React.JSX.Element {
  const { workspace, customer, letter } = stats;
  const { openCustomers, openLetters } = useDashboardNavigation();
  const dueCount = workspace.followUpToday + workspace.followUpOverdue;

  return (
    <section aria-labelledby="customer-worklist-title" className="dashboard-workbench">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="customer-worklist-title" className="text-base font-semibold tracking-tight">客户工作清单</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {dueCount > 0 ? `今天待跟进 ${workspace.followUpToday} 位，另有 ${workspace.followUpOverdue} 位已逾期。`
                : customer.pending > 0 ? '今天没有到期跟进，从最近加入的客户开始开发。' : '今天没有到期跟进，可查看最近客户和沟通动态。'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => openCustomers()} className="hidden text-muted-foreground sm:inline-flex">
            全部客户 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>

        <Tabs defaultValue={dueCount > 0 ? 'followups' : 'customers'} className="mt-4">
          <TabsList aria-label="客户工作清单" className="w-full justify-start gap-2 rounded-none border-b bg-transparent p-0 sm:gap-4">
            <TabsTrigger value="followups" className={tabClass}>待跟进{dueCount > 0 ? ` ${dueCount}` : ''}</TabsTrigger>
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
        <h2 id="dashboard-reminders-title" className="text-sm font-semibold">工作提醒</h2>
        <p className="mt-1 text-xs text-muted-foreground">从这里继续处理未完成的事项</p>
        <ul className="mt-4 divide-y divide-border/60">
          {[
            { label: '逾期跟进', value: workspace.followUpOverdue, urgent: true, action: () => openCustomers({ followUp: 'overdue' }) },
            { label: '未来跟进', value: workspace.followUpUpcoming, action: () => openCustomers({ followUp: 'upcoming' }) },
            { label: '待发送草稿', value: letter.draft, action: () => openLetters('draft') },
            { label: '发送失败', value: letter.failed, urgent: true, action: () => openLetters('failed') },
            { label: '客户缺少邮箱', value: customer.withoutEmail, action: () => openCustomers({ hasEmail: 'no' }) },
          ].map(item => (
            <li key={item.label}>
              <button type="button" onClick={item.action} className="flex min-h-12 w-full items-center gap-3 py-2 text-left text-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex-1">{item.label}</span>
                <span className={cn('font-semibold tabular-nums', item.urgent && item.value > 0 && 'text-destructive')}>{item.value}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">今日进度</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div><dt className="text-xs text-muted-foreground">已发送开发信</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{workspace.lettersSentToday}<span className="ml-1 text-xs font-normal text-muted-foreground">封</span></dd></div>
            <div><dt className="text-xs text-muted-foreground">新增客户</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{workspace.newCustomersToday}<span className="ml-1 text-xs font-normal text-muted-foreground">位</span></dd></div>
          </dl>
        </div>
      </aside>
    </section>
  );
}
