import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  MailCheck,
  Pause,
  Play,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { usePageTitle } from '@/hooks/use-ui';
import { selectIsAdmin, useAuthStore } from '@/store/auth.store';
import { useProjectStore } from '@/store/project.store';
import type {
  OutreachAutomationConfig,
  OutreachAutomationOverview,
  OutreachAutomationQueueRow,
  OutreachAutomationStartResult,
  UserDto,
} from '@/types';

const TIMEZONES = [
  ['Asia/Shanghai', '中国标准时间（UTC+8）'],
  ['Asia/Hong_Kong', '香港时间（UTC+8）'],
  ['Asia/Tokyo', '日本时间（UTC+9）'],
  ['Europe/London', '伦敦时间'],
  ['America/New_York', '纽约时间'],
  ['America/Los_Angeles', '洛杉矶时间'],
] as const;

const QUEUE_STATUS: Record<OutreachAutomationQueueRow['status'], { label: string; variant: 'outline' | 'warning' | 'failed' | 'muted' }> = {
  active: { label: '自动进行中', variant: 'outline' },
  paused: { label: '已暂停', variant: 'warning' },
  blocked: { label: '已停止', variant: 'failed' },
  completed: { label: '三封已完成', variant: 'muted' },
  failed: { label: '需要处理', variant: 'failed' },
};

function formatWindow(config: OutreachAutomationConfig): string {
  return `${config.windowStart}–${config.windowEnd}`;
}

function queueNextLabel(row: OutreachAutomationQueueRow): string {
  if (row.status === 'completed') return '已完成';
  if (row.status === 'blocked') return '已停止';
  if (row.status === 'failed') return '等待处理';
  if (row.status === 'paused') return '等待恢复';
  return formatRelative(row.nextRunAt);
}

export function OutreachAutomationPage(): React.JSX.Element {
  usePageTitle('自动开发');
  const isAdmin = useAuthStore(selectIsAdmin);
  const currentUserId = useAuthStore((state) => state.user?.id ?? '');
  const activeProjectId = useProjectStore((state) => state.activeProject?.id ?? '');
  const [owners, setOwners] = React.useState<UserDto[]>([]);
  const [ownerId, setOwnerId] = React.useState('');
  const [overview, setOverview] = React.useState<OutreachAutomationOverview | null>(null);
  const [form, setForm] = React.useState<OutreachAutomationConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState('');
  const dirtyRef = React.useRef(false);

  const query = ownerId ? `?userId=${encodeURIComponent(ownerId)}` : '';
  const scoped = React.useCallback((path: string) => `${path}${query}`, [query]);

  React.useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void apiGet<UserDto[]>('/users').then((users) => {
      if (!active) return;
      const activeUsers = users.filter((user) => user.status === 'active'
        && (user.role === 'admin' || !activeProjectId || user.projectIds.includes(activeProjectId)));
      setOwners(activeUsers);
      setOwnerId((current) => (
        activeUsers.some((user) => user.id === current)
          ? current
          : activeUsers.find((user) => user.role !== 'admin')?.id
            || activeUsers.find((user) => user.id === currentUserId)?.id
            || ''
      ));
    }).catch((caught) => {
      if (active) setError(toErrorMessage(caught, '业务员列表加载失败'));
    });
    return () => { active = false; };
  }, [activeProjectId, currentUserId, isAdmin]);

  const load = React.useCallback(async (quiet = false) => {
    try {
      const next = await apiGet<OutreachAutomationOverview>(`/outreach-automation${query}`);
      setOverview(next);
      if (!dirtyRef.current) setForm(next.config);
      setError('');
    } catch (caught) {
      if (!quiet) setError(toErrorMessage(caught, '自动开发状态加载失败'));
    } finally {
      setLoading(false);
    }
  }, [query]);

  React.useEffect(() => {
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  React.useEffect(() => {
    dirtyRef.current = false;
    setDirty(false);
    setForm(null);
    setOverview(null);
  }, [ownerId]);

  const patch = (value: Partial<OutreachAutomationConfig>): void => {
    setForm((current) => current ? { ...current, ...value } : current);
    dirtyRef.current = true;
    setDirty(true);
  };

  const save = async (): Promise<void> => {
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const next = await apiPut<OutreachAutomationOverview>(scoped('/outreach-automation'), {
        expectedVersion: form.version,
        dailyLimit: form.dailyLimit,
        perDomainLimit: form.perDomainLimit,
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
        timezone: form.timezone,
      });
      setOverview(next);
      setForm(next.config);
      dirtyRef.current = false;
      setDirty(false);
      toast.success('自动开发设置已保存');
    } catch (caught) {
      setError(toErrorMessage(caught, '自动开发设置保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const start = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<OutreachAutomationStartResult>(scoped('/outreach-automation/start'), {});
      setOverview(result.overview);
      setForm(result.overview.config);
      setStartConfirmOpen(false);
      dirtyRef.current = false;
      setDirty(false);
      toast.success(`已加入 ${result.enrolled} 位客户`, {
        description: '自动开发已开启；第 1 封生成后会直接发送，并在 3/7/14 天节奏内继续。',
      });
    } catch (caught) {
      setError(toErrorMessage(caught, '自动开发操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (): Promise<void> => {
    if (!overview) return;
    if (!overview.config.enabled) {
      setStartConfirmOpen(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await apiPost<OutreachAutomationOverview>(scoped('/outreach-automation/pause'), {});
      setOverview(next);
      setForm(next.config);
      dirtyRef.current = false;
      setDirty(false);
      toast.info('自动开发已暂停', { description: '不会再创建新的自动发送任务。' });
    } catch (caught) {
      setError(toErrorMessage(caught, '自动开发操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const enrollMore = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<OutreachAutomationStartResult>(scoped('/outreach-automation/start'), {});
      setOverview(result.overview);
      setForm(result.overview.config);
      toast.success(`已加入 ${result.enrolled} 位客户`);
    } catch (caught) {
      setError(toErrorMessage(caught, '加入客户失败'));
    } finally {
      setBusy(false);
    }
  };

  const controlRow = async (row: OutreachAutomationQueueRow): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const action = row.status === 'paused' || row.status === 'failed' ? 'resume' : 'pause';
      const next = await apiPost<OutreachAutomationOverview>(scoped(`/outreach-automation/enrollments/${row.id}/${action}`), {});
      setOverview(next);
      setForm(next.config);
      toast.success(action === 'pause' ? '已暂停该客户' : '已恢复该客户');
    } catch (caught) {
      setError(toErrorMessage(caught, '客户自动开发操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const mailbox = overview?.mailbox;
  const canStart = Boolean(mailbox?.canSend) && Boolean(overview?.stats.eligible || overview?.stats.enrolled);
  const issueCount = (overview?.stats.paused ?? 0) + (overview?.stats.failed ?? 0) + (overview?.stats.blocked ?? 0);

  return (
    <div className="workspace-page">
      <PageHeader
        title="自动开发"
        description="用你自己的已验证邮箱，按 3/7/14 天节奏自动完成三封开发信；回复、退订、退信后立即停止。"
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busy || loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              刷新
            </Button>
            <Button type="button" size="sm" onClick={() => void toggle()} disabled={busy || loading || (!overview?.config.enabled && !canStart)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : overview?.config.enabled ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {overview?.config.enabled ? '暂停自动开发' : '开始自动开发'}
            </Button>
          </div>
        }
      />

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {loading && !overview ? (
        <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          正在读取自动开发状态…
        </p>
      ) : null}

      {overview ? (
        <>
          <section className="rounded-lg border bg-card p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${overview.config.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                  {overview.config.enabled ? <Bot className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {overview.config.enabled ? '自动开发运行中' : '自动开发未运行'}
                    <Badge variant={overview.config.enabled ? 'developed' : 'outline'}>
                      {overview.config.enabled ? '自动发送' : '已停止'}
                    </Badge>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {overview.config.enabled
                      ? `工作日 ${formatWindow(overview.config)} · 每天最多 ${overview.config.dailyLimit} 封 · 每域名 ${overview.config.perDomainLimit} 封`
                      : overview.config.pausedReason || '开启后会从符合条件的客户开始，第 1、2、3 封自动发送。'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MailCheck className="h-3.5 w-3.5" aria-hidden />
                  {mailbox?.email || '未配置发件邮箱'}
                </span>
                <Badge variant={mailbox?.canSend ? 'developed' : 'failed'}>
                  {mailbox?.canSend ? '邮箱已验证' : '邮箱未就绪'}
                </Badge>
              </div>
            </div>
            {!mailbox?.canSend ? (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50/70 p-2.5 text-xs leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {mailbox?.reason || '还没有可用的个人发件邮箱，自动开发不会发送任何邮件。'}{' '}
                {isAdmin
                  ? <Link to="/users" className="font-medium underline underline-offset-2">去用户管理配置</Link>
                  : <span className="font-medium">请联系管理员配置并发件邮箱。</span>}
              </p>
            ) : null}
            {overview.config.enabled && overview.stats.remainingToday === 0 ? (
              <p className="mt-3 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                今天这个邮箱的 {overview.config.dailyLimit} 封额度已用完，明天发送时段会继续。
              </p>
            ) : null}
          </section>

          <section aria-label="自动开发指标" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: '可加入客户', value: overview.stats.eligible, hint: '待开发，或已有开发信记录', icon: Users },
              { label: '进行中', value: overview.stats.active, hint: `队列共 ${overview.stats.enrolled} 位`, icon: Bot },
              { label: '今日已发', value: `${overview.stats.sentToday}/${overview.config.dailyLimit}`, hint: `剩余 ${overview.stats.remainingToday} 封`, icon: Send },
              { label: '需要处理', value: issueCount, hint: '暂停、失败或已停止', icon: ShieldCheck },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border bg-card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <item.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums">{item.value}</p>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{item.hint}</p>
              </div>
            ))}
          </section>

          <div className="grid gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                  发送设置
                </CardTitle>
                <CardDescription className="text-xs leading-5">保存后自动生效；修改不会重置队列。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isAdmin ? (
                  <div className="space-y-1.5 border-b pb-3">
                    <Label htmlFor="auto-owner">执行账号</Label>
                    <Select value={ownerId} onValueChange={setOwnerId} disabled={busy || owners.length === 0}>
                      <SelectTrigger id="auto-owner"><SelectValue placeholder="选择业务员" /></SelectTrigger>
                      <SelectContent>
                        {owners.map((owner) => (
                          <SelectItem key={owner.id} value={owner.id}>
                            {owner.displayName || owner.username}{owner.role === 'admin' ? '（管理员）' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] leading-5 text-muted-foreground">使用该业务员自己的已验证邮箱发送，20 封/天按邮箱独立计算。</p>
                  </div>
                ) : null}
                {form ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="auto-daily-limit">每天最多</Label>
                        <Input id="auto-daily-limit" type="number" min={1} max={20} value={form.dailyLimit} onChange={(e) => patch({ dailyLimit: Number(e.target.value) })} />
                        <p className="text-[11px] text-muted-foreground">封 / 邮箱，最多 20 封</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="auto-domain-limit">每域名</Label>
                        <Input id="auto-domain-limit" type="number" min={1} max={10} value={form.perDomainLimit} onChange={(e) => patch({ perDomainLimit: Number(e.target.value) })} />
                        <p className="text-[11px] text-muted-foreground">封 / 24 小时</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>发送时段</Label>
                      <div className="flex items-center gap-2">
                        <Input type="time" aria-label="发送开始时间" value={form.windowStart} onChange={(e) => patch({ windowStart: e.target.value })} />
                        <span className="text-xs text-muted-foreground">至</span>
                        <Input type="time" aria-label="发送结束时间" value={form.windowEnd} onChange={(e) => patch({ windowEnd: e.target.value })} />
                      </div>
                      <p className="text-[11px] text-muted-foreground">仅工作日发送；时区见下方。</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="auto-timezone">发送时区</Label>
                      <Select value={form.timezone} onValueChange={(value) => patch({ timezone: value })}>
                        <SelectTrigger id="auto-timezone"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIMEZONES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" className="w-full" disabled={!dirty || busy} onClick={() => void save()}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                      保存设置
                    </Button>
                  </>
                ) : null}
                <div className="border-t pt-3">
                  <p className="text-xs font-medium">节奏</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">第 1 封发出后第 3 天发第 2 封，第 7 天发第 3 封；第 3 封后 14 天无回复自动停止。</p>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="flex-row items-start justify-between gap-3 pb-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden />
                    自动开发队列
                  </CardTitle>
                  <CardDescription className="text-xs leading-5">每 5 秒刷新；只显示当前账号负责的客户。</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={busy || !overview.config.enabled || overview.stats.eligible === 0} onClick={() => void enrollMore()}>
                  <Users className="h-4 w-4" aria-hidden />
                  加入符合条件客户
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {overview.queue.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <Bot className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden />
                    <p className="mt-2 text-sm font-medium">还没有自动开发客户</p>
                    <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                      {canStart ? '点击右上角「开始自动开发」，系统会从符合条件的客户开始准备并发送下一封。' : '先配置并验证个人发件邮箱，再开始自动开发。'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table aria-label="自动开发队列">
                      <TableHeader>
                        <TableRow>
                          <TableHead>客户</TableHead>
                          <TableHead>进度</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>下一动作</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overview.queue.map((row) => {
                          const status = QUEUE_STATUS[row.status];
                          const controllable = row.status === 'active' || row.status === 'paused' || row.status === 'failed';
                          return (
                            <TableRow key={row.id}>
                              <TableCell>
                                <Link to={`/customers/${row.customerId}`} className="block max-w-[15rem] truncate text-sm font-medium hover:text-primary hover:underline">
                                  {row.customerName}
                                </Link>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.company || row.email || '—'}</p>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {row.currentStep > 0 ? `已发 ${row.currentStep} 封` : '准备第 1 封'}
                              </TableCell>
                              <TableCell>
                                <Badge variant={status.variant}>{status.label}</Badge>
                                {row.lastError ? <p className="mt-1 max-w-[14rem] text-[11px] leading-4 text-destructive">{row.lastError}</p> : null}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {queueNextLabel(row)}
                                {row.status === 'active' ? <span className="mt-1 block text-[11px] text-muted-foreground/80">{formatDateTime(row.nextRunAt)}</span> : null}
                              </TableCell>
                              <TableCell className="text-right">
                                {controllable ? (
                                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={busy} onClick={() => void controlRow(row)}>
                                    {row.status === 'active' ? '暂停' : '恢复'}
                                  </Button>
                                ) : <span className="text-xs text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {overview.recent.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Send className="h-4 w-4 text-muted-foreground" aria-hidden />
                  最近自动发送
                </CardTitle>
                <CardDescription className="text-xs">只统计通过自动开发发出的邮件。</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {overview.recent.map((row) => (
                    <li key={row.letterId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <span className="min-w-0 truncate font-medium">{row.customerName}</span>
                      <span className="text-xs text-muted-foreground">第 {row.step || '—'} 封 · {formatRelative(row.sentAt)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={startConfirmOpen}
        onOpenChange={(open) => { if (!busy) setStartConfirmOpen(open); }}
        title="开始自动开发？"
        description={`将把 ${overview?.stats.eligible ?? 0} 位符合条件的客户加入自动开发队列。`}
        confirmText="开始自动开发"
        loading={busy}
        onConfirm={start}
      >
        <div className="space-y-2 leading-5">
          <p>开启后，第 1、2、3 封草稿生成后会直接通过 {overview?.mailbox?.email || '业务员邮箱'} 发送，不再逐封人工审核。</p>
          <p>系统会在工作日 {overview ? formatWindow(overview.config) : '09:30–17:30'} 发送，每天最多 {overview?.config.dailyLimit ?? 20} 封；客户回复、退订、退信或明确拒绝后会立即停止。</p>
          <p className="font-medium">请确认这个业务员的客户名单和邮箱已经核对无误。</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
