import * as React from 'react';
import { Building2, Globe2, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePageTitle } from '@/hooks/use-ui';
import { apiGet, apiPatch, apiPost, toErrorMessage } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { Organization, OrganizationPlan, UsageSummary } from '@/types';

interface PlatformOverview {
  organizations: number;
  activeSubscriptions: number;
  projects: number;
  users: number;
  period: string;
  emailsThisMonth: number;
}

interface PlatformOrganization extends Organization {
  usage: UsageSummary;
  counts: { users: number; projects: number };
}

const EMPTY_FORM = {
  name: '',
  slug: '',
  plan: 'starter' as OrganizationPlan,
  adminUsername: '',
  adminPassword: '',
  adminEmail: '',
};

export function PlatformPage(): React.JSX.Element {
  const { t, language } = useI18n();
  const [overview, setOverview] = React.useState<PlatformOverview | null>(null);
  const [organizations, setOrganizations] = React.useState<PlatformOrganization[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);
  usePageTitle(t('platform.title'));

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [summary, list] = await Promise.all([
        apiGet<PlatformOverview>('/platform/overview'),
        apiGet<PlatformOrganization[]>('/platform/organizations'),
      ]);
      setOverview(summary);
      setOrganizations(list);
      setError(null);
    } catch (reason) {
      setError(toErrorMessage(reason, t('errors.generic')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => { void load(); }, [load]);

  const create = async (): Promise<void> => {
    setSaving(true);
    try {
      await apiPost<Organization>('/platform/organizations', {
        ...form,
        slug: form.slug.trim() || undefined,
        adminEmail: form.adminEmail.trim() || undefined,
      });
      toast.success(t('platform.orgCreated'));
      setOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (reason) {
      toast.error(t('errors.generic'), { description: toErrorMessage(reason) });
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (org: PlatformOrganization): Promise<void> => {
    try {
      await apiPatch<Organization>(`/platform/organizations/${org.id}`, { status: org.status === 'active' ? 'suspended' : 'active' });
      toast.success(t('platform.updated'));
      await load();
    } catch (reason) {
      toast.error(t('errors.generic'), { description: toErrorMessage(reason) });
    }
  };

  return (
    <div className="workspace-page space-y-4">
      <PageHeader
        title={t('platform.title')}
        description={t('platform.subtitle')}
        actions={<>
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('common.refresh')}</Button>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t('platform.create')}</Button>
        </>}
      />

      {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</div> : null}
      {error ? <Card><CardContent className="py-8 text-sm text-destructive">{error}</CardContent></Card> : null}

      {overview ? (
        <div className="grid gap-4 md:grid-cols-5">
          <StatCard label={t('platform.totalOrganizations')} value={overview.organizations} icon={<Building2 className="h-4 w-4" />} />
          <StatCard label={t('platform.activeSubscriptions')} value={overview.activeSubscriptions} icon={<ShieldCheck className="h-4 w-4" />} tone="developed" />
          <StatCard label={t('platform.totalUsers')} value={overview.users} />
          <StatCard label={t('platform.totalProjects')} value={overview.projects} />
          <StatCard label={t('platform.emailsThisMonth')} value={overview.emailsThisMonth.toLocaleString()} hint={overview.period} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe2 className="h-4 w-4" />{t('platform.organizations')}</CardTitle>
          <CardDescription>{t('platform.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {organizations.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t('platform.empty')}</p> : (
            <div className="divide-y">
              {organizations.map((org) => (
                <div key={org.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{org.name}</p>
                      <Badge variant={org.status === 'active' ? 'developed' : org.status === 'suspended' ? 'failed' : 'warning'}>{org.status}</Badge>
                      <Badge variant="outline">{t(`billing.plan.${org.plan}` as 'billing.plan.starter')}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {org.slug} · {t('platform.counts', { users: org.counts.users, projects: org.counts.projects })} · {org.usage.usage.emails.toLocaleString()} {t('org.emails').toLowerCase()} · {new Date(org.createdAt).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN')}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void toggleStatus(org)}>
                    {org.status === 'active' ? t('platform.suspend') : t('platform.activate')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform.create')}</DialogTitle>
            <DialogDescription>{t('platform.createDesc')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="platform-name">{t('platform.name')}</Label><Input id="platform-name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="platform-slug">{t('platform.slug')}</Label><Input id="platform-slug" value={form.slug} onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label htmlFor="platform-plan">{t('platform.plan')}</Label><select id="platform-plan" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.plan} onChange={(event) => setForm((prev) => ({ ...prev, plan: event.target.value as OrganizationPlan }))}><option value="starter">Starter</option><option value="growth">Growth</option><option value="enterprise">Enterprise</option></select></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="platform-username">{t('platform.adminUsername')}</Label><Input id="platform-username" value={form.adminUsername} onChange={(event) => setForm((prev) => ({ ...prev, adminUsername: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="platform-password">{t('platform.adminPassword')}</Label><Input id="platform-password" type="password" value={form.adminPassword} onChange={(event) => setForm((prev) => ({ ...prev, adminPassword: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="platform-email">{t('platform.adminEmail')}</Label><Input id="platform-email" type="email" value={form.adminEmail} onChange={(event) => setForm((prev) => ({ ...prev, adminEmail: event.target.value }))} /></div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void create()} disabled={saving || !form.name.trim() || form.adminUsername.trim().length < 3 || form.adminPassword.length < 10}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t('platform.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PlatformPage;
