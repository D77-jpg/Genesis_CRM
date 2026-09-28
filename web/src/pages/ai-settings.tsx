import * as React from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePageTitle } from '@/hooks/use-ui';
import { apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';

interface AiSettings {
  provider: 'mock' | 'openai';
  model: string;
  baseUrl: string;
  source: 'database' | 'environment';
  keySource: 'database' | 'environment' | 'none';
  keyConfigured: boolean;
  updatedAt: string | null;
}

interface AiSettingsForm {
  provider: 'mock' | 'openai';
  model: string;
  baseUrl: string;
  apiKey: string;
}

type Field = 'model' | 'baseUrl' | 'apiKey';
const emptyForm: AiSettingsForm = { provider: 'mock', model: '', baseUrl: '', apiKey: '' };

function validateForm(form: AiSettingsForm, keyConfigured: boolean): Partial<Record<Field, string>> {
  if (form.provider === 'mock') return {};
  const errors: Partial<Record<Field, string>> = {};
  if (!form.model.trim()) errors.model = '请输入服务商提供的模型 ID。';
  try {
    const url = new URL(form.baseUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      errors.baseUrl = '请输入不含账号、查询参数的 HTTP(S) API 基址。';
    }
  } catch { errors.baseUrl = '请输入完整的 API 地址，例如 https://example.com/v1。'; }
  if (!keyConfigured && !form.apiKey.trim()) errors.apiKey = '首次启用真实 AI 时需要 API Key。';
  return errors;
}

export function AiSettingsPage(): React.JSX.Element {
  usePageTitle('AI 配置');
  const [settings, setSettings] = React.useState<AiSettings | null>(null);
  const [form, setForm] = React.useState<AiSettingsForm>(emptyForm);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<'test' | 'save' | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const [tested, setTested] = React.useState(false);
  const errorRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await apiGet<AiSettings>('/agent/admin/ai-settings');
      setSettings(next);
      setForm({ provider: next.provider, model: next.model, baseUrl: next.baseUrl, apiKey: '' });
      setTested(false);
    } catch (reason) { setLoadError(toErrorMessage(reason, 'AI 配置加载失败')); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  function change<K extends keyof AiSettingsForm>(field: K, value: AiSettingsForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
    setTested(false);
  }

  async function submit(action: 'test' | 'save') {
    if (busy) return;
    const nextErrors = validateForm(form, Boolean(settings?.keyConfigured));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setFormError('请先修正标出的字段。');
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setBusy(action);
    setFormError('');
    try {
      const payload = { ...form, model: form.model.trim(), baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() };
      if (action === 'test') {
        await apiPost('/agent/admin/ai-settings/test', payload, { timeout: 30_000 });
        setTested(true);
        toast.success(form.provider === 'mock' ? '模拟模式可用' : '真实模型连接测试通过');
      } else {
        const saved = await apiPut<AiSettings>('/agent/admin/ai-settings', payload, { timeout: 30_000 });
        setSettings(saved);
        setForm((current) => ({ ...current, apiKey: '' }));
        setTested(false);
        toast.success(form.provider === 'mock' ? '已切换至模拟模式' : 'AI 配置已验证并生效');
      }
    } catch (reason) {
      setFormError(toErrorMessage(reason, action === 'test' ? '连接测试失败' : '保存失败，原配置未更改'));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setBusy(null); }
  }

  if (loading && !settings) return <div className="space-y-5"><PageHeader title="AI 配置" /><p className="text-sm text-muted-foreground">正在加载配置…</p></div>;
  if (loadError && !settings) return <ErrorState description={loadError} onRetry={() => void load()} />;

  const live = form.provider === 'openai';
  const insecureHttp = live && form.baseUrl.trim().toLowerCase().startsWith('http://');
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="AI 配置" description="管理员设置全系统 Agent 使用的模型。所有项目共用这一配置，保存后立即生效。" />
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>当前配置</CardTitle>
            <Badge variant={settings?.provider === 'openai' ? 'developed' : 'secondary'}>{settings?.provider === 'openai' ? '真实模型' : '模拟模式'}</Badge>
          </div>
          <CardDescription>
            {settings?.source === 'environment' ? '当前来自服务端环境变量；在此保存后由管理员配置接管。' : '当前由管理员配置管理，无需重启服务。'}
            {settings?.provider === 'openai' ? ` 模型：${settings.model}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            <span>{settings?.keyConfigured ? 'API Key 已配置（页面不会读取或显示原值）' : '尚未配置 API Key'}</span>
          </div>
          {settings?.keyConfigured && <p className="pl-6 text-xs text-muted-foreground">密钥来源：{settings.keySource === 'database' ? '数据库加密保存' : '服务器私有环境变量'}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>切换服务商与模型</CardTitle><CardDescription>支持 OpenAI Responses API 协议；连接测试和保存验证只发送合成的 Ping，不发送客户数据。测试可能产生少量调用费用。</CardDescription></CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void submit('save'); }} noValidate>
            {formError && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive">{formError}</div>}
            <div className="space-y-1.5">
              <Label htmlFor="ai-provider">运行模式</Label>
              <select id="ai-provider" value={form.provider} onChange={(event) => change('provider', event.target.value as AiSettingsForm['provider'])} disabled={Boolean(busy)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="mock">模拟模式（不调用外部 AI）</option>
                <option value="openai">真实 AI（OpenAI Responses API 兼容）</option>
              </select>
            </div>
            {live && <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ai-model">模型 ID</Label>
                <Input id="ai-model" value={form.model} onChange={(event) => change('model', event.target.value)} maxLength={120} disabled={Boolean(busy)} invalid={Boolean(errors.model)} aria-describedby={errors.model ? 'ai-model-error' : 'ai-model-hint'} />
                {errors.model ? <p id="ai-model-error" className="text-xs text-destructive">{errors.model}</p> : <p id="ai-model-hint" className="text-xs text-muted-foreground">填写服务商返回的准确模型 ID。</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-url">API 基址</Label>
                <Input id="ai-url" type="url" value={form.baseUrl} onChange={(event) => change('baseUrl', event.target.value)} maxLength={500} disabled={Boolean(busy)} invalid={Boolean(errors.baseUrl)} aria-describedby={errors.baseUrl ? 'ai-url-error' : 'ai-url-hint'} className="[overflow-wrap:anywhere]" />
                {errors.baseUrl ? <p id="ai-url-error" className="text-xs text-destructive">{errors.baseUrl}</p> : <p id="ai-url-hint" className="text-xs text-muted-foreground">例如 https://api.example.com/v1；服务端会调用 /responses。</p>}
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="ai-key">API Key（更换时填写）</Label>
                <Input id="ai-key" type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => change('apiKey', event.target.value)} maxLength={512} disabled={Boolean(busy)} invalid={Boolean(errors.apiKey)} aria-describedby={errors.apiKey ? 'ai-key-error' : 'ai-key-hint'} placeholder={settings?.keyConfigured ? '留空则保持当前密钥' : '请输入服务商密钥'} />
                {errors.apiKey ? <p id="ai-key-error" className="text-xs text-destructive">{errors.apiKey}</p> : <p id="ai-key-hint" className="text-xs text-muted-foreground">保存后加密存储；此页面不会回显密钥。不要把密钥写进网址。</p>}
              </div>
            </div>}
            {insecureHttp && <div role="note" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <p>此地址使用 HTTP，密钥会在网络传输中暴露。仅可在开发环境测试；生产环境只接受 HTTPS。</p>
            </div>}
            {tested && <p role="status" className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" aria-hidden />当前输入已通过测试，保存时会再次验证。</p>}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => void submit('test')} disabled={Boolean(busy) || loading}>
                {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}
                测试连接
              </Button>
              <Button type="submit" disabled={Boolean(busy) || loading}>
                {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                验证并保存
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
