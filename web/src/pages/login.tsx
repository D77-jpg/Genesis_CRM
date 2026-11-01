/**
 * 登录页
 * ------------------------------------------------------------------
 * 这里只做「表单校验 + 调用 store.login」，登录态与 token 持久化都在 auth.store 里。
 *
 * 视觉上采用「外贸货运场景 + 右侧悬浮登录卡」的布局：左侧讲清楚业务闭环，
 * 右侧只保留登录所需动作，避免把登录页做成营销落地页。
 */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  FileText,
  Factory,
  Globe,
  Handshake,
  Inbox,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Truck,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label, FieldMessage } from '@/components/ui/label';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { loginSchema, type LoginFormValues } from '@/lib/validators';
import { useAuthStore } from '@/store/auth.store';
import { useMetaStore } from '@/store/meta.store';
import { usePageTitle } from '@/hooks/use-ui';
import { ROUTES } from '@/constants';
import { readStorage, writeStorage } from '@/lib/utils';

const REMEMBER_KEY = 'cdlm-remembered-username';

const FLOW_STEPS: Array<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  en: string;
}> = [
  { icon: Inbox, label: '询盘', en: 'Inquiry' },
  { icon: FileText, label: '报价', en: 'Quotation' },
  { icon: Handshake, label: '订单', en: 'Order' },
  { icon: Factory, label: '生产', en: 'Production' },
  { icon: Truck, label: '出货', en: 'Shipping' },
];

function LoginMark(): React.JSX.Element {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.9rem] bg-slate-950 text-white shadow-[0_8px_24px_-12px_rgba(15,23,42,0.6)]">
      <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden>
        <path d="M16 3.5 27 10v12L16 28.5 5 22V10L16 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="m10.5 18.5 5.5-3.2 5.5 3.2M10.5 13.5l5.5-3.2 5.5 3.2M16 15.3v9.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function BrandLockup(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 text-slate-950 dark:text-white">
      <LoginMark />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-5 tracking-[0.015em]">GLOBAL CRM</p>
        <p className="mt-0.5 truncate text-[11px] leading-4 text-slate-600 dark:text-slate-300">Export Business Management Hub</p>
      </div>
    </div>
  );
}

function FlowStep({
  icon: Icon,
  label,
  en,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  en: string;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-white/90 bg-white text-slate-950 shadow-[0_2px_8px_rgba(15,23,42,0.12)] dark:border-white/25 dark:bg-slate-900 dark:text-white">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="mt-3 text-[14px] font-semibold leading-4 text-slate-950 dark:text-white">{label}</span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.13em] text-slate-800 dark:text-slate-100">{en}</span>
    </div>
  );
}

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
    <div className="login-page relative min-h-screen overflow-hidden bg-slate-200" style={{ colorScheme: 'light' }}>
      <img
        src="/login/export-logistics.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      {/* 左侧轻微提亮保证深色标题可读；底部压暗避免浅色图片与白色卡片同时发灰。 */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.46)_0%,rgba(255,255,255,0.16)_42%,rgba(255,255,255,0.02)_68%,rgba(15,23,42,0.1)_100%)] dark:bg-[linear-gradient(90deg,rgba(2,6,23,0.54)_0%,rgba(2,6,23,0.2)_48%,rgba(2,6,23,0.24)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-slate-950/20 to-transparent" />

      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex h-[84px] max-w-[1600px] items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-20">
          <BrandLockup />
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/45 bg-white/25 px-3.5 py-2 text-xs font-medium text-slate-700 backdrop-blur-md sm:inline-flex dark:border-white/15 dark:bg-white/10 dark:text-slate-200">
              <Globe className="h-3.5 w-3.5" aria-hidden />
              简体中文
            </span>
            <ThemeToggle className="text-slate-800 hover:bg-white/45 hover:text-slate-950 dark:text-white dark:hover:bg-white/15 dark:hover:text-white" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1600px] grid-cols-1 items-center gap-8 px-5 pb-10 pt-28 sm:px-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12 lg:px-12 lg:pb-14 lg:pt-24 xl:grid-cols-[minmax(0,1fr)_512px] xl:pl-20 xl:pr-10">
        <section className="hidden min-w-0 lg:block" aria-label="产品介绍">
          <div className="max-w-[720px]">
            <p className="text-[11px] font-semibold tracking-[0.3em] text-slate-700 dark:text-slate-200">FROM INQUIRY TO GLOBAL GROWTH</p>
            <h1 className="mt-5 text-[clamp(2.9rem,4.2vw,4.55rem)] font-semibold leading-[1.02] tracking-[-0.055em] text-slate-950 dark:text-white">
              Simplify
              <br />
              Your Export Business.
              <br />
              <span className="text-slate-500 dark:text-slate-300">All in One CRM.</span>
            </h1>
            <p className="mt-6 max-w-[570px] text-[15px] leading-7 text-slate-700 dark:text-slate-200">
              从询盘、客户、报价到订单与出货，把外贸业务的每个关键节点放进同一个工作台，让团队少一点来回确认，多一点成交推进。
            </p>

            <div className="mt-10 flex max-w-[650px] items-start justify-between gap-1.5 xl:mt-12 xl:max-w-[690px]">
              {FLOW_STEPS.map((step, index) => (
                <React.Fragment key={step.en}>
                  <FlowStep {...step} />
                  {index < FLOW_STEPS.length - 1 ? (
                    <ArrowRight className="mt-4 h-4 w-4 shrink-0 text-slate-900 dark:text-white" aria-hidden />
                  ) : null}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[32rem] lg:mx-0 lg:justify-self-end" aria-label="登录">
          <div className="rounded-[1.75rem] border border-white/75 bg-white/95 p-6 text-slate-950 shadow-[0_28px_80px_-36px_rgba(15,23,42,0.48),0_2px_12px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:p-10 dark:border-white/10 dark:bg-slate-950/90 dark:text-white">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.22em] text-[#7658f6] dark:text-[#b7a6ff]">WELCOME BACK</p>
              <h2 className="mt-2 text-[2.15rem] font-semibold leading-tight tracking-[-0.045em] text-slate-950 dark:text-white">欢迎回来</h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400">登录你的 GLOBAL CRM 工作空间</p>
            </div>

            <form
              className="mt-8 space-y-5"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit(onSubmit)();
              }}
            >
              {loginError ? (
                <div role="alert" className="flex gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-5 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div>
                    <p className="font-medium">登录失败</p>
                    <p className="mt-0.5 text-rose-600/90 dark:text-rose-200/80">{loginError}</p>
                  </div>
                </div>
              ) : null}

              <div>
                <Label htmlFor="login-username" className="sr-only">
                  用户名
                </Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden />
                  <Input
                    id="login-username"
                    className="h-[52px] rounded-xl border-slate-200 bg-white pl-12 pr-4 text-[15px] text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.03)] placeholder:text-slate-400 focus-visible:border-[#8a70ff] focus-visible:ring-[#8a70ff]/15 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
                    placeholder="请输入用户名"
                    autoComplete="username"
                    autoFocus
                    invalid={Boolean(errors.username)}
                    {...register('username')}
                  />
                </div>
                <FieldMessage error={errors.username?.message} className="pl-1" />
              </div>

              <div>
                <Label htmlFor="login-password" className="sr-only">
                  密码
                </Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden />
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    className="h-[52px] rounded-xl border-slate-200 bg-white pl-12 pr-12 text-[15px] text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.03)] placeholder:text-slate-400 focus-visible:border-[#8a70ff] focus-visible:ring-[#8a70ff]/15 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a70ff]/30 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                  </button>
                </div>
                <FieldMessage error={errors.password?.message} className="pl-1" />
              </div>

              <div className="flex items-center justify-between gap-3 pt-0.5">
                <label htmlFor="login-remember" className="flex cursor-pointer items-center gap-2.5 text-[13px] text-slate-600 dark:text-slate-300">
                  <Checkbox
                    id="login-remember"
                    checked={Boolean(remember)}
                    onCheckedChange={(checked) => setValue('remember', checked === true)}
                    className="border-slate-300 bg-white data-[state=checked]:border-[#7658f6] data-[state=checked]:bg-[#7658f6] dark:border-white/20 dark:bg-slate-900"
                  />
                  记住用户名
                </label>
                <button
                  type="button"
                  onClick={() => toast.info('请联系系统管理员重置密码')}
                  className="text-[13px] font-medium text-[#6547ee] transition-colors hover:text-[#4c2fd1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a70ff]/30 dark:text-[#b7a6ff] dark:hover:text-[#d4c9ff]"
                >
                  忘记密码？
                </button>
              </div>

              <Button type="submit" className="login-submit mt-2 h-[52px] w-full rounded-xl text-[15px] font-semibold" size="lg" loading={loggingIn} disabled={loggingIn}>
                {loggingIn ? '正在登录…' : (
                  <>
                    登录
                    <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
                  </>
                )}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" aria-hidden />
              <span className="text-[11px] text-slate-400 dark:text-slate-500">或</span>
              <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" aria-hidden />
            </div>

            <button
              type="button"
              onClick={() => toast.info('请联系系统管理员开通账号')}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a70ff]/25 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <Mail className="h-[18px] w-[18px] text-slate-500 dark:text-slate-400" aria-hidden />
              联系管理员开通账号
            </button>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] leading-5 text-slate-400 dark:text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              仅限授权成员使用 · 登录信息加密传输
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
