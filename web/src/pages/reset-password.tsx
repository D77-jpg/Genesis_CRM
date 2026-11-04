/**
 * 自助重置密码页：通过邮件中的一次性 token 设置新密码。
 */
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, FieldMessage } from '@/components/ui/label';
import { usePageTitle } from '@/hooks/use-ui';
import { ROUTES } from '@/constants';
import { apiPost, toErrorMessage } from '@/lib/api';
import { passwordSchema } from '@/lib/validators';

const schema = z.object({
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((values) => values.password === values.confirmPassword, {
  path: ['confirmPassword'],
  message: '两次输入的密码不一致',
});

type Values = z.infer<typeof schema>;

export function ResetPasswordPage(): React.JSX.Element {
  usePageTitle('重置密码');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
    mode: 'onBlur',
  });

  const onSubmit = React.useCallback(async (values: Values) => {
    if (!token) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await apiPost('/auth/reset-password', { token, password: values.password });
      toast.success('密码已重置', { description: '请使用新密码重新登录' });
      navigate(ROUTES.login, { replace: true });
    } catch (error) {
      setServerError(toErrorMessage(error, '密码重置失败，链接可能已过期'));
    } finally {
      setSubmitting(false);
    }
  }, [token, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8 dark:border-white/10 dark:bg-slate-900">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
          <KeyRound className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">设置新密码</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          请输入新密码。重置后，所有已登录的浏览器会话都会失效。
        </p>

        {!token ? (
          <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
            重置链接缺少 token，请从邮件中的完整链接重新打开。
          </p>
        ) : (
          <form className="mt-6 space-y-4" noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
            {serverError ? (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
                {serverError}
              </p>
            ) : null}

            <div>
              <Label htmlFor="reset-password">新密码</Label>
              <Input
                id="reset-password"
                type="password"
                className="mt-1.5"
                placeholder="至少 10 位，大小写/数字/符号"
                autoComplete="new-password"
                invalid={Boolean(errors.password)}
                {...register('password')}
              />
              <FieldMessage error={errors.password?.message} hint="10-72 位，需包含大小写字母、数字、符号中的至少三类" />
            </div>

            <div>
              <Label htmlFor="reset-password-confirm">确认新密码</Label>
              <Input
                id="reset-password-confirm"
                type="password"
                className="mt-1.5"
                placeholder="再次输入新密码"
                autoComplete="new-password"
                invalid={Boolean(errors.confirmPassword)}
                {...register('confirmPassword')}
              />
              <FieldMessage error={errors.confirmPassword?.message} />
            </div>

            <Button type="submit" className="h-11 w-full" loading={submitting}>
              重置密码
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          重置链接 30 分钟内有效，仅可使用一次
        </p>
      </div>
    </div>
  );
}
