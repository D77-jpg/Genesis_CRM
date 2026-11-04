import * as React from 'react';
import { CreditCard, FileText, Loader2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/use-ui';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { BillingInvoice, Organization, PlanDefinition, UsageSummary } from '@/types';

interface CurrentOrganizationResponse {
  organization: Organization;
  plans: PlanDefinition[];
  usage?: UsageSummary;
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function quota(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function BillingPage(): React.JSX.Element {
  const { t } = useI18n();
  const [organization, setOrganization] = React.useState<Organization | null>(null);
  const [plans, setPlans] = React.useState<PlanDefinition[]>([]);
  const [usage, setUsage] = React.useState<UsageSummary | null>(null);
  const [invoices, setInvoices] = React.useState<BillingInvoice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  usePageTitle(t('billing.title'));

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [current, summary, invoiceList] = await Promise.all([
        apiGet<CurrentOrganizationResponse>('/organizations/current'),
        apiGet<UsageSummary>('/organizations/current/usage'),
        apiGet<BillingInvoice[]>('/organizations/current/invoices'),
      ]);
      setOrganization(current.organization);
      setPlans(current.plans);
      setUsage(summary);
      setInvoices(invoiceList);
      setError(null);
    } catch (reason) {
      setError(toErrorMessage(reason, t('errors.generic')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => { void load(); }, [load]);

  const createDraft = async (): Promise<void> => {
    setCreating(true);
    try {
      await apiPost<BillingInvoice>('/organizations/current/invoices', {});
      toast.success(t('billing.draftCreated'));
      await load();
    } catch (reason) {
      toast.error(t('errors.generic'), { description: toErrorMessage(reason) });
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="workspace-page"><PageHeader title={t('billing.title')} /><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div></div>;
  }
  if (error || !organization || !usage) {
    return <div className="workspace-page"><PageHeader title={t('billing.title')} /><Card><CardContent className="py-8 text-sm text-destructive">{error ?? t('errors.generic')}</CardContent></Card></div>;
  }

  return (
    <div className="workspace-page space-y-4">
      <PageHeader
        title={t('billing.title')}
        description={t('billing.subtitle')}
        actions={<Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('common.refresh')}</Button>}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label={t('billing.currentUsage')} value={money(usage.estimatedInvoiceUsd)} hint={`${t('billing.period')}: ${usage.period}`} icon={<CreditCard className="h-4 w-4" />} tone="primary" />
        <StatCard label={t('org.emails')} value={usage.usage.emails.toLocaleString()} hint={t('billing.limitEmails', { value: quota(usage.limits.monthlyEmails) })} />
        <StatCard label={t('org.aiTokens')} value={usage.usage.ai_tokens.toLocaleString()} hint={t('billing.limitTokens', { value: quota(usage.limits.monthlyAiTokens) })} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('org.planLimits')}</CardTitle>
          <CardDescription>{t('billing.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => {
            const active = plan.id === organization.plan;
            return (
              <div key={plan.id} className={`rounded-lg border p-4 ${active ? 'border-primary/50 bg-primary/[0.03]' : ''}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{t(`billing.plan.${plan.id}` as 'billing.plan.starter')}</p>
                  {active ? <Badge variant="developed">{t('org.currentPlan')}</Badge> : null}
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{money(plan.monthlyPriceUsd)}<span className="text-xs font-normal text-muted-foreground">{t('billing.perMonth')}</span></p>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <li>{t('billing.limitUsers', { value: plan.limits.users })}</li>
                  <li>{t('billing.limitProjects', { value: plan.limits.projects })}</li>
                  <li>{t('billing.limitEmails', { value: quota(plan.limits.monthlyEmails) })}</li>
                  <li>{t('billing.limitTokens', { value: quota(plan.limits.monthlyAiTokens) })}</li>
                  <li>{t('billing.limitStorage', { value: (plan.limits.storageBytes / 1024 ** 3).toFixed(0) })}</li>
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{t('billing.invoices')}</CardTitle>
            <CardDescription>{t('billing.invoicesDesc')}</CardDescription>
          </div>
          <Button size="sm" onClick={() => void createDraft()} disabled={creating}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('billing.createDraft')}</Button>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">{t('billing.noInvoices')}</p> : (
            <div className="divide-y">
              {invoices.map((invoice) => (
                <div key={invoice._id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{invoice.number}</span><span className="text-muted-foreground">{invoice.period}</span></div>
                  <div className="flex items-center gap-3">
                    <Badge variant={invoice.status === 'paid' ? 'developed' : invoice.status === 'void' ? 'muted' : 'outline'}>{t(`billing.status.${invoice.status}` as 'billing.status.draft')}</Badge>
                    <span className="tabular-nums">{money(invoice.totalUsd)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default BillingPage;
