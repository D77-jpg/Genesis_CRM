import * as React from 'react';
import { FileText, Upload, Loader2, Download, ArrowLeft, RefreshCw, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost, apiDownload, toErrorMessage } from '@/lib/api';
import { knowledgeCategories, type KnowledgeCategory } from '@/types/knowledge';

type Parsing = { id: string; revision: number; state: string; stage: string; done: number; total: number; warnings: string[];
  chunkCount?: number; parserVersion: string; configHash: string; error?: { code: string; message: string }; artifact?: { elapsedMs?: number } };
type Source = { id: string; originalName: string; kind: string; source: string; sha256: string; bytes: number; category: KnowledgeCategory; createdAt: string; parsing: Parsing | null };
type Chunk = { id: string; content: string; headingPath: string[]; tokenCount: number; indexEligible: boolean; warnings: string[];
  location: Record<string, unknown>; table?:Record<string,unknown>; headers: string[]; footnotes: string[]; currencies: string[]; units: string[]; draftId: string; suggestions: { topic: string; text: string }[] };
type Detail = { document: Source; revisions: Parsing[]; chunks: Chunk[]; page: number };
const states: Record<string, string> = { queued: '排队中', running: '正在解析', succeeded: '待审核', partial: '需重点核对', failed: '解析失败', cancelled: '已取消' };
const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
function locationLabel(loc: Record<string, unknown>) {
  if (loc.kind === 'text') return `文字区间 ${loc.start}–${loc.end}（Unicode 字符）`;
  if (loc.kind === 'pdf') return `第 ${loc.page} 页${loc.ocr ? ' · OCR' : ''}`;
  if (loc.kind === 'image') return `图片 ${loc.width} × ${loc.height} · OCR`;
  if (loc.kind === 'word') return loc.table ? `文档块 ${loc.table} · 表格行 ${loc.row}` : `文档块 ${loc.paragraph} · 段落`;
  return `${loc.sheet} · ${loc.range}${loc.headerRange ? ' · 表头 ' + loc.headerRange : ''}`;
}

export function KnowledgeDocuments({ initialDocument, initialRevision, onReview }: { initialDocument?: string; initialRevision?: string; onReview: (id: string) => void }) {
  const [rows, setRows] = React.useState<Source[]>([]), [next, setNext] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState(initialDocument ?? ''), [detail, setDetail] = React.useState<Detail | null>(null);
  const [revisionId,setRevisionId]=React.useState(initialRevision??'');
  const [refresh,setRefresh]=React.useState(0);
  const [page, setPage] = React.useState(0), [loading, setLoading] = React.useState(true), [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const [source, setSource] = React.useState(''), [category, setCategory] = React.useState<KnowledgeCategory>('company');
  const [uploadResults, setUploadResults] = React.useState<{ name: string; status: string }[]>([]);
  const [review, setReview] = React.useState<{ chunk: Chunk; title: string; content: string; applicability: string; category: KnowledgeCategory } | null>(null);
  const [legacy, setLegacy] = React.useState<{ entries: { id: string; version: number; approvedVersion: number; revisions: { version: number; title: string; sha256: string; mapped: boolean }[] }[]; next: string | null } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const uploadAbort=React.useRef<AbortController|null>(null);
  React.useEffect(()=>()=>uploadAbort.current?.abort(),[]);
  const load = React.useCallback(async () => {
    const result = await apiGet<{ documents: Source[]; next: string | null }>('/knowledge-documents');
    setRows(result.documents); setNext(result.next); setLoading(false);
  }, []);
  React.useEffect(() => { let stopped = false; void load().catch(e => { if (!stopped) { setError(toErrorMessage(e)); setLoading(false); } }); return () => { stopped = true; }; }, [load]);
  React.useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let stopped = false, polling = true;
    const read = () => apiGet<Detail>(`/knowledge-documents/${selected}?page=${page}${revisionId?"&revision="+revisionId:""}`).then(d => { if (!stopped) {setDetail(d);polling=d.revisions.some(r=>['queued','running'].includes(r.state));} }).catch(e => { if (!stopped) setError(toErrorMessage(e)); });
    setDetail(null); setReview(null); void read();
    const timer = setInterval(() => { if (!stopped&&polling) void read(); }, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [selected, page, revisionId,refresh]);
  React.useEffect(() => {
    if (!rows.some(r => ['queued', 'running'].includes(r.parsing?.state ?? ''))) return;
    const timer = setInterval(() => { void load().catch(e => setError(toErrorMessage(e))); }, 3000);
    return () => clearInterval(timer);
  }, [rows, load]);
  async function upload(files: File[]) {
    const controller=new AbortController();uploadAbort.current=controller;
    setBusy(true); setError(''); setNotice(''); setUploadResults(files.map(f => ({ name: f.name, status: '等待上传' })));
    for (let index = 0; index < files.length; index++) {
      if(controller.signal.aborted)break;
      const file = files[index];
      const status = (text: string) => setUploadResults(r => r.map((v, i) => i === index ? { ...v, status: text } : v));
      try {
        if (file.size > 15 * 1024 ** 2 || !file.size) throw new Error('文件为空或超过 15MB');
        status('正在上传');
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('文件读取失败')); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file); });
        if(controller.signal.aborted)break;
        const result = await apiPost<{ id: string; duplicate: boolean }>('/knowledge-documents', { fileName: file.name, data, source, category },{signal:controller.signal});
        status(result.duplicate ? '已存在，保留原解析记录' : '已保存原文，等待本地解析');
        setSelected(result.id); setPage(0); setRevisionId('');setRefresh(v=>v+1);
      } catch (e) { status(toErrorMessage(e)); }
    }
    await load().catch(e => setError(toErrorMessage(e))); setBusy(false); if (fileInput.current) fileInput.current.value = '';
  }
  async function control(action: 'retry' | 'cancel') {
    if (!detail?.revisions[0]) return; setBusy(true); setError('');
    try { await apiPost(`/knowledge-documents/parsing/${detail.revisions[0].id}/${action}`, {}); setDetail(await apiGet<Detail>(`/knowledge-documents/${selected}?page=${page}${revisionId?"&revision="+revisionId:""}`)); await load(); setRefresh(v=>v+1); }
    catch (e) { setError(toErrorMessage(e)); } finally { setBusy(false); }
  }
  async function download() {
    try { const file = await apiDownload(`/knowledge-documents/${selected}/original`); const url = URL.createObjectURL(file.blob); const a = document.createElement('a'); a.href = url; a.download = file.filename ?? detail?.document.originalName ?? 'source'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setError(toErrorMessage(e)); }
  }
  async function save() {
    if (!review) return; setBusy(true); setError('');
    try { const result = await apiPost<{ id: string }>(`/knowledge-documents/chunks/${review.chunk.id}/draft`, { title: review.title, content: review.content, applicability: review.applicability, category: review.category });
      setReview(null); setNotice('已保存为知识草稿。发布前还需核对产品、条件与有效期。'); onReview(result.id); }
    catch (e) { setError(toErrorMessage(e)); } finally { setBusy(false); }
  }
  const active = detail?.revisions.find(r=>r.id===revisionId)??detail?.revisions[0];
  return <div className="p-4 sm:p-6">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">资料导入与审核</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">原文保存在当前项目。解析与识别在本地完成；内容经你核对并发布后，销售助手才能作为业务依据使用。</p></div>
      <Button variant="ghost" className="min-h-11" onClick={() => void load().catch(e => setError(toErrorMessage(e)))}><RefreshCw className="mr-2 h-4 w-4" />刷新列表</Button></header>
    {error && <p role="alert" className="mb-4 rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="mb-4 text-sm leading-6">{notice}</p>}
    <section className="mb-6 space-y-4 border-y py-5" aria-label="上传项目资料">
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]"><label className="space-y-2 text-sm"><span className="block font-medium">资料来源</span><Input className="min-h-11" value={source} onChange={e => setSource(e.target.value)} placeholder="如：公司产品手册，2026 年 10 月" maxLength={350} /></label><label className="space-y-2 text-sm"><span className="block font-medium">知识分类</span><select className={selectClass} value={category} onChange={e => setCategory(e.target.value as KnowledgeCategory)}>{Object.entries(knowledgeCategories).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
      <div className="flex flex-wrap items-center gap-3"><input ref={fileInput} className="sr-only" aria-label="选择项目资料" type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg" onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length > 10) { setError('每次最多选择 10 份文件'); e.target.value = ''; return; } if (files.length) void upload(files); }} /><Button disabled={busy || !source.trim()} className="min-h-11" onClick={() => fileInput.current?.click()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}选择资料上传</Button><p className="text-sm text-muted-foreground">每份 ≤15MB，PDF ≤50 页；支持 TXT / Markdown / PDF / DOCX / XLSX / CSV / PNG / JPEG。</p></div>
      {!source.trim() && <p className="text-xs text-muted-foreground">先填写来源，方便后续追溯。</p>}
      {uploadResults.length > 0 && <ul className="divide-y text-sm" aria-live="polite">{uploadResults.map((r, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span className="break-all">{r.name}</span><span className="text-muted-foreground">{r.status}</span></li>)}</ul>}
    </section>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
      <aside aria-label="原始资料列表"><h3 className="mb-2 font-semibold">原始资料</h3>{loading && <p role="status" className="py-4 text-sm">正在读取资料…</p>}{!loading && !rows.length && <p className="py-4 text-sm leading-6 text-muted-foreground">还没有导入资料。你也可以先查看历史知识的兼容映射。</p>}<ul className="divide-y">{rows.map(row => <li key={row.id}><button className={'min-h-11 w-full rounded-md px-3 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' + (row.id === selected ? 'bg-primary/5' : 'hover:bg-muted/50')} onClick={() => { setSelected(row.id); setPage(0); setRevisionId('');setError(''); }}><span className="block break-all text-sm font-medium">{row.originalName}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{states[row.parsing?.state ?? ''] ?? '等待任务'} · {row.parsing?.chunkCount ?? 0} 个片段</span></button></li>)}</ul>{next && <Button variant="ghost" className="min-h-11" onClick={() => void apiGet<{ documents: Source[]; next: string | null }>('/knowledge-documents?before=' + next).then(r => { setRows(old => [...old, ...r.documents]); setNext(r.next); }).catch(e => setError(toErrorMessage(e)))}>加载更早资料</Button>}</aside>
      <section className="min-w-0" aria-label="解析预览">
        {!selected && <div className="py-10 text-sm leading-7 text-muted-foreground"><FileText className="mb-3 h-7 w-7" aria-hidden />选择一份资料，查看解析进度、片段和原文位置。<p>解析不会自动发布政策，也不会改变邮件模板或客户资料。</p></div>}
        {selected && !detail && <p role="status" className="py-6 text-sm">正在读取解析结果…</p>}
        {detail && <><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{detail.document.originalName}</h3><p className="mt-1 text-sm text-muted-foreground">{detail.document.source}</p></div><Button variant="outline" className="min-h-11 shrink-0" disabled={!detail.revisions.some(r=>['succeeded','partial'].includes(r.state))} onClick={() => void download()}><Download className="mr-2 h-4 w-4" />下载原文核对</Button></div>
          {detail.revisions.length>1&&<label className="mt-4 block space-y-2 text-sm"><span className="block font-medium">查看解析版本</span><select className={selectClass} value={revisionId} onChange={e=>{setRevisionId(e.target.value);setPage(0);}}><option value="">最新解析</option>{detail.revisions.map(r=><option key={r.id} value={r.id}>第 {r.revision} 次 · {states[r.state]}</option>)}</select></label>}
          {active && <div className="my-4 space-y-3 border-y py-4" aria-live="polite"><p className="text-sm font-medium">{states[active.state]} · 第 {active.revision} 次解析</p><p className="text-sm text-muted-foreground">{active.stage}{active.state === 'running' ? ` · ${active.done} / ${active.total}` : ''}</p>{['queued', 'running'].includes(active.state) && <progress className="h-2 w-full" aria-label="解析进度" value={active.done} max={Math.max(1, active.total)} />}
            {active.error && <p role="alert" className="text-sm leading-6 text-destructive">{active.error.message}</p>}{active.warnings.map(w => <p key={w} className="text-sm leading-6 text-amber-700 dark:text-amber-400">{w}</p>)}
            {detail.document.kind !== 'legacy_inline' && (!revisionId||revisionId===detail.revisions[0].id) && <div className="flex flex-wrap gap-2">{['queued', 'running'].includes(active.state) ? <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void control('cancel')}><X className="mr-2 h-4 w-4" />取消解析</Button> : <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void control('retry')}><RefreshCw className="mr-2 h-4 w-4" />重新解析（保留旧结果）</Button>}</div>}
            <details className="text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer">原文与解析版本记录</summary><p className="mt-2 break-all">文件 SHA-256：{detail.document.sha256}</p><ol>{detail.revisions.map(r => <li key={r.id} className="mt-2 break-all">第 {r.revision} 次 · {states[r.state]} · {r.parserVersion}<br />配置校验：{r.configHash}{r.error && <p>{r.error.message}</p>}</li>)}</ol></details>
          </div>}
          {review ? <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}><Button type="button" variant="ghost" className="min-h-11" onClick={() => setReview(null)}><ArrowLeft className="mr-2 h-4 w-4" />返回片段</Button><h4 className="font-semibold">核对后保存为知识草稿</h4><p className="text-sm leading-6 text-muted-foreground">请对照原文核对数字、单位、币种、产品条件及脚注。保存后仍需在知识条目中填写生效范围并人工发布。</p><label className="block space-y-2 text-sm"><span className="block font-medium">标题</span><Input value={review.title} maxLength={160} onChange={e => setReview({ ...review, title: e.target.value })} /></label><label className="block space-y-2 text-sm"><span className="block font-medium">正文</span><Textarea rows={12} value={review.content} onChange={e => setReview({ ...review, content: e.target.value })} /></label><p className={'text-xs ' + (review.content.length > 12000 ? 'text-destructive' : 'text-muted-foreground')}>{review.content.length} / 12000 字符；超长内容请整理为完整、条件清楚的知识条目。</p><label className="block space-y-2 text-sm"><span className="block font-medium">适用条件与待确认事项</span><Textarea value={review.applicability} onChange={e => setReview({ ...review, applicability: e.target.value })} maxLength={1000} /></label><label className="block space-y-2 text-sm"><span className="block font-medium">知识分类</span><select className={selectClass} value={review.category} onChange={e => setReview({ ...review, category: e.target.value as KnowledgeCategory })}>{Object.entries(knowledgeCategories).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><Button type="submit" className="min-h-11" disabled={busy || !review.title.trim() || !review.content.trim() || review.content.length > 12000 || !review.applicability.trim()}><Check className="mr-2 h-4 w-4" />保存草稿并进入知识审核</Button></form>
            : <><ol className="divide-y">{detail.chunks.map((chunk, i) => <li key={chunk.id} className="py-5"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">片段 {page * 20 + i + 1} · {chunk.headingPath.join(' / ') || '正文'}</h4><span className="text-xs text-muted-foreground">待人工核对</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{locationLabel(chunk.location)}</p><pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-sans text-sm leading-7">{chunk.content}</pre>{chunk.warnings.map(w => <p key={w} className="mt-2 text-sm leading-6 text-amber-700 dark:text-amber-400">{w}</p>)}{!chunk.indexEligible && <p className="mt-2 text-xs leading-6 text-muted-foreground">本片段需人工整理，当前不能直接进入后续索引。</p>}<details className="mt-3 text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer">表头、脚注与原文位置</summary><p>分词长度（含标题）：{chunk.tokenCount}</p><pre className="whitespace-pre-wrap break-words">{JSON.stringify({ location: chunk.location, table:chunk.table, headers: chunk.headers, footnotes: chunk.footnotes, currencies: chunk.currencies, units: chunk.units }, null, 2)}</pre></details>{chunk.suggestions.length > 0 && <p className="mt-2 text-xs leading-6 text-muted-foreground">检测到可能涉及业务政策的文字，仅作待审核建议：请逐项核对值、单位与条件。</p>}<Button variant="outline" className="mt-3 min-h-11" onClick={() => chunk.draftId ? onReview(chunk.draftId) : setReview({ chunk, title: (chunk.headingPath.join(' / ') || detail.document.originalName).slice(0, 160), content: chunk.content, category: detail.document.category ?? 'product', applicability: '' })}>{chunk.draftId ? '查看已保存的知识草稿' : '核对此片段'}</Button></li>)}</ol>{(active?.chunkCount ?? 0) > 20 && <div className="flex items-center justify-between gap-3 border-t pt-4"><Button variant="outline" className="min-h-11" disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</Button><span className="text-sm">第 {page + 1} 页，共 {Math.ceil((active?.chunkCount ?? 0) / 20)} 页</span><Button variant="outline" className="min-h-11" disabled={(page + 1) * 20 >= (active?.chunkCount ?? 0)} onClick={() => setPage(p => p + 1)}>下一页</Button></div>}</>}
        </>}
      </section>
    </div>
    <section className="mt-8 border-t pt-5"><h3 className="font-semibold">历史知识兼容预览</h3><p className="my-2 text-sm leading-6 text-muted-foreground">现有知识及版本保持原样。可逐项建立原文快照映射，不会删除、覆盖或自动发布任何草稿。</p><Button variant="ghost" className="min-h-11" onClick={() => void apiGet<NonNullable<typeof legacy>>('/knowledge-documents/legacy-preview').then(setLegacy).catch(e => setError(toErrorMessage(e)))}>查看映射预览（不修改知识）</Button>{legacy && <><ul className="mt-3 divide-y">{legacy.entries.map(k => <li key={k.id} className="py-3 text-sm"><p className="font-medium">{k.revisions.at(-1)?.title} · 当前 v{k.version} · {k.approvedVersion ? '已发布 v' + k.approvedVersion : '未发布'}</p>{k.revisions.map(v => <div key={v.version} className="mt-2 flex flex-wrap items-center justify-between gap-2"><span>版本 {v.version} · {v.mapped ? '已有原文快照' : '尚无原文快照'}</span>{!v.mapped && <Button variant="outline" disabled={busy} className="min-h-11" onClick={() => { setBusy(true); void apiPost<{ id: string }>('/knowledge-documents/legacy/' + k.id, { version: v.version }).then(r => { setSelected(r.id); setPage(0); setNotice('仅建立历史正文快照，原知识版本与发布状态保持不变。'); setLegacy(null); return load(); }).catch(e => setError(toErrorMessage(e))).finally(() => setBusy(false)); }}>建立此版本快照</Button>}</div>)}</li>)}</ul>{legacy.next && <Button variant="ghost" className="min-h-11" onClick={() => void apiGet<NonNullable<typeof legacy>>('/knowledge-documents/legacy-preview?before=' + legacy.next).then(r => setLegacy(old => ({ ...r, entries: [...(old?.entries ?? []), ...r.entries] }))).catch(e => setError(toErrorMessage(e)))}>加载更早知识</Button>}</>}</section>
  </div>;
}
