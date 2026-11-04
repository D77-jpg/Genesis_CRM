import * as React from 'react';
import { Building2, Gauge, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePageTitle } from '@/hooks/use-ui';
import { apiGet, apiPut, toErrorMessage } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useAuthStore } from '@/store/auth.store';
import type { Organization, PlanDefinition, UsageSummary } from '@/types';

interface CurrentOrganizationResponse {
  organization: Organization;
  plans: PlanDefinition[];
  usage?: UsageSummary;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 GB';
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function OrganizationPage(): React.JSX.Element {
  const { t, language } = useI18n();
  const role = useAuthStore((state) => state.user?.role);
  const canEdit = role === 'admin';
  const [data, setData] = React.useState<CurrentOrganizationResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ name: '', billingEmail: '', billingAddress: '', taxId: '', currency: 'USD' });
  usePageTitle(t('org.title'));

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiGet<CurrentOrganizationResponse>('/organizations/current');
      setData(result);
      setForm({
        name: result.organization.name,
        billingEmail: result.organization.billingEmail ?? '',
        billingAddress: result.organization.billingAddress ?? '',
        taxId: result.organization.taxId ?? '',
        currency: result.organization.currency,
      });
      setError(null);
    } catch (reason) {
      setError(toErrorMessage(reason, t('errors.generic')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => { void load(); }, [load]);

  const save = async (): Promise<void> => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const updated = await apiPut<Organization>('/organizations/current', form);
      setData((prev) => prev ? { ...prev, organization: updated } : prev);
      toast.success(t('org.saved'));
    } catch (reason) {
      toast.error(t('errors.generic'), { description: toErrorMessage(reason) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="workspace-page"><PageHeader title={t('org.title')} /><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div></div>;
  }
  if (error || !data) {
    return <div className="workspace-page"><PageHeader title={t('org.title')} /><Card><CardContent className="py-8 text-sm text-destructive">{error ?? t('errors.generic')}</CardContent></Card></div>;
  }

  const { organization, usage } = data;
  const planLabel = t(`billing.plan.${organization.plan}` as 'billing.plan.starter');

  return (
    <div className="workspace-page space-y-4">
      <PageHeader
        title={t('org.title')}
        description={t('org.subtitle')}
        actions={<Button variant="outline" onClick={() => void load()}><Gauge className="h-4 w-4" />{t('common.refresh')}</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" />{t('org.profileTitle')}</CardTitle>
            <CardDescription>{t('org.profileDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">{t('org.name')}</Label>
                <Input id="org-name" value={form.name} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('org.slug')}</Label>
                <Input value={organization.slug} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-billing-email">{t('org.billingEmail')}</Label>
                <Input id="org-billing-email" type="email" value={form.billingEmail} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, billingEmail: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-tax-id">{t('org.taxId')}</Label>
                <Input id="org-tax-id" value={form.taxId} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, taxId: event.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-address">{t('org.billingAddress')}</Label>
              <Input id="org-address" value={form.billingAddress} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, billingAddress: event.target.value }))} />
            </div>
            {canEdit ? (
              <div className="flex justify-end">
                <Button onClick={() => void save()} disabled={saving || !form.name.trim()}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('org.currentPlan')}</CardTitle>
              <CardDescription>{planLabel} · {organization.subscriptionStatus}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('org.status')}</span><Badge variant={organization.status === 'active' ? 'developed' : 'warning'}>{organization.status}</Badge></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('org.plan')}</span><span className="font-medium">{planLabel}</span></div>
              {organization.trialEndsAt ? <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('org.trialEnds')}</span><span>{new Date(organization.trialEndsAt).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN')}</span></div> : null}
              <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('org.currency')}</span><span>{organization.currency}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('org.planLimits')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('org.users')}</span><span>{organization.limits.users}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('org.projects')}</span><span>{organization.limits.projects}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('org.emails')}</span><span>{organization.limits.monthlyEmails.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('org.aiTokens')}</span><span>{organization.limits.monthlyAiTokens.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('org.storage')}</span><span>{formatBytes(organization.limits.storageBytes)}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>

      {usage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('org.usageTitle')}</CardTitle>
            <CardDescription>{t('org.usageDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {[
              { label: t('org.emails'), value: usage.usage.emails, percent: usage.percentages.emails },
              { label: t('org.aiTokens'), value: usage.usage.ai_tokens, percent: usage.percentages.ai_tokens },
              { label: t('org.storage'), value: usage.usage.storage_bytes, percent: usage.percentages.storage_bytes },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{item.label}</span><span className="tabular-nums">{item.label === t('org.storage') ? formatBytes(item.value) : item.value.toLocaleString()}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, item.percent))}%` }} /></div>
                <p className="text-right text-[11px] text-muted-foreground">{item.percent}%</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default OrganizationPage;
