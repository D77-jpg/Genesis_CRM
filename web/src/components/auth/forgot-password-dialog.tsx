/**
 * 忘记密码弹窗：只提交用户名，服务端统一返回「已发送」以防账号枚举。
 */
import * as React from 'react';
import { KeyRound, MailCheck, TriangleAlert } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiPost, toErrorMessage } from '@/lib/api';

export interface ForgotPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ForgotPasswordDialog({ open, onOpenChange }: ForgotPasswordDialogProps): React.JSX.Element {
  const [username, setUsername] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setUsername('');
      setSent(false);
      setError(null);
    }
  }, [open]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!username.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiPost('/auth/forgot-password', { username: username.trim() });
      setSent(true);
    } catch (err) {
      setError(toErrorMessage(err, '发送失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden />
            忘记密码
          </DialogTitle>
          <DialogDescription>
            输入登录用户名，我们会向账号绑定的邮箱发送重置链接。链接 30 分钟内有效。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {sent ? (
            <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">如果账号存在，重置邮件已发送</p>
                <p className="mt-1 text-emerald-700/80 dark:text-emerald-200/80">
                  请检查邮箱（包括垃圾箱）。未收到时请联系管理员确认账号是否已绑定邮箱。
                </p>
              </div>
            </div>
          ) : (
            <form id="forgot-password-form" className="space-y-4" onSubmit={(event) => void submit(event)}>
              <div>
                <Label htmlFor="forgot-username">用户名</Label>
                <Input
                  id="forgot-username"
                  className="mt-1.5"
                  placeholder="请输入登录用户名"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
            </form>
          )}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {sent ? '关闭' : '取消'}
          </Button>
          {sent ? null : (
            <Button type="submit" form="forgot-password-form" loading={submitting} disabled={!username.trim()}>
              发送重置邮件
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
