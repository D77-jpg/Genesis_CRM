/**
 * 开发信查看弹窗
 * ------------------------------------------------------------------
 * 支持：查看渲染后的正文、复制主题/正文、重新发送、删除。
 * 正文是后端已渲染的 HTML（占位符取值经过转义），直接展示是安全的。
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Clock,
  Copy,
  FileText,
  Hash,
  Mail,
  RotateCw,
  Trash2,
  User,
} from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';
import { LetterStatusBadge } from '@/components/common/status-badge';
import { MailInteractionSummary } from '@/components/letters/mail-interaction-summary';
import { copyToClipboard, formatDateTime, htmlToPlainText } from '@/lib/format';
import { MAIL_CHANNEL_LABEL } from '@/constants';
import { cn } from '@/lib/utils';
import type { DevelopmentLetter } from '@/types';

export interface LetterViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  letter: DevelopmentLetter | null;
  /** 点「重新发送」：父级打开 SendLetterDialog 并带出原模板 */
  onResend?: (letter: DevelopmentLetter) => void;
  /** 点「删除」：父级弹二次确认 */
  onDelete?: (letter: DevelopmentLetter) => void;
  /** 跳转到客户详情（在「开发信记录」页使用） */
  onOpenCustomer?: (customerId: string) => void;
}

/** 一行元信息 */
function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{children}</dd>
    </div>
  );
}

export function LetterViewDialog({
  open,
  onOpenChange,
  letter,
  onResend,
  onDelete,
  onOpenCustomer,
}: LetterViewDialogProps): React.JSX.Element {
  const [copied, setCopied] = React.useState<'subject' | 'html' | 'text' | null>(null);

  // 关闭后清掉「已复制」提示
  React.useEffect(() => {
    if (!open) setCopied(null);
  }, [open]);

  const copy = React.useCallback(async (kind: 'subject' | 'html' | 'text', text: string, label: string) => {
    if (!text.trim()) {
      toast.warning('内容为空，无法复制');
      return;
    }
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(kind);
      toast.success(`${label}已复制到剪贴板`);
      window.setTimeout(() => setCopied(null), 2000);
    } else {
      toast.error('复制失败', { description: '浏览器拒绝了剪贴板访问，请手动选择文本复制' });
    }
  }, []);

  if (!letter) {
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>开发信</DialogTitle></DialogHeader></DialogContent></Dialog>;
  }

  const plainText = letter.contentText || htmlToPlainText(letter.content);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 break-words">{letter.subject || '（无主题）'}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <LetterStatusBadge status={letter.status} />
            <span>{MAIL_CHANNEL_LABEL[letter.channel] ?? letter.channel}</span>
            {letter.sentAt ? <span>· 发送于 {formatDateTime(letter.sentAt)}</span> : <span>· 尚未发送</span>}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {letter.status === 'failed' && letter.error ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertTitle>发送失败</AlertTitle>
              <AlertDescription>{letter.error}</AlertDescription>
            </Alert>
          ) : null}

          <dl className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
            <MetaRow icon={<User className="h-3.5 w-3.5" aria-hidden />} label="收件人：">
              {letter.recipientName || '—'}
              {onOpenCustomer && letter.customer ? (
                <button
                  type="button"
                  className="ml-2 text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenCustomer(letter.customerId)}
                >
                  查看客户
                </button>
              ) : null}
            </MetaRow>
            <MetaRow icon={<Mail className="h-3.5 w-3.5" aria-hidden />} label="邮箱：">
              <a
                href={`mailto:${letter.recipientEmail}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {letter.recipientEmail || '—'}
              </a>
            </MetaRow>
            <MetaRow icon={<Clock className="h-3.5 w-3.5" aria-hidden />} label="创建时间：">
              {formatDateTime(letter.createdAt)}
            </MetaRow>
            <MetaRow icon={<Hash className="h-3.5 w-3.5" aria-hidden />} label="Message-ID：">
              <span className="break-all font-mono text-2xs">{letter.messageId || '—'}</span>
            </MetaRow>
          </dl>

          {['sent', 'opened'].includes(letter.status) ? <MailInteractionSummary sentAt={letter.sentAt} tracking={letter.tracking} detailed /> : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">邮件正文（占位符已替换）</p>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void copy('subject', letter.subject, '主题')}
                >
                  <Copy className="h-3 w-3" aria-hidden />
                  {copied === 'subject' ? '已复制' : '复制主题'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void copy('text', plainText, '纯文本正文')}
                >
                  <Copy className="h-3 w-3" aria-hidden />
                  {copied === 'text' ? '已复制' : '复制纯文本'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void copy('html', letter.content, 'HTML 正文')}
                >
                  <Copy className="h-3 w-3" aria-hidden />
                  {copied === 'html' ? '已复制' : '复制 HTML'}
                </Button>
              </div>
            </div>

            <div
              className={cn(
                'mail-preview max-h-[24rem] overflow-y-auto rounded-md border bg-background p-4',
                !letter.content && 'text-center text-sm text-muted-foreground',
              )}
              dangerouslySetInnerHTML={{ __html: letter.content || '<p>（无正文）</p>' }}
            />
          </div>

          {letter.template && letter.template !== letter.content ? (
            <details className="rounded-md border bg-muted/20 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                查看原始模板（含 {'{{占位符}}'}）
              </summary>
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed">
                {letter.template}
              </pre>
            </details>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDelete(letter)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              删除
            </Button>
          ) : null}

          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>

          {onResend ? (
            <>
              <Separator orientation="vertical" className="hidden h-6 sm:block" />
              <Button
                type="button"
                onClick={() => onResend(letter)}
                disabled={letter.status === 'draft'}
                title={letter.status === 'draft' ? '草稿请直接编辑后发送' : undefined}
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden />
                重新发送
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
