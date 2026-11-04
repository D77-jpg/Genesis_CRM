import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Boxes, Globe2 } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { usePageTitle } from '@/hooks/use-ui';
import { PRODUCT_NAME, PRODUCT_NAME_UPPER } from '@/constants/brand';

const COPY = {
  zh: {
    pricing: '价格',
    help: '帮助中心',
    login: '登录',
    back: '返回',
    rights: '保留所有权利。',
    product: '跨境 B2B 销售 CRM',
    terms: '服务条款',
    privacy: '隐私政策',
    dpa: '数据处理协议',
    sla: '服务等级协议',
  },
  en: {
    pricing: 'Pricing',
    help: 'Help center',
    login: 'Sign in',
    back: 'Back',
    rights: 'All rights reserved.',
    product: 'Cross-border B2B sales CRM',
    terms: 'Terms',
    privacy: 'Privacy',
    dpa: 'DPA',
    sla: 'SLA',
  },
} as const;

export function PublicLayout({
  title,
  description,
  children,
  showBack = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  showBack?: boolean;
}): React.JSX.Element {
  const { language, setLanguage } = useI18n();
  const copy = COPY[language];
  usePageTitle(title);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label={PRODUCT_NAME}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
              <Boxes className="h-5 w-5" aria-hidden />
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block text-sm font-semibold leading-5 tracking-tight">{PRODUCT_NAME_UPPER}</span>
              <span className="block text-[10px] leading-4 text-muted-foreground">{copy.product}</span>
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-1" aria-label="Public navigation">
            <Button asChild variant="ghost" size="sm"><Link to="/pricing">{copy.pricing}</Link></Button>
            <Button asChild variant="ghost" size="sm"><Link to="/help">{copy.help}</Link></Button>
            <Button asChild size="sm"><Link to="/login">{copy.login}</Link></Button>
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 text-xs"
              onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
              aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'}
            >
              <Globe2 className="h-3.5 w-3.5" aria-hidden />
              {language === 'zh' ? 'EN' : '中文'}
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {showBack ? (
          <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2 gap-1.5 text-muted-foreground">
            <Link to="/help"><ArrowLeft className="h-4 w-4" />{copy.back}</Link>
          </Button>
        ) : null}
        <div className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h1>
          {description ? <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">{description}</p> : null}
        </div>
        <div className="mt-8">{children}</div>
      </main>

      <footer className="border-t border-border/70 bg-muted/20">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {PRODUCT_NAME}. {copy.rights}</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legal">
            <Link className="hover:text-foreground" to="/legal/terms">{copy.terms}</Link>
            <Link className="hover:text-foreground" to="/legal/privacy">{copy.privacy}</Link>
            <Link className="hover:text-foreground" to="/legal/dpa">{copy.dpa}</Link>
            <Link className="hover:text-foreground" to="/legal/sla">{copy.sla}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
