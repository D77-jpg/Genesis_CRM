import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiGet, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AgentActionDetail as ActionDetail, AgentRecordedWorkflow } from '@/types';

const executionLabels = { pending: '处理中', succeeded: '成功', failed: '失败', rejected: '已取消' };
const approvalLabels = { not_required: '无需审批', pending: '等待确认', approved: '用户已确认', rejected: '用户已取消' };
const inputLabels: Record<string, string> = { customerId: '客户', mailId: '邮件', direction: '邮件方向', sourceCount: '来源数', messageCount: '邮件数', fields: '编辑字段', status: '客户状态', previewId: '客户预览', analysisId: '分析', inputTruncated: '输入已截取' };

export function AgentActionDetail({ actionId, label, onClose, onOpenWorkflow }: {
  actionId: string | null; label: string; onClose: () => void; onOpenWorkflow: (workflow: AgentRecordedWorkflow) => void;
}): React.JSX.Element {
  const [detail, setDetail] = React.useState<ActionDetail | null>(null);
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    setDetail(null);
    setError('');
    if (!actionId) return;
    let cancelled = false;
    void apiGet<ActionDetail>(`/agent/actions/${actionId}`)
      .then((value) => { if (!cancelled) setDetail(value); })
      .catch((reason) => { if (!cancelled) setError(toErrorMessage(reason, '记录详情加载失败')); });
    return () => { cancelled = true; };
  }, [actionId, attempt]);

  return <Dialog open={Boolean(actionId)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>运行记录详情</DialogTitle><DialogDescription>{label} · 查看已发生的操作与保存结果</DialogDescription></DialogHeader>
      <DialogBody>
        {!detail && !error && <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在加载记录…</p>}
        {error && <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>重试加载</Button></div>}
        {detail && <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2"><Badge variant={detail.executionStatus === 'failed' ? 'failed' : detail.executionStatus === 'succeeded' ? 'developed' : 'muted'}>{executionLabels[detail.executionStatus]}</Badge><Badge variant="outline">{detail.riskLevel === 'read' ? '只读操作' : '写入操作'}</Badge><Badge variant="muted">{approvalLabels[detail.approvalStatus]}</Badge></div>
          <section className="rounded-lg border bg-muted/30 p-3"><h3 className="mb-2 font-medium">执行结果</h3><p className="whitespace-pre-wrap break-words leading-relaxed">{detail.resultSummary || '此记录未保存结果摘要。'}</p></section>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div><dt className="text-xs text-muted-foreground">开始时间</dt><dd className="mt-1">{formatDateTime(detail.createdAt)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">完成时间</dt><dd className="mt-1">{detail.executedAt ? formatDateTime(detail.executedAt) : '未记录'}</dd></div>
            {detail.approvedAt && <div><dt className="text-xs text-muted-foreground">确认时间</dt><dd className="mt-1">{formatDateTime(detail.approvedAt)}</dd></div>}
            {detail.run && <><div><dt className="text-xs text-muted-foreground">模型</dt><dd className="mt-1 break-words">{detail.run.model}</dd></div><div><dt className="text-xs text-muted-foreground">运行耗时</dt><dd className="mt-1">{(detail.run.durationMs / 1000).toFixed(2)} 秒</dd></div><div><dt className="text-xs text-muted-foreground">输入 / 输出 Token</dt><dd className="mt-1 tabular-nums">{detail.run.inputTokens.toLocaleString()} / {detail.run.outputTokens.toLocaleString()}</dd></div></>}
          </dl>
          {detail.run?.errorCode && <p className="rounded-lg border border-destructive/30 p-3 text-destructive">失败原因：{detail.run.errorCode}</p>}
          {Object.keys(detail.inputs).length > 0 && <section><h3 className="mb-2 font-medium">操作对象与范围</h3><dl className="space-y-2 rounded-lg border p-3">{Object.entries(detail.inputs).map(([key, value]) => <div key={key} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">{inputLabels[key] || key}</dt><dd className="break-all">{Array.isArray(value) ? value.join('、') : typeof value === 'boolean' ? value ? '是' : '否' : value === 'inbound' ? '收件' : value === 'outbound' ? '发件' : String(value)}</dd></div>)}</dl></section>}
          {!detail.run && <p className="text-xs text-muted-foreground">此记录未关联模型运行数据。</p>}
          {!detail.workflow && <p className="text-xs text-muted-foreground">{detail.hasWorkflow ? '关联结果已不存在或当前无权访问。' : '此记录仅保存执行摘要，未保存完整查询结果。'}</p>}
        </div>}
      </DialogBody>
      <DialogFooter><Button variant="outline" onClick={onClose}>关闭详情</Button>{detail?.workflow && <Button onClick={() => onOpenWorkflow(detail.workflow!)}>{detail.workflow.kind === 'customer-preview' ? '查看客户预览' : '查看分析结果'}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
