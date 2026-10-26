import * as React from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {apiGet,toErrorMessage} from '@/lib/api';
import type {KnowledgeSource} from '@/types/knowledge';
export function sourceLocation(loc:Record<string,unknown>){
 if(loc.kind==='pdf')return '第 '+loc.page+' 页'+(loc.ocr?' · 图片识别':'');
 if(loc.kind==='table')return '表格 '+(loc.table??'')+' · 第 '+(loc.row??'')+' 行'+(loc.line?'（源文件第 '+loc.line+' 行）':'');
 if(loc.sheet)return String(loc.sheet)+' · '+(loc.range??loc.headerRange??'')+(loc.row?' · 第 '+loc.row+' 行':'');
 if(loc.kind==='word')return loc.table?'表格 '+loc.table+' · 第 '+loc.row+' 行'+(loc.rowSpan&&Number(loc.rowSpan)>1?'（跨 '+loc.rowSpan+' 行）':''):'第 '+loc.paragraph+' 段';
 if(loc.kind==='conditional_fact')return '发布条款'+(loc.termIndex!==undefined?' #'+(Number(loc.termIndex)+1):'');
 if(loc.kind==='image')return '图片识别片段';
 if(loc.start!==undefined)return '正文第 '+loc.start+'–'+loc.end+' 个字';
 return '发布正文';
}
type Evidence={changed:boolean;locations:{chunkId:string;name:string;location:Record<string,unknown>;headingPath:string[];excerpt:string;excerptScope:string;originalUrl?:string}[]};
export function KnowledgeCitation({source,letterId}:{source:KnowledgeSource;letterId?:string}){
 const trigger=React.useRef<HTMLButtonElement>(null);
 const [open,setOpen]=React.useState(false),[data,setData]=React.useState<Evidence|null>(null),[error,setError]=React.useState(''),[loading,setLoading]=React.useState(false);
 React.useEffect(()=>{if(!open||!letterId)return;let live=true;setLoading(true);setData(null);setError('');void apiGet<Evidence>('/agent/knowledge-drafts/'+letterId+'/evidence?sourceId='+encodeURIComponent(source.sourceId)).then(r=>{if(live)setData(r);}).catch(e=>{if(live)setError(toErrorMessage(e,'暂时无法打开依据，请稍后重试'));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[open,letterId,source.sourceId]);
 return <><Button ref={trigger} variant="ghost" className="min-h-11 max-w-full justify-start whitespace-normal break-words px-0 text-left text-primary" onClick={()=>setOpen(true)}>查看来源：{source.title} · 第 {source.version} 版</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent onCloseAutoFocus={e=>{e.preventDefault();trigger.current?.focus();}} className="max-h-[85dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="break-words pr-6">{source.title} · v{source.version}</DialogTitle><DialogDescription>生成时的依据快照，仅供内部审核，不加入客户邮件。</DialogDescription></DialogHeader>{loading?<p role="status">正在核对权限与来源…</p>:error?<p role="alert" className="text-sm leading-6 text-destructive">{error}</p>:<div className="min-w-0 space-y-4 text-sm leading-6">{data?.changed&&<p role="status" className="text-amber-700 dark:text-amber-400">当前知识已更新。这是旧稿依据，请重新生成新稿后比较。</p>}<dl className="space-y-2"><div><dt className="font-semibold">适用范围</dt><dd className="break-words">{source.products.join('、')||'项目通用'} · {source.applicability}</dd></div><div><dt className="font-semibold">有效期</dt><dd>{new Date(source.validFrom).toLocaleDateString()} — {source.validUntil?new Date(source.validUntil).toLocaleDateString():'未设置失效时间'}</dd></div><div><dt className="font-semibold">确认来源</dt><dd className="break-words">{source.source}</dd></div></dl><pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-4 font-sans text-sm leading-7">{source.content}</pre>{data?.locations.map(l=><section key={l.chunkId} className="space-y-2 border-t pt-3"><h4 className="break-words font-semibold">{l.name}</h4><p>{sourceLocation(l.location)} · {l.headingPath.join(' / ')||'正文'}</p><p className="text-xs text-muted-foreground">{l.excerptScope==='original_chunk'?'原始解析片段':'仅展示本次已发布范围，原文件由管理员核对'}</p><pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans leading-7">{l.excerpt}</pre>{l.originalUrl&&<a className="block min-h-11 py-2 text-primary underline" href={l.originalUrl} target="_blank" rel="noreferrer">定位原文与解析片段（新标签页）</a>}</section>)}{!data?.locations.length&&<p className="text-muted-foreground">本依据未关联可定位原文件，以上为生成时的发布正文；请联系管理员核对来源。</p>}</div>}</DialogContent></Dialog></>;
}
