import * as React from 'react';
import { Calculator, Loader2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiPost, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { QuoteCheckResult } from '@/types';

type Item = { name: string; quantity: string };
const statusLabels: Record<string, { label: string; tone: 'developed' | 'warning' | 'destructive' | 'secondary' }> = {
  matched: { label: '一致', tone: 'developed' },
  catalog_missing: { label: '需补报价单', tone: 'warning' },
  product_missing: { label: '目录缺产品', tone: 'destructive' },
  quantity_missing: { label: '缺数量', tone: 'warning' },
  price_mismatch: { label: '价格不一致', tone: 'destructive' },
  below_catalog: { label: '低于目录价', tone: 'destructive' },
  review_required: { label: '需人工确认', tone: 'warning' },
};

export function QuoteCheckDialog({ open, onOpenChange, customerId }: { open: boolean; onOpenChange: (open: boolean) => void; customerId: string }): React.JSX.Element {
  const [items, setItems] = React.useState<Item[]>([{ name: '', quantity: '' }]);
  const [result, setResult] = React.useState<QuoteCheckResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { if (open) { setResult(null); setError(''); setItems([{ name: '', quantity: '' }]); } }, [open]);
  async function check() {
    if (loading) return;
    const payload = items.map((item) => ({ name: item.name.trim(), ...(item.quantity ? { quantity: Number(item.quantity) } : {}) })).filter((item) => item.name);
    if (!payload.length) { setError('请至少填写一个产品名称'); return; }
    setLoading(true); setError('');
    try { setResult(await apiPost<QuoteCheckResult>('/agent/quote-checks', { customerId, items: payload })); }
    catch (reason) { setError(toErrorMessage(reason, '报价核对失败')); }
    finally { setLoading(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" />报价核对</DialogTitle><DialogDescription>用当前项目产品目录与该客户最近报价单逐项核对；不会修改报价单，也不会自动发出回复。</DialogDescription></DialogHeader>
      <DialogBody className="max-h-[65vh] space-y-3 overflow-y-auto">
        {items.map((item, index) => <div key={index} className="flex gap-2"><Input className="flex-1" placeholder="产品名称或 SKU" value={item.name} onChange={(event) => setItems((current) => current.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} /><Input className="w-32" type="number" min="1" placeholder="数量" value={item.quantity} onChange={(event) => setItems((current) => current.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} /><Button type="button" variant="ghost" size="icon" aria-label="删除这一行" disabled={items.length <= 1} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}
        <Button type="button" variant="outline" size="sm" onClick={() => setItems((current) => [...current, { name: '', quantity: '' }])}><Plus className="h-4 w-4" />再加一个产品</Button>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {result && <div className="space-y-3 border-t pt-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={result.summary.blockers ? 'destructive' : result.summary.warnings ? 'warning' : 'developed'}>{result.summary.message}</Badge><span className="text-xs text-muted-foreground">一致 {result.summary.matched} · 待确认 {result.summary.warnings} · 风险 {result.summary.blockers}</span></div>{result.items.map((item, index) => { const tone = statusLabels[item.status] ?? { label: item.status, tone: 'secondary' as const }; return <div key={`${item.requestedName}-${index}`} className="rounded-md border bg-muted/20 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.requestedName}{item.requestedQuantity ? ` · ${item.requestedQuantity}` : ''}</span><Badge variant={tone.tone}>{tone.label}</Badge></div>{item.product && <p className="mt-1 text-xs text-muted-foreground">匹配 {item.product.sku} · {item.product.name}</p>}<div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">{item.tier && <div className="rounded bg-card p-2"><span className="text-muted-foreground">目录价：</span>{item.tier.currency} {item.tier.unitPrice}（{item.tier.minQuantity}{item.tier.maxQuantity ? `–${item.tier.maxQuantity}` : '+'} 件）</div>}{item.quoted && <div className="rounded bg-card p-2"><span className="text-muted-foreground">最近报价：</span>{item.quoted.quotationNo} · {item.quoted.currency} {item.quoted.unitPrice}</div>}</div>{item.messages.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{item.messages.map((message) => <li key={message}>{message}</li>)}</ul>}</div>; })}<p className="text-[11px] text-muted-foreground">核对时间 {formatDateTime(result.checkedAt)}。正式报价仍需确认币种、贸易条款、有效期和定制工艺。</p></div>}
      </DialogBody>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>关闭</Button><Button onClick={() => void check()} disabled={loading || items.every((item) => !item.name.trim())}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}开始核对</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
