/**
 * 线索批量补全
 * ------------------------------------------------------------------
 * Excel 导进来的线索常常只有公司名和官网，缺邮箱/电话。这个弹窗负责：
 *   1. 选范围（全部待补 / 只 A 级 / 只 B 级 / 只 C 级）
 *   2. 选方式（抓官网 / Hunter 找邮箱 / 搜索补官网）
 *   3. 后台跑，前端每 2 秒轮询进度，可随时停
 *
 * 任务在服务端继续跑，关掉弹窗不受影响；runId 存在 localStorage，
 * 再次打开会接着显示进度，不用重跑。
 */
import * as React from 'react';
import { toast } from 'sonner';
import { CircleStop, Globe2, Loader2, Mail, Search, Sparkles, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';

type Mode = 'site' | 'hunter' | 'discover';

interface Preview {
  /** 后台已有任务在跑时，直接接着看进度 */
  activeRun?: RunState;
  pending: number;
  withWebsite: number;
  withoutWebsite: number;
  hunterReady: number;
  estimate: { crawl: number; hunter: number; search: number };
}

interface RunState {
  id: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  modes: Mode[];
  total: number;
  done: number;
  siteFilled: number;
  hunterFilled: number;
  discovered: number;
  stillMissing: number;
  failed: number;
  failures: { name?: string; message: string }[];
  startedAt: string;
  endedAt?: string;
}

const RUN_KEY = 'cdlm.enrichRunId';

const MODE_OPTIONS: { value: Mode; label: string; hint: string; icon: typeof Globe2 }[] = [
  { value: 'site', label: '抓官网', hint: '访问官网首页 + 联系页，找邮箱、电话、社媒', icon: Globe2 },
  { value: 'hunter', label: 'Hunter 找邮箱', hint: '按域名查公开邮箱，准确率高但消耗查询额度', icon: Mail },
  { value: 'discover', label: '搜索补官网', hint: '连官网都没有的，用公司名 + 国家搜官网', icon: Search },
];

const SCOPE_OPTIONS = [
  { value: '', label: '全部待补全的线索' },
  { value: 'A', label: '只补 A 级' },
  { value: 'B', label: '只补 B 级' },
  { value: 'C', label: '只补 C 级' },
];

export interface EnrichDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 跑完（或有线索被补上）后刷新列表 */
  onCompleted?: () => void;
}

export function EnrichDialog({ open, onOpenChange, onCompleted }: EnrichDialogProps) {
  const [grade, setGrade] = React.useState('');
  const [modes, setModes] = React.useState<Mode[]>(['site', 'hunter', 'discover']);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [run, setRun] = React.useState<RunState | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState('');

  const running = run?.status === 'running';

  // 轮询进度；跑完就停
  React.useEffect(() => {
    if (!open || !run?.id || !running) return;
    let alive = true;
    const timer = window.setInterval(() => {
      apiGet<RunState>(`/prospecting/enrich/${run.id}`)
        .then((next) => {
          if (!alive) return;
          setRun(next);
          if (next.status !== 'running') {
            localStorage.removeItem(RUN_KEY);
            onCompleted?.();
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open, run?.id, running, onCompleted]);

  // 打开时：有未完成的任务就接着看，没有就拉一次预估
  React.useEffect(() => {
    if (!open) return;
    const stored = localStorage.getItem(RUN_KEY);
    if (stored) {
      apiGet<RunState>(`/prospecting/enrich/${stored}`)
        .then((current) => {
          setRun(current);
          if (current.status !== 'running') localStorage.removeItem(RUN_KEY);
        })
        .catch(() => localStorage.removeItem(RUN_KEY));
      return;
    }
    setRun(null);
  }, [open]);

  const loadPreview = React.useCallback(() => {
    setPreviewLoading(true);
    setError('');
    apiGet<Preview>(`/prospecting/enrich/preview${grade ? `?grade=${grade}` : ''}`)
      .then((next) => {
        setPreview(next);
        // 别处已经起了一个任务：不用重新点开始，直接显示进度
        if (next.activeRun) {
          localStorage.setItem(RUN_KEY, next.activeRun.id);
          setRun(next.activeRun);
        }
      })
      .catch((cause) => setError(toErrorMessage(cause, '读不到待补全数量')))
      .finally(() => setPreviewLoading(false));
  }, [grade]);

  React.useEffect(() => {
    if (open && !run) loadPreview();
  }, [open, run, loadPreview]);

  const toggleMode = (mode: Mode) => {
    setModes((current) =>
      current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode],
    );
  };

  const start = async () => {
    if (modes.length === 0) {
      toast.error('至少选择一种补全方式');
      return;
    }
    setStarting(true);
    setError('');
    try {
      const started = await apiPost<RunState>('/prospecting/enrich', {
        modes,
        scope: { grade },
      });
      localStorage.setItem(RUN_KEY, started.id);
      setRun(started);
      toast.success(`开始补全 ${started.total} 条线索`);
    } catch (cause) {
      setError(toErrorMessage(cause, '启动失败'));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!run) return;
    try {
      const next = await apiPost<RunState>(`/prospecting/enrich/${run.id}/cancel`, {});
      setRun(next);
      localStorage.removeItem(RUN_KEY);
      onCompleted?.();
      toast.message('已停止，已补上的内容会保留');
    } catch (cause) {
      toast.error(toErrorMessage(cause, '停止失败'));
    }
  };

  const close = () => onOpenChange(false);
  const percent = run && run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;
  const filled = (run?.siteFilled ?? 0) + (run?.hunterFilled ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量补全联系方式</DialogTitle>
          <DialogDescription>
            看官网、按域名找邮箱、搜到官网补齐；只补空白，不会覆盖你已经填好的内容。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {!run ? (
            <>
              <Alert>
                <TriangleAlert className="h-4 w-4" aria-hidden />
                <AlertTitle>会消耗查询额度</AlertTitle>
                <AlertDescription>
                  抓官网用 Firecrawl（每条最多 3 页），找邮箱用 Hunter，搜官网用 Serper。
                  第一次建议先选「只补 A 级」跑一小批看命中率，再跑全部。
                </AlertDescription>
              </Alert>

              <div className="grid gap-2">
                <Label htmlFor="enrich-scope">补全范围</Label>
                <Select value={grade || 'all'} onValueChange={(next) => setGrade(next === 'all' ? '' : next)}>
                  <SelectTrigger id="enrich-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value || 'all'} value={option.value || 'all'}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>补全方式</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {MODE_OPTIONS.map((option) => {
                    const active = modes.includes(option.value);
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleMode(option.value)}
                        className={[
                          'rounded-md border p-3 text-left transition-colors',
                          active
                            ? 'border-primary/60 bg-primary/5'
                            : 'border-border bg-muted/20 hover:border-border/80 hover:bg-muted/40',
                        ].join(' ')}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Icon className="h-4 w-4" aria-hidden />
                          {option.label}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {option.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                {previewLoading && !preview ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 统计待补全的线索…
                  </span>
                ) : preview ? (
                  <div className="space-y-1">
                    <p className="font-medium">这次会处理 {preview.pending} 条线索</p>
                    <p className="text-xs text-muted-foreground">
                      有官网可直接抓 {preview.withWebsite} 条 · 需要先搜官网 {preview.withoutWebsite} 条 · 能用 Hunter 查域名 {preview.hunterReady} 条
                    </p>
                    <p className="text-xs text-muted-foreground">
                      预估消耗：抓取 ≈ {preview.estimate.crawl} 次（有邮箱就提前停）· Hunter ≈ {preview.estimate.hunter} 次 · 搜索 ≈ {preview.estimate.search} 次
                    </p>
                  </div>
                ) : (
                  <span className="text-muted-foreground">{error || '没有需要补全的线索'}</span>
                )}
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {run.status === 'running' ? '正在补全…' : run.status === 'cancelled' ? '已停止' : '补全完成'}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {run.done}/{run.total}（{percent}%）
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="补到邮箱" value={filled} tone="good" />
                <Stat label="搜索补官网" value={run.discovered} tone="good" />
                <Stat label="仍缺邮箱" value={run.stillMissing} tone="muted" />
                <Stat label="跳过/失败" value={run.failed} tone={run.failed > 0 ? 'bad' : 'muted'} />
              </div>

              <p className="text-xs text-muted-foreground">
                关掉这个窗口也会继续跑；再点开「批量补全」就能接着看进度。
                补好的线索状态会从「待补联系方式」变成「可发送」。
              </p>

              {run.failures.length > 0 ? (
                <div className="max-h-32 overflow-auto rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                  {run.failures.slice(-8).map((item, index) => (
                    <p key={index} className="truncate">
                      {item.message}
                    </p>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {run ? (
            <>
              {running ? (
                <Button type="button" variant="outline" onClick={() => void stop()}>
                  <CircleStop className="h-4 w-4" aria-hidden />
                  停止
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    localStorage.removeItem(RUN_KEY);
                    setRun(null);
                    loadPreview();
                  }}
                >
                  再补一批
                </Button>
              )}
              <Button type="button" onClick={close}>
                {running ? '后台继续，先关闭' : '关闭'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close}>
                取消
              </Button>
              <Button
                type="button"
                loading={starting}
                disabled={!preview || preview.pending === 0 || modes.length === 0}
                onClick={() => void start()}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                开始补全{preview ? ` ${preview.pending} 条` : ''}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'good' | 'muted' | 'bad' }) {
  const color =
    tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
