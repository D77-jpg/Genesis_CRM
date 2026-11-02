import * as React from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePageTitle } from '@/hooks/use-ui';
import { apiDelete, apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

type ProviderKind = 'openai' | 'mock';

interface AiProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  keyConfigured: boolean;
  keySource: 'database' | 'environment' | 'none';
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestStatus: 'ok' | 'failed' | null;
  createdAt: string;
  updatedAt: string;
}

interface AiProviderCatalog {
  providers: AiProvider[];
  activeProviderId: string | null;
  fallback: {
    provider: ProviderKind;
    model: string;
    baseUrl: string;
    source: 'database' | 'environment';
    keySource: 'database' | 'environment' | 'none';
    keyConfigured: boolean;
    updatedAt: string | null;
  };
}

interface ProviderDraft {
  id?: string;
  name: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
}

type DraftField = 'name' | 'model' | 'baseUrl' | 'apiKey';

const emptyDraft: ProviderDraft = {
  name: '',
  kind: 'openai',
  model: '',
  baseUrl: '',
  apiKey: '',
};

const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
] as const;

function validateDraft(draft: ProviderDraft, editing: AiProvider | null): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  if (!draft.name.trim()) errors.name = '给这个服务起个容易辨认的名字。';
  if (draft.kind === 'mock') return errors;
  if (!draft.model.trim()) errors.model = '请填写服务商提供的模型名称。';
  if (!draft.baseUrl.trim()) {
    errors.baseUrl = '请填写接口地址。';
  } else {
    try {
      const url = new URL(draft.baseUrl.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        errors.baseUrl = '地址里不要带账号密码和 ? 后面的参数。';
      }
    } catch {
      errors.baseUrl = '请填写完整地址，例如 https://api.example.com/v1。';
    }
  }
  if (!draft.apiKey.trim() && !editing?.keyConfigured) errors.apiKey = '第一次接入真实 AI 要填密钥。';
  return errors;
}

function formatTime(value: string | null): string {
  if (!value) return '尚未测试';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function kindLabel(provider: AiProvider): string {
  return provider.kind === 'mock' ? '演示模式' : 'OpenAI 兼容';
}

const BRAND_MARKS = {
  deepseek: {
    color: '#4D6BFE',
    path: 'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45',
  },
  openai: {
    color: '#10A37F',
    path: 'M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z',
  },
  openrouter: {
    color: '#64748B',
    path: 'M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z',
  },
} as const;

type ProviderBrand = keyof typeof BRAND_MARKS;

function providerBrand(provider: AiProvider): ProviderBrand | null {
  const value = `${provider.name} ${provider.baseUrl}`.toLowerCase();
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('openrouter')) return 'openrouter';
  if (value.includes('openai')) return 'openai';
  return null;
}

function ProviderIcon({ provider, className }: { provider: AiProvider; className?: string }): React.JSX.Element {
  const brand = provider.kind === 'mock' ? null : providerBrand(provider);
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
        provider.isActive
          ? 'border-primary/25 bg-primary/[0.08]'
          : 'border-border bg-muted/40 text-muted-foreground',
        className,
      )}
    >
      {brand ? (
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          style={{ color: BRAND_MARKS[brand].color }}
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={BRAND_MARKS[brand].path} fillRule="evenodd" />
        </svg>
      ) : provider.kind === 'mock' ? (
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
      ) : (
        <Server className="h-4 w-4" aria-hidden />
      )}
    </span>
  );
}

function ProviderStatus({ provider }: { provider: AiProvider }): React.JSX.Element {
  if (provider.isActive) return <Badge variant="developed">当前使用</Badge>;
  if (provider.lastTestStatus === 'failed') return <Badge variant="failed">测试失败</Badge>;
  if (provider.lastTestStatus === 'ok') return <Badge variant="outline">测试通过</Badge>;
  return <Badge variant="secondary">已配置</Badge>;
}

function ProviderCard({
  provider,
  busy,
  onActivate,
  onEdit,
  onTest,
  onDelete,
}: {
  provider: AiProvider;
  busy: string | null;
  onActivate: (provider: AiProvider) => void;
  onEdit: (provider: AiProvider) => void;
  onTest: (provider: AiProvider) => void;
  onDelete: (provider: AiProvider) => void;
}): React.JSX.Element {
  const testing = busy === `test:${provider.id}`;
  const activating = busy === `activate:${provider.id}`;
  return (
    <Card
      className={cn(
        'overflow-hidden shadow-none transition-colors',
        provider.isActive && 'border-primary/25 bg-primary/[0.018]',
      )}
    >
      <CardContent className="p-4 sm:pt-4">
        <div className="flex items-start gap-3">
          <ProviderIcon provider={provider} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-[0.875rem] font-semibold tracking-[-0.01em]">{provider.name}</h3>
              <ProviderStatus provider={provider} />
              <span className="text-[11px] text-muted-foreground">{kindLabel(provider)}</span>
            </div>
            <div className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <div className="min-w-0">
                <span className="text-muted-foreground">模型</span>
                <p className="mt-0.5 truncate font-mono text-[11px] text-foreground">{provider.kind === 'mock' ? '不调用模型' : provider.model}</p>
              </div>
              <div className="min-w-0">
                <span className="text-muted-foreground">接口地址</span>
                <p className="mt-0.5 truncate font-mono text-[11px] text-foreground">{provider.kind === 'mock' ? '本地演示' : provider.baseUrl || '—'}</p>
              </div>
              <div className="min-w-0 sm:text-right">
                <span className="text-muted-foreground">密钥</span>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] sm:justify-end">
                  {provider.kind === 'mock' ? (
                    <span className="text-muted-foreground">无需密钥</span>
                  ) : provider.keyConfigured ? (
                    <><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />已安全保存</>
                  ) : (
                    <span className="text-muted-foreground">未配置</span>
                  )}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>上次测试：{formatTime(provider.lastTestedAt)}{provider.lastTestStatus === 'failed' ? ' · 失败' : ''}</span>
              {provider.isActive ? <span>所有项目当前共用这个服务</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {!provider.isActive ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="sm:hidden"
                  aria-label={`启用 ${provider.name}`}
                  title="设为当前"
                  onClick={() => onActivate(provider)}
                  disabled={Boolean(busy)}
                >
                  {activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() => onActivate(provider)}
                  disabled={Boolean(busy)}
                >
                  {activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
                  设为当前
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`测试 ${provider.name}`}
              title="测试连接"
              onClick={() => onTest(provider)}
              disabled={Boolean(busy)}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FlaskConical className="h-3.5 w-3.5" aria-hidden />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`编辑 ${provider.name}`}
              title="编辑"
              onClick={() => onEdit(provider)}
              disabled={Boolean(busy)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`删除 ${provider.name}`}
              title={provider.isActive ? '当前使用的服务不能删除' : '删除'}
              onClick={() => onDelete(provider)}
              disabled={Boolean(busy) || provider.isActive}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AiSettingsPage(): React.JSX.Element {
  usePageTitle('AI 配置');
  const [catalog, setCatalog] = React.useState<AiProviderCatalog | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AiProvider | null>(null);
  const [draft, setDraft] = React.useState<ProviderDraft>(emptyDraft);
  const [errors, setErrors] = React.useState<Partial<Record<DraftField, string>>>({});
  const [formError, setFormError] = React.useState('');
  const [tested, setTested] = React.useState<{ latencyMs: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AiProvider | null>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await apiGet<AiProviderCatalog>('/agent/admin/ai-providers');
      setCatalog(next);
    } catch (reason) {
      setLoadError(toErrorMessage(reason, 'AI 配置加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const activeProvider = catalog?.providers.find((provider) => provider.isActive) ?? null;
  const editingProvider = editing;

  function openCreate(kind: ProviderKind = 'openai'): void {
    setEditing(null);
    setDraft({ ...emptyDraft, kind });
    setErrors({});
    setFormError('');
    setTested(null);
    setEditorOpen(true);
  }

  function openEdit(provider: AiProvider): void {
    setEditing(provider);
    setDraft({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      model: provider.model,
      baseUrl: provider.baseUrl,
      apiKey: '',
    });
    setErrors({});
    setFormError('');
    setTested(null);
    setEditorOpen(true);
  }

  function change<K extends keyof ProviderDraft>(field: K, value: ProviderDraft[K]): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
    setTested(null);
  }

  function applyPreset(preset: typeof PRESETS[number]): void {
    setDraft((current) => ({
      ...current,
      kind: 'openai',
      name: current.name.trim() || preset.label,
      baseUrl: preset.baseUrl,
      model: preset.model,
    }));
    setErrors({});
    setFormError('');
    setTested(null);
  }

  function payload(): Record<string, string> {
    return {
      name: draft.name.trim(),
      kind: draft.kind,
      model: draft.model.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
    };
  }

  async function testDraft(): Promise<void> {
    if (busy) return;
    const nextErrors = validateDraft(draft, editingProvider);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setFormError('请先改好标红的地方。');
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setBusy('test');
    setFormError('');
    try {
      const result = await apiPost<{ ok: boolean; latencyMs: number }>(
        '/agent/admin/ai-providers/test',
        { ...payload(), ...(draft.id ? { id: draft.id } : {}) },
        { timeout: 30_000 },
      );
      setTested({ latencyMs: result.latencyMs });
      toast.success(draft.kind === 'mock' ? '演示模式可用' : `连接测试通过（${result.latencyMs} ms）`);
    } catch (reason) {
      setFormError(toErrorMessage(reason, '连接测试失败'));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft(): Promise<void> {
    if (busy) return;
    const nextErrors = validateDraft(draft, editingProvider);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setFormError('请先改好标红的地方。');
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setBusy('save');
    setFormError('');
    try {
      const body = payload();
      const saved = draft.id
        ? await apiPut<AiProvider>(`/agent/admin/ai-providers/${draft.id}`, body, { timeout: 30_000 })
        : await apiPost<AiProvider>('/agent/admin/ai-providers', body, { timeout: 30_000 });
      if (!draft.id && !activeProvider) {
        await apiPost(`/agent/admin/ai-providers/${saved.id}/activate`);
      }
      toast.success(draft.id ? 'AI 服务已更新' : 'AI 服务已添加');
      setEditorOpen(false);
      await load();
    } catch (reason) {
      setFormError(toErrorMessage(reason, '保存失败，原配置未更改'));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(null);
    }
  }

  async function activate(provider: AiProvider): Promise<void> {
    if (busy) return;
    setBusy(`activate:${provider.id}`);
    try {
      await apiPost(`/agent/admin/ai-providers/${provider.id}/activate`);
      toast.success(`已切换到 ${provider.name}`);
      await load();
    } catch (reason) {
      toast.error('切换失败', { description: toErrorMessage(reason, '请稍后重试') });
    } finally {
      setBusy(null);
    }
  }

  async function testProvider(provider: AiProvider): Promise<void> {
    if (busy) return;
    setBusy(`test:${provider.id}`);
    try {
      const result = await apiPost<{ latencyMs: number }>(`/agent/admin/ai-providers/${provider.id}/test`, undefined, { timeout: 30_000 });
      toast.success(`${provider.name} 连接正常`, { description: `响应耗时 ${result.latencyMs} ms` });
      await load();
    } catch (reason) {
      toast.error(`${provider.name} 连接失败`, { description: toErrorMessage(reason, '请检查密钥和接口地址') });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function removeProvider(): Promise<void> {
    if (!deleteTarget || busy) return;
    setBusy('delete');
    try {
      await apiDelete(`/agent/admin/ai-providers/${deleteTarget.id}`);
      toast.success('AI 服务已删除');
      setDeleteTarget(null);
      await load();
    } catch (reason) {
      toast.error('删除失败', { description: toErrorMessage(reason, '请稍后重试') });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !catalog) {
    return (
      <div className="workspace-page">
        <PageHeader title="AI 配置" description="管理系统中可用的 AI 服务商。" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />正在加载配置…</div>
      </div>
    );
  }
  if (loadError && !catalog) return <ErrorState description={loadError} onRetry={() => void load()} />;

  const providers = catalog?.providers ?? [];
  const activeFallback = !activeProvider && catalog?.fallback;
  const insecureHttp = draft.kind === 'openai' && draft.baseUrl.trim().toLowerCase().startsWith('http://');

  return (
    <div className="workspace-page max-w-[1060px]">
      <PageHeader
        title="AI 配置"
        description="配置多个 AI 服务商，并选择当前使用的一个。设置全局生效，所有项目共用。"
        actions={
          <Button type="button" onClick={() => openCreate()}>
            <Plus className="h-4 w-4" aria-hidden />
            添加服务商
          </Button>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden border-primary/20 bg-primary/[0.022] shadow-none">
            <CardContent className="p-4 sm:pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-start gap-3">
                  {activeProvider ? (
                    <ProviderIcon provider={activeProvider} className="h-10 w-10 rounded-lg border-primary/20 bg-card shadow-sm" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-card text-primary shadow-sm">
                      <Sparkles className="h-4 w-4" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">当前使用</span>
                      {activeProvider ? <Badge variant="developed">运行中</Badge> : <Badge variant="warning">系统默认</Badge>}
                    </div>
                    <h2 className="mt-0.5 truncate text-[0.9375rem] font-semibold tracking-[-0.015em]">
                      {activeProvider?.name ?? '尚未启用托管服务'}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {activeProvider
                        ? activeProvider.kind === 'mock'
                          ? '演示模式，不调用外部模型'
                          : `${activeProvider.model} · ${activeProvider.baseUrl || '接口地址未配置'}`
                        : `当前回退到${catalog?.fallback.source === 'environment' ? '环境变量' : '旧版单例配置'}${activeFallback ? ` · ${catalog.fallback.model}` : ''}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
                  {activeProvider ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {activeProvider.kind === 'mock' ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : activeProvider.keyConfigured ? <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> : <KeyRound className="h-3.5 w-3.5" aria-hidden />}
                      {activeProvider.kind === 'mock' ? '无需密钥' : activeProvider.keyConfigured ? '密钥已保存' : '未配置密钥'}
                    </span>
                  ) : null}
                  {activeProvider ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void testProvider(activeProvider)} disabled={Boolean(busy)}>
                      {busy === `test:${activeProvider.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
                      测试当前服务
                    </Button>
                  ) : (
                    <Button type="button" size="sm" onClick={() => openCreate()}>
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      添加服务商
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <section aria-labelledby="ai-provider-list-title">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 id="ai-provider-list-title" className="text-sm font-semibold tracking-[-0.01em]">服务商</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">同一时间只有一个服务商在运行。切换后立即影响所有 AI 功能。</p>
              </div>
              <Badge variant="secondary">{providers.length} 个</Badge>
            </div>
            {providers.length ? (
              <div className="space-y-2">
                {providers.map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    busy={busy}
                    onActivate={(item) => void activate(item)}
                    onEdit={openEdit}
                    onTest={(item) => void testProvider(item)}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            ) : (
              <Card className="border-dashed bg-card/40 shadow-none">
                <CardContent className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border bg-card text-muted-foreground"><Bot className="h-5 w-5" aria-hidden /></span>
                  <p className="text-sm font-medium">还没有配置服务商</p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">添加一个 OpenAI 兼容接口，或先使用演示模式熟悉流程。</p>
                  <Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => openCreate()}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    添加第一个服务
                  </Button>
                </CardContent>
              </Card>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4 text-primary" aria-hidden />运行规则</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs leading-relaxed text-muted-foreground">
              <p>系统所有 AI 功能共用当前服务，包括开发信、客户分析、邮件分析和翻译。</p>
              <p>只有管理员可以添加、编辑或切换服务。密钥保存后不再以明文展示。</p>
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />连接安全</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>接口地址会做内网与保留地址校验；生产环境只接受 HTTPS。</p>
              <p>测试连接只发送一条极短的 Ping 请求，不会发送客户资料，但可能产生少量费用。</p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!busy) setEditorOpen(open); }}>
        <DialogContent className="max-w-2xl">
          <form className="flex min-h-0 flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }} noValidate>
            <DialogHeader>
              <DialogTitle>{editingProvider ? '编辑 AI 服务' : '添加 AI 服务'}</DialogTitle>
              <DialogDescription>配置一个 OpenAI Responses 兼容的服务商连接。保存前会先验证连通性，避免切换后才发现配置不可用。</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              {formError ? (
                <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive">
                  {formError}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="provider-name">服务名称</Label>
                  <Input
                    id="provider-name"
                    value={draft.name}
                    onChange={(event) => change('name', event.target.value)}
                    placeholder="例如：DeepSeek 主力"
                    maxLength={60}
                    disabled={busy === 'save'}
                    invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? 'provider-name-error' : 'provider-name-hint'}
                  />
                  {errors.name ? <p id="provider-name-error" className="text-xs text-destructive">{errors.name}</p> : <p id="provider-name-hint" className="text-xs text-muted-foreground">用业务员能认出的名字，方便切换。</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>服务类型</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      type="button"
                      variant={draft.kind === 'openai' ? 'default' : 'outline'}
                      size="sm"
                      className="justify-center"
                      onClick={() => change('kind', 'openai')}
                      disabled={busy === 'save'}
                    >
                      OpenAI 兼容
                    </Button>
                    <Button
                      type="button"
                      variant={draft.kind === 'mock' ? 'default' : 'outline'}
                      size="sm"
                      className="justify-center"
                      onClick={() => change('kind', 'mock')}
                      disabled={busy === 'save'}
                    >
                      演示模式
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">需兼容 OpenAI Responses API；DeepSeek、OpenRouter 等以实际支持为准。</p>
                </div>
              </div>

              {draft.kind === 'openai' ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">快速填充</span>
                    {PRESETS.map((preset) => (
                      <Button key={preset.id} type="button" variant="outline" size="sm" onClick={() => applyPreset(preset)} disabled={busy === 'save'}>
                        {preset.label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setDraft((current) => ({ ...current, baseUrl: '', model: '' })); setTested(null); }}
                      disabled={busy === 'save'}
                    >
                      自定义
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="provider-base-url">接口地址</Label>
                      <Input
                        id="provider-base-url"
                        type="url"
                        value={draft.baseUrl}
                        onChange={(event) => change('baseUrl', event.target.value)}
                        placeholder="https://api.example.com/v1"
                        maxLength={500}
                        disabled={busy === 'save'}
                        invalid={Boolean(errors.baseUrl)}
                        aria-describedby={errors.baseUrl ? 'provider-base-url-error' : 'provider-base-url-hint'}
                        className="[overflow-wrap:anywhere]"
                      />
                      {errors.baseUrl ? <p id="provider-base-url-error" className="text-xs text-destructive">{errors.baseUrl}</p> : <p id="provider-base-url-hint" className="text-xs text-muted-foreground">一般以 /v1 结尾；不要包含查询参数。</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="provider-model">模型名称</Label>
                      <Input
                        id="provider-model"
                        value={draft.model}
                        onChange={(event) => change('model', event.target.value)}
                        placeholder="deepseek-chat"
                        maxLength={120}
                        disabled={busy === 'save'}
                        invalid={Boolean(errors.model)}
                        aria-describedby={errors.model ? 'provider-model-error' : 'provider-model-hint'}
                      />
                      {errors.model ? <p id="provider-model-error" className="text-xs text-destructive">{errors.model}</p> : <p id="provider-model-hint" className="text-xs text-muted-foreground">拼写要和服务商文档一致。</p>}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="provider-key">API Key</Label>
                      {editingProvider?.keyConfigured ? <span className="text-[11px] text-muted-foreground">已保存密钥，留空则不修改</span> : null}
                    </div>
                    <Input
                      id="provider-key"
                      type="password"
                      autoComplete="new-password"
                      value={draft.apiKey}
                      onChange={(event) => change('apiKey', event.target.value)}
                      placeholder={editingProvider?.keyConfigured ? '留空保持当前密钥' : '请输入服务商密钥'}
                      maxLength={512}
                      disabled={busy === 'save'}
                      invalid={Boolean(errors.apiKey)}
                      aria-describedby={errors.apiKey ? 'provider-key-error' : 'provider-key-hint'}
                    />
                    {errors.apiKey ? <p id="provider-key-error" className="text-xs text-destructive">{errors.apiKey}</p> : <p id="provider-key-hint" className="text-xs text-muted-foreground">保存后加密存储，不会在页面上再次显示明文。</p>}
                  </div>

                  {insecureHttp ? (
                    <div role="note" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
                      <p>此地址使用 HTTP，密钥会在网络传输中暴露。仅可在开发环境测试；生产环境只接受 HTTPS。</p>
                    </div>
                  ) : null}

                  {tested ? (
                    <p role="status" className="flex items-center gap-2 text-xs text-green-700">
                      <CheckCircle2 className="h-4 w-4" aria-hidden />当前输入已通过连接测试（{tested.latencyMs} ms），保存时会再次验证。
                    </p>
                  ) : null}
                </>
              ) : (
                <div role="note" className="flex items-start gap-2.5 rounded-md border border-border bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="font-medium text-foreground">演示模式不调用外部 AI</p>
                    <p className="mt-1">使用内置模拟结果，适合熟悉流程或临时停用外部服务。不会产生模型费用，也不会发送客户资料。</p>
                  </div>
                </div>
              )}
            </DialogBody>
            <DialogFooter className="flex-wrap">
              <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)} disabled={busy === 'save'}>
                取消
              </Button>
              <Button type="button" variant="outline" onClick={() => void testDraft()} disabled={Boolean(busy)}>
                {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}
                测试连接
              </Button>
              <Button type="submit" disabled={Boolean(busy)}>
                {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                验证并保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open && !busy) setDeleteTarget(null); }}
        title="删除 AI 服务"
        description={deleteTarget ? `确定删除「${deleteTarget.name}」吗？已保存的密钥也会一起删除。` : undefined}
        confirmText="删除服务"
        variant="destructive"
        loading={busy === 'delete'}
        onConfirm={removeProvider}
      />
    </div>
  );
}
