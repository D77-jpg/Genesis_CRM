import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Circle, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-ui';
import { useProjectStore } from '@/store/project.store';
import { selectCanManageProjects, useAuthStore } from '@/store/auth.store';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { useI18n, type TranslationKey } from '@/i18n';

interface OnboardingStep {
  key: 'brand' | 'products' | 'playbook' | 'mailbox' | 'team' | 'ai';
  done: boolean;
  href: string;
  optional?: boolean;
  title: { zh: string; en: string };
  description: { zh: string; en: string };
}
interface OnboardingStatus {
  projectId: string;
  projectName: string;
  completedAt?: string;
  ready: boolean;
  completed: boolean;
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
}

const STEP_TITLE_KEY: Record<OnboardingStep['key'], TranslationKey> = {
  brand: 'onboarding.step.brand',
  products: 'onboarding.step.products',
  playbook: 'onboarding.step.playbook',
  mailbox: 'onboarding.step.mailbox',
  team: 'onboarding.step.team',
  ai: 'onboarding.step.ai',
};
const STEP_DESC_KEY: Record<OnboardingStep['key'], TranslationKey> = {
  brand: 'onboarding.step.brandDesc',
  products: 'onboarding.step.productsDesc',
  playbook: 'onboarding.step.playbookDesc',
  mailbox: 'onboarding.step.mailboxDesc',
  team: 'onboarding.step.teamDesc',
  ai: 'onboarding.step.aiDesc',
};

export function OnboardingPage(): React.JSX.Element {
  const { t, language } = useI18n();
  usePageTitle(t('onboarding.title'));
  const navigate = useNavigate();
  const activeProject = useProjectStore((state) => state.activeProject);
  const canManage = useAuthStore(selectCanManageProjects);
  const [status, setStatus] = React.useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [completing, setCompleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await apiGet<OnboardingStatus>('/projects/onboarding'));
    } catch (error) {
      toast.error(t('errors.generic'), { description: toErrorMessage(error) });
    } finally { setLoading(false); }
  }, [t]);

  React.useEffect(() => { void load(); }, [load, activeProject?.id]);

  const complete = async () => {
    setCompleting(true);
    try {
      setStatus(await apiPost<OnboardingStatus>('/projects/onboarding/complete'));
      toast.success(t('onboarding.completed'));
    } catch (error) {
      toast.error(t('errors.generic'), { description: toErrorMessage(error) });
    } finally { setCompleting(false); }
  };

  if (loading || !status) {
    return <div className="workspace-page"><PageHeader title={t('onboarding.title')} description={t('onboarding.subtitle')} />
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div></div>;
  }

  return (
    <div className="workspace-page">
      <PageHeader title={t('onboarding.title')} description={t('onboarding.subtitle')}
        actions={status.completed ? undefined : (
          <Button size="sm" loading={completing} disabled={!canManage || !status.ready} onClick={() => void complete()}>
            <Check className="h-4 w-4" aria-hidden />{completing ? t('onboarding.completing') : t('onboarding.complete')}
          </Button>
        )} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-primary" aria-hidden />{status.projectName}</CardTitle>
            <span className="text-xs text-muted-foreground">{t('onboarding.progress', { done: status.doneCount, total: status.totalCount })}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={status.totalCount} aria-valuenow={status.doneCount}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${status.totalCount ? (status.doneCount / status.totalCount) * 100 : 0}%` }} />
          </div>
          {status.completed ? <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            {t('onboarding.completed')}{status.completedAt ? ` · ${t('onboarding.completedAt', { date: new Date(status.completedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US') })}` : ''}
          </p> : null}
        </CardHeader>
        <CardContent className="space-y-2">
          {status.steps.map((step, index) => {
            const title = t(STEP_TITLE_KEY[step.key]) || step.title[language];
            const description = t(STEP_DESC_KEY[step.key]) || step.description[language];
            return (
              <div key={step.key} className="flex flex-col gap-3 rounded-lg border border-border/80 p-3 sm:flex-row sm:items-center">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                  {step.done ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {title}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-normal ${step.optional ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                      {step.optional ? t('onboarding.optional') : t('onboarding.required')}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`inline-flex items-center gap-1 text-xs ${step.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                    {step.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Circle className="h-3.5 w-3.5" aria-hidden />}
                    {step.done ? t('common.done') : t('common.pending')}
                  </span>
                  {!step.done ? <Button type="button" variant="outline" size="sm" onClick={() => navigate(step.href)}>
                    {t('onboarding.go')}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button> : null}
                </div>
              </div>
            );
          })}
          {!status.completed && !status.ready ? <p className="pt-1 text-xs text-muted-foreground">{t('onboarding.notReady')}</p> : null}
          {!canManage ? <p className="pt-1 text-xs text-muted-foreground">{t('errors.forbidden')}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
