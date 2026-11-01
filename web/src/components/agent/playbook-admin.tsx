import * as React from 'react';
import { Braces, CheckCircle2, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiDelete, apiGet, apiPut, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Card {
  id: string; kind?: 'segment' | 'preference'; name: string; signals: string; products: string;
  logic: string; avoid: string; cta: string; prepare: string; check: string; subjects: string[]; keywords?: string[];
}
interface PlaybookState {
  version: number; source: 'builtin' | 'imported'; segments: Card[]; preferences: Card[]; updatedAt?: string | Date | null;
  projectKey?: string; projectLabel?: string;
}

function CardPreview({ title, cards }: { title: string; cards: Card[] }): React.JSX.Element | null {
  if (!cards.length) return null;
  return <details className="rounded-lg border" open>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium">
      <span>{title}</span><span className="text-xs font-normal text-muted-foreground">{cards.length} 张</span>
    </summary>
    <div className="max-h-[360px] divide-y overflow-y-auto border-t">
      {cards.map((card) => <article key={card.id} className="grid gap-1.5 p-3 text-xs sm:grid-cols-[8rem_1fr]">
        <div><Badge variant="outline" className="font-mono">{card.id}</Badge><p className="mt-1 font-medium text-foreground">{card.name}</p></div>
        <div className="space-y-1 text-muted-foreground">
          <p><span className="text-foreground/70">信号：</span>{card.signals || '—'} · <span className="text-foreground/70">产品：</span>{card.products || '—'}</p>
          <p><span className="text-foreground/70">逻辑：</span>{card.logic || '—'}</p>
          <p><span className="text-foreground/70">CTA：</span>{card.cta || '—'}</p>
        </div>
      </article>)}
    </div>
  </details>;
}

const example: Card[] = [
  {
    id: 'CUSTOM-I01', kind: 'segment', name: '项目专属细分客户', signals: 'customer website signal', products: 'product category',
    logic: '只写由客户事实支持、且项目已批准的价值逻辑', avoid: '不写未批准的价格、MOQ、认证或交期',
    cta: 'Would a short spec sheet help you compare options?', prepare: '规格表、实物样或项目案例', check: '内部注意事项，不进入客户正文', subjects: ['A relevant subject for [Brand]'], keywords: ['keyword-from-customer-site'],
  },
  {
    id: 'CUSTOM-P01', kind: 'preference', name: '项目专属采购偏好', signals: 'quality / total cost / lead time', products: '',
    logic: '用客户已表达的标准排序，不猜预算', avoid: '不把偏好写成承诺', cta: '与客户当前评估标准对应的低负担下一步',
    prepare: '可按偏好比较的资料', check: '', subjects: [], keywords: [],
  },
];

export function PlaybookAdmin(): React.JSX.Element {
  const [state, setState] = React.useState<PlaybookState | null>(null);
  const [text, setText] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await apiGet<PlaybookState>('/agent/playbooks');
      setState(data);
      setText(JSON.stringify([...data.segments.map((card) => ({ ...card, kind: 'segment' })), ...data.preferences.map((card) => ({ ...card, kind: 'preference' }))], null, 2));
    } catch (reason) { setError(toErrorMessage(reason, '行业卡加载失败')); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const parsed = JSON.parse(text || '[]') as Card[];
      if (!Array.isArray(parsed)) throw new Error('请输入卡片数组');
      const cards = parsed.map((card) => ({ ...card, kind: card.kind ?? 'segment', subjects: card.subjects ?? [], keywords: card.keywords ?? [] }));
      await apiPut('/agent/playbooks', { cards });
      toast.success('行业卡已导入；下一封开发信会使用该项目的卡片');
      await load();
    } catch (reason) { setError(toErrorMessage(reason, '行业卡导入失败')); }
    finally { setSaving(false); }
  }

  async function clear() {
    if (saving || !window.confirm('清除本项目已导入的行业卡？清除后会回退到内置卡片。')) return;
    setSaving(true); setError('');
    try { await apiDelete('/agent/playbooks'); toast.success('已回退到内置卡片'); await load(); }
    catch (reason) { setError(toErrorMessage(reason, '清除失败')); }
    finally { setSaving(false); }
  }

  return <div className="space-y-4 p-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Braces className="h-5 w-5 text-primary" />行业卡与偏好卡</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">行业卡只影响写作策略，不作为事实证据。未导入时展示并使用当前项目内置卡；导入后展示本项目版本。</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />刷新</Button>{state?.source === 'imported' && <Button variant="outline" size="sm" onClick={() => void clear()} disabled={saving}><Trash2 className="h-4 w-4" />回退内置</Button>}<Button size="sm" onClick={() => void save()} disabled={saving || !text.trim()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{state?.source === 'builtin' ? '导入为项目卡片' : '保存本项目'}</Button></div>
    </header>
    {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
      <Badge variant={state?.source === 'imported' ? 'developed' : 'secondary'}>{state?.source === 'imported' ? '本项目已导入' : '使用内置卡片'}</Badge>
      <span className="text-xs text-muted-foreground">{state?.projectLabel ? `${state.projectLabel} · ` : ''}版本 {state?.version ?? 0} · 行业卡 {state?.segments.length ?? 0} · 偏好卡 {state?.preferences.length ?? 0}{state?.updatedAt ? ` · ${formatDateTime(state.updatedAt)}` : ''}</span>
      <span className="ml-auto text-xs text-muted-foreground">只导入 text、不导入示例邮件正文；卡片中的数字不会被当作已确认事实。</span>
    </div>
    {!loading && state && (state.segments.length > 0 || state.preferences.length > 0) && <div className="grid gap-3 lg:grid-cols-2"><CardPreview title="行业卡预览" cards={state.segments} /><CardPreview title="偏好卡预览" cards={state.preferences} /></div>}
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">卡片 JSON（segment / preference）</p><Button variant="ghost" size="sm" onClick={() => setText(JSON.stringify(example, null, 2))}><Braces className="h-4 w-4" />载入格式示例</Button></div>
      <Textarea className="min-h-[440px] font-mono text-xs" value={text} onChange={(event) => setText(event.target.value)} disabled={loading || saving} placeholder="粘贴卡片数组；每张卡必须有 id、kind、name，其余字段可留空。" />
      <p className="mt-2 text-xs text-muted-foreground">每个项目独立存储。导入后不会修改知识库事实、报价或已生成草稿；重新生成开发信时才生效。上方预览展示当前实际生效的卡片，JSON 可查看全部字段。</p>
    </div>
    {!loading && state?.source === 'builtin' && <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4" />{state.segments.length || state.preferences.length ? '当前项目正在使用代码内置卡；下方已列出内置数据，可直接编辑后导入为项目副本。' : '当前项目没有内置卡片；可粘贴 JSON 导入本项目。'}</div>}
  </div>;
}
