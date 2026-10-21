import {FilePenLine,Loader2,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {formatRelative} from '@/lib/format';
import type {PendingDraftFeed} from '@/hooks/use-pending-drafts';
import type {DevelopmentLetter} from '@/types';

export function PendingDrafts({feed,onOpenDraft,busy=false}:{feed:PendingDraftFeed;onOpenDraft:(letter:DevelopmentLetter)=>void;busy?:boolean}){
 return <section aria-label="待审核草稿" className="min-w-0 rounded-xl border border-primary/20 bg-card p-4 sm:p-5">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h2 className="flex items-center gap-2 text-base font-semibold"><FilePenLine className="h-4 w-4 text-primary" aria-hidden/>{feed.customerId?'当前客户的待审核草稿':'待审核草稿'}<span className="text-sm tabular-nums text-muted-foreground">{feed.total}</span></h2>
   <Button type="button" variant="ghost" className="min-h-11" disabled={feed.loading} onClick={feed.refresh}><RefreshCw className="h-4 w-4" aria-hidden/>刷新草稿</Button>
  </div>
  <p className="mt-1 text-sm leading-6 text-muted-foreground">已保存的邮件都在这里，打开后可查看依据、编辑或继续保存，确认后再发送。</p>
  {feed.error&&<div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{feed.error}</span><Button type="button" variant="outline" className="min-h-11" onClick={feed.refresh}>重试加载草稿</Button></div>}
  {!feed.items.length&&feed.loading&&<p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden/>正在查找待审核草稿…</p>}
  {!feed.loading&&!feed.error&&!feed.items.length&&<p className="mt-4 text-sm text-muted-foreground">暂无待审核草稿。新生成或保存的草稿会自动出现在这里。</p>}
  <ul className="mt-3 divide-y">{feed.items.map(letter=><li key={letter.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center">
   <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold leading-6">{letter.subject||'（无主题）'}</p>
    {!feed.customerId&&<p className="mt-1 break-words text-sm text-muted-foreground">{letter.customer?.name||letter.recipientName} · {letter.recipientEmail}</p>}
    <p className="mt-1 line-clamp-2 break-words text-sm leading-6 text-muted-foreground">{letter.contentText||'打开草稿查看正文'}</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">草稿 · 未发送 · {formatRelative(letter.updatedAt)}</p>
   </div>
   <Button type="button" className="min-h-11 shrink-0 self-start sm:self-center" disabled={busy} aria-label={'审核草稿：'+(letter.subject||'无主题')} onClick={()=>onOpenDraft(letter)}><FilePenLine className="h-4 w-4" aria-hidden/>审核草稿</Button>
  </li>)}</ul>
  {feed.totalPages>1&&<div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t pt-3"><Button type="button" variant="outline" className="min-h-11" disabled={feed.loading||feed.page<=1} onClick={()=>feed.setPage(feed.page-1)}>上一页草稿</Button><span className="text-sm tabular-nums text-muted-foreground">{feed.page} / {feed.totalPages}</span><Button type="button" variant="outline" className="min-h-11" disabled={feed.loading||feed.page>=feed.totalPages} onClick={()=>feed.setPage(feed.page+1)}>下一页草稿</Button></div>}
 </section>;
}
