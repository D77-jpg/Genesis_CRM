/**
 * 登录页
 * ------------------------------------------------------------------
 * 这里只做「表单校验 + 调用 store.login」，登录态与 token 持久化都在 auth.store 里。
 */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { AlertTriangle, KeyRound, LogIn, Mail, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label, FieldMessage } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { loginSchema, type LoginFormValues } from '@/lib/validators';
import { useAuthStore } from '@/store/auth.store';
import { useMetaStore } from '@/store/meta.store';
import { usePageTitle } from '@/hooks/use-ui';
import { ROUTES } from '@/constants';
import { readStorage, writeStorage } from '@/lib/utils';

const REMEMBER_KEY = 'cdlm-remembered-username';

export function LoginPage(): React.JSX.Element {
  usePageTitle('登录');
  const navigate = useNavigate();
  const location = useLocation();

  const login = useAuthStore((state) => state.login);
  const loggingIn = useAuthStore((state) => state.loggingIn);
  const loginError = useAuthStore((state) => state.loginError);
  const status = useAuthStore((state) => state.status);
  const fetchMeta = useMetaStore((state) => state.fetchMeta);

  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: readStorage<string>(REMEMBER_KEY, ''),
      password: '',
      remember: Boolean(readStorage<string>(REMEMBER_KEY, '')),
    },
    mode: 'onBlur',
  });

  // 已登录时不再停留在登录页；from 用于登录后回到原本想访问的页面
  const from = React.useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from ?? ROUTES.dashboard;
  }, [location.state]);

  React.useEffect(() => {
    if (status === 'authenticated') navigate(from, { replace: true });
  }, [status, navigate, from]);

  const onSubmit = React.useCallback(
    async (values: LoginFormValues) => {
      clearErrors();
      const ok = await login(values.username, values.password);
      if (!ok) {
        // store 里已把中文错误写进 loginError，这里补一个字段级提示便于定位
        setError('password', { message: '用户名或密码不正确' });
        return;
      }

      if (values.remember) writeStorage(REMEMBER_KEY, values.username);
      else writeStorage(REMEMBER_KEY, '');

      // 登录成功后拉一次元数据（占位符 / 公司信息 / 邮件通道）
      await fetchMeta({ force: true });
      toast.success('登录成功', { description: '欢迎回来' });
      navigate(from, { replace: true });
    },
    [login, setError, clearErrors, fetchMeta, navigate, from],
  );

  // Radix Checkbox 不是原生 input，走 watch + setValue 而不是 register，避免事件形状不匹配
  const remember = watch('remember');

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      {/* 背景装饰：柔和的径向渐变，深色模式下同样成立 */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          background:
            'radial-gradient(60rem 40rem at 15% 10%, hsl(var(--primary) / 0.10), transparent 60%),' +
            'radial-gradient(50rem 35rem at 85% 90%, hsl(var(--status-developed) / 0.10), transparent 60%)',
        }}
        aria-hidden
      />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Mail className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">客户开发信管理工具</h1>
            <p className="mt-1 text-sm text-muted-foreground">Customer Dev Letter Manager</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit(onSubmit)();
            }}
          >
            {loginError ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden />
                <AlertTitle>登录失败</AlertTitle>
                <AlertDescription>{loginError}</AlertDescription>
              </Alert>
            ) : null}

            <div>
              <Label htmlFor="login-username" invalid={Boolean(errors.username)}>
                <User className="mr-1 h-3.5 w-3.5" aria-hidden />
                用户名
              </Label>
              <Input
                id="login-username"
                className="mt-1.5"
                placeholder="请输入用户名"
                autoComplete="username"
                autoFocus
                invalid={Boolean(errors.username)}
                {...register('username')}
              />
              <FieldMessage error={errors.username?.message} />
            </div>

            <div>
              <Label htmlFor="login-password" invalid={Boolean(errors.password)}>
                <KeyRound className="mr-1 h-3.5 w-3.5" aria-hidden />
                密码
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="pr-16"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </div>
              <FieldMessage error={errors.password?.message} />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="login-remember"
                checked={Boolean(remember)}
                onCheckedChange={(checked) => setValue('remember', checked === true)}
              />
              <Label htmlFor="login-remember" className="cursor-pointer text-xs font-normal text-muted-foreground">
                记住用户名（不会保存密码）
              </Label>
            </div>

            <Button type="submit" className="w-full" size="lg" loading={loggingIn} disabled={loggingIn}>
              {!loggingIn ? <LogIn className="h-4 w-4" aria-hidden /> : null}
              {loggingIn ? '正在登录…' : '登录'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
