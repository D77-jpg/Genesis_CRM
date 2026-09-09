/**
 * 重置密码弹窗（仅管理员）
 * ------------------------------------------------------------------
 * 管理员为指定账号设置新密码；后端 bcrypt 重新哈希，原密码即刻失效。
 * 允许重置自己的密码（不影响管理员身份），也用于业务员忘记初始密码时兜底。
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { KeyRound, TriangleAlert } from 'lucide-react';
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
import { Label, FieldMessage, RequiredMark } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  defaultResetPasswordFormValues,
  resetPasswordFormSchema,
  type ResetPasswordFormValues,
} from '@/lib/validators';
import { useUserStore } from '@/store/user.store';
import { useSaveShortcut } from '@/hooks/use-ui';
import type { UserDto } from '@/types';

export interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标账号；为空时弹窗不渲染内容 */
  user: UserDto | null;
}

export function ResetPasswordDialog({
  open,
  onOpenChange,
  user,
}: ResetPasswordDialogProps): React.JSX.Element {
  const resetPassword = useUserStore((state) => state.resetPassword);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { ...defaultResetPasswordFormValues },
    mode: 'onBlur',
  });

  // 每次打开清空上一次输入
  React.useEffect(() => {
    if (open) {
      reset({ ...defaultResetPasswordFormValues });
      setServerError(null);
    }
  }, [open, reset]);

  const submit = React.useCallback(async () => {
    if (!user) return;
    await handleSubmit(async (values) => {
      setSubmitting(true);
      setServerError(null);
      try {
        await resetPassword(user.id, values.password);
        toast.success('密码已重置', {
          description: `请将新密码转告 ${user.displayName || user.username}`,
        });
        onOpenChange(false);
      } catch (error) {
        setServerError(error instanceof Error ? error.message : '重置密码失败，请稍后重试');
      } finally {
        setSubmitting(false);
      }
    })();
  }, [handleSubmit, user, resetPassword, onOpenChange]);

  useSaveShortcut(() => {
    if (open && !submitting) void submit();
  }, open && !submitting);

  const who = user ? user.displayName || user.username : '';

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden />
            重置密码
          </DialogTitle>
          <DialogDescription>
            为 <span className="font-medium text-foreground">{who}</span> 设置新密码，原密码立即失效。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {serverError ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          <form
            id="reset-password-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div>
              <Label htmlFor="reset-password" invalid={Boolean(errors.password)}>
                新密码
                <RequiredMark />
              </Label>
              <Input
                id="reset-password"
                type="password"
                className="mt-1.5"
                placeholder="至少 6 位"
                autoComplete="new-password"
                invalid={Boolean(errors.password)}
                {...register('password')}
              />
              <FieldMessage error={errors.password?.message} hint="6-72 位；重置后请转告本人" />
            </div>
          </form>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="reset-password-form" loading={submitting}>
            确认重置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
