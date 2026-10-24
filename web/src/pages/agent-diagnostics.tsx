import * as React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Coins, Play, RefreshCw, ShieldCheck, Timer, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/separator';
import { usePageTitle } from '@/hooks/use-ui';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import {agentFailureLabel,agentRunLabel} from '@/lib/agent-display';
import { formatDateTime } from '@/lib/format';
import type { AgentDiagnostics, AgentEvalRun } from '@/types';

const percent = (value: number): string => `${Math.round(value * 100)}%`;
const tokens = (value: number): string => new Intl.NumberFormat('zh-CN').format(value);
const money = (value: number): string => `$${value.toFixed(value >= 1 ? 2 : 4)}`;

function EvaluationCard({ evaluation }: { evaluation: AgentEvalRun }): React.JSX.Element {
  const passed = evaluation.status === 'completed' && evaluation.passedCases === evaluation.totalCases;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>自检</CardTitle>
          <CardDescription>{formatDateTime(evaluation.createdAt)} · {/mock/i.test(evaluation.model) ? '演示模型' : evaluation.model}</CardDescription>
        </div>
        <Badge variant={passed ? 'developed' : evaluation.status === 'failed' ? 'destructive' : 'secondary'}>
          {evaluation.status === 'failed' ? '没跑完' : `${evaluation.passedCases}/${evaluation.totalCases} 项通过`}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-3">
          {evaluation.cases.map((item) => (
            <div key={item.caseId} className="flex min-w-0 items-start gap-2 rounded-md border p-3">
              {item.passed
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-developed" aria-hidden />
                : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.details}</p>
              </div>
            </div>
          ))}
        </div>
        {evaluation.errorCode ? <p className="mt-3 text-xs text-destructive">{agentFailureLabel(evaluation.errorCode)}</p> : null}
      </CardContent>
    </Card>
  );
}

export function AgentDiagnosticsPage(): React.JSX.Element {
  usePageTitle('AI 使用情况');
  const [data, setData] = React.useState<AgentDiagnostics | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await apiGet<AgentDiagnostics>('/agent/admin/diagnostics?days=30')); }
    catch (reason) { setError(toErrorMessage(reason, 'AI 使用情况加载失败')); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  async function runEvaluation() {
    if (running) return;
    setRunning(true);
    try {
      // 固定集逐项运行以避免突发流量；真实 Provider 下允许覆盖全局 60 秒请求超时。
      const result = await apiPost<AgentEvalRun>('/agent/admin/evaluations/run', undefined, { timeout: 360_000 });
      toast.success(`自检完成：${result.passedCases}/${result.totalCases} 项通过`);
      await load();
    } catch (reason) { toast.error(toErrorMessage(reason, '自检没能跑完')); }
    finally { setRunning(false); }
  }

  if (loading && !data) return <div className="workspace-page"><PageHeader title="AI 使用情况" /><TableSkeleton rows={8} /></div>;
  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!data) return <></>;

  const latestEval = data.evaluations[0];
  return (
    <div className="workspace-page">
      <PageHeader
        title="AI 使用情况"
        description={`近 ${data.periodDays} 天 AI 助手的使用情况：谁用了多少、跑得顺不顺、有没有出错。`}
        actions={(
          <>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />刷新
            </Button>
            <Button onClick={() => void runEvaluation()} disabled={running}>
              {running ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              自检一下
            </Button>
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="AI 调用次数" value={tokens(data.totals.runs)} hint={`${data.totals.failed} 次没成功`} icon={<Activity className="h-4 w-4" aria-hidden />} tone="primary" />
        <StatCard label="用量（Token）" value={tokens(data.totals.totalTokens)} hint={`每人每天上限 ${tokens(data.limits.dailyTokensPerUser)}`} icon={<ShieldCheck className="h-4 w-4" aria-hidden />} />
        <StatCard label="估算花费" value={money(data.totals.estimatedCostUsd)} hint={data.pricing.configured ? '按设置的单价估算' : '还没设置单价'} icon={<Coins className="h-4 w-4" aria-hidden />} />
        <StatCard label="自检" value={latestEval ? percent(latestEval.score) : '还没跑过'} hint={`共 ${data.dataset.cases} 项检查`} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} tone={latestEval?.score === 1 ? 'developed' : 'pending'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>每个人用了多少</CardTitle>
          <CardDescription>额度按「每人每天」算，每天北京时间早上 8 点重置。</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>用户</TableHead><TableHead>使用情况</TableHead><TableHead>用量 · 花费</TableHead><TableHead>执行成功率</TableHead><TableHead>需要确认的操作</TableHead><TableHead>安全</TableHead><TableHead>今日已用</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.users.map((user) => (
                <TableRow key={user.userId}>
                  <TableCell><p className="font-medium">{user.displayName || user.username}</p><p className="text-xs text-muted-foreground">{user.role === 'admin' ? '管理员' : '业务员'} · {user.status === 'active' ? '启用' : '停用'}</p></TableCell>
                  <TableCell><p className="tabular-nums">{user.runs} 次 · {percent(user.successRate)}</p><p className="text-xs text-muted-foreground">平均每次 {(user.averageDurationMs / 1000).toFixed(1)} 秒</p></TableCell>
                  <TableCell><p className="tabular-nums">{tokens(user.totalTokens)}</p><p className="text-xs text-muted-foreground">{money(user.estimatedCostUsd)}</p></TableCell>
                  <TableCell><span className="tabular-nums">{user.toolCalls} 次 · {percent(user.toolSuccessRate)}</span></TableCell>
                  <TableCell><p>批准 {user.approvals.approved} · 拒绝 {user.approvals.rejected}</p><p className="text-xs text-muted-foreground">待审批 {user.approvals.pending} · 无需审批 {user.approvals.notRequired}</p></TableCell>
                  <TableCell><p>可疑指令 {user.injectionSignals}</p><p className="text-xs text-muted-foreground">超长资料 {user.truncatedRuns}</p></TableCell>
                  <TableCell><p>{user.today.requests}/{data.limits.dailyRunsPerUser} 次</p><p className="text-xs text-muted-foreground">{tokens(user.today.tokens + user.today.reservedTokens)} Token</p></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {data.evaluations.length ? data.evaluations.map((evaluation) => <EvaluationCard key={evaluation.id} evaluation={evaluation} />) : (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">还没跑过自检。</CardContent></Card>
          )}
        </div>
        <Card>
          <CardHeader><CardTitle>没做完或出错的</CardTitle><CardDescription>看看哪些处理没做完、卡在哪一步；这里不会显示客户邮件正文和密钥。</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {data.recentFailures.length ? data.recentFailures.map((failure) => (
              <div key={failure.id} className="flex items-start gap-2 rounded-md border p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-pending" aria-hidden />
                <div className="min-w-0"><p className="break-all text-sm font-medium">{agentFailureLabel(failure.errorCode)}</p><p className="text-xs text-muted-foreground">{agentRunLabel(failure.kind)} · {formatDateTime(failure.createdAt)}</p></div>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Timer className="h-3.5 w-3.5" aria-hidden />{failure.durationMs} ms</span>
              </div>
            )) : <p className="py-6 text-center text-sm text-muted-foreground">这段时间都跑得很顺，没有出错记录。</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
