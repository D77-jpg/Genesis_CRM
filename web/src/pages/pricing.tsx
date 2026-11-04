import * as React from 'react';
import { ArrowRight, Check, HelpCircle, Loader2, Sparkles } from 'lucide-react';
import { PublicLayout } from '@/components/public/public-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { PlanDefinition } from '@/types';

interface PublicPlansResponse {
  currency: string;
  annualDiscountMonths: number;
  trialDays: number;
  plans: PlanDefinition[];
}

const FALLBACK: PublicPlansResponse = {
  currency: 'USD',
  annualDiscountMonths: 2,
  trialDays: 14,
  plans: [
    { id: 'starter', monthlyPriceUsd: 49, annualPriceUsd: 490, limits: { users: 5, projects: 2, monthlyEmails: 5_000, monthlyAiTokens: 1_000_000, storageBytes: 5 * 1024 ** 3 }, overage: { emailUsdPer1000: 2, aiTokensUsdPer1M: 5, storageUsdPerGb: 0.5 }, label: { zh: '入门版', en: 'Starter' } },
    { id: 'growth', monthlyPriceUsd: 149, annualPriceUsd: 1_490, limits: { users: 20, projects: 10, monthlyEmails: 50_000, monthlyAiTokens: 10_000_000, storageBytes: 50 * 1024 ** 3 }, overage: { emailUsdPer1000: 1.5, aiTokensUsdPer1M: 4, storageUsdPerGb: 0.35 }, label: { zh: '成长版', en: 'Growth' } },
    { id: 'enterprise', monthlyPriceUsd: 499, annualPriceUsd: 4_990, limits: { users: 200, projects: 100, monthlyEmails: 500_000, monthlyAiTokens: 100_000_000, storageBytes: 500 * 1024 ** 3 }, overage: { emailUsdPer1000: 1, aiTokensUsdPer1M: 3, storageUsdPerGb: 0.2 }, label: { zh: '企业版', en: 'Enterprise' } },
  ],
};

const COPY = {
  zh: {
    title: '把跨境销售流程，变成可复制的增长系统',
    subtitle: '从客户导入、开发信、回复跟进到报价，一套为外贸团队设计的多租户 CRM。先试用 14 天，按团队规模升级。',
    monthly: '按月付费',
    annual: '按年付费',
    save: '省 2 个月',
    perMonth: '/ 月',
    perYear: '/ 年',
    trial: '14 天试用',
    starterDesc: '适合刚建立外销流程的小团队。',
    growthDesc: '适合有稳定询盘和多名业务员的成长团队。',
    enterpriseDesc: '适合多品牌、多团队和更高发送量的组织。',
    popular: '最受欢迎',
    choose: '申请试用',
    talk: '联系销售',
    users: '个成员账号',
    projects: '个项目空间',
    emails: '封开发信 / 月',
    tokens: 'AI Token / 月',
    storage: 'GB 附件存储',
    overage: '超出套餐按量计费，不中断业务',
    comparison: '套餐对比',
    feature: '能力',
    featureUsers: '成员账号',
    featureProjects: '项目空间',
    featureEmails: '开发信 / 月',
    featureTokens: 'AI Token / 月',
    featureStorage: '附件存储',
    included: '包含',
    faq: '常见问题',
    faq1: '如何开始试用？',
    a1: '注册入口由平台管理员开通。提交试用申请后，我们会创建独立组织空间，并发送登录凭据和 14 天试用说明。',
    faq2: '超出额度会怎样？',
    a2: '开发信、AI Token 和存储按套餐计量。超出后按公开单价计费；达到硬上限时会暂停新增用量，但不会删除已有数据。',
    faq3: '可以随时升级或降级吗？',
    a3: '可以。升级立即生效；降级在下一个账单周期生效。年付套餐按合同约定处理。',
    faq4: '支持哪些邮件服务？',
    a4: '支持自有 SMTP 发件和 IMAP/POP3 收件，兼容主流企业邮箱。发送前会执行退订、SPF/DKIM/DMARC 与频率检查。',
    faq5: '数据归谁所有？',
    a5: '客户、邮件、附件和知识库内容归你的组织所有。我们只按服务条款和 DPA 处理数据，支持导出与删除。',
    billingNote: '当前为人工开票模式：账单以美元计价，支持月付或年付；支付网关和自动扣款将在后续版本开放。',
    ctaTitle: '准备好把外销流程跑顺了吗？',
    ctaDesc: '预约一次 30 分钟演示，我们会按你的产品、市场和团队配置试用空间。',
    ctaButton: '预约演示',
    salesSubject: 'GlobalCRM 试用咨询',
  },
  en: {
    title: 'Turn cross-border sales into a repeatable growth system',
    subtitle: 'One multi-tenant CRM for importing leads, sending outreach, handling replies and creating quotes. Start with a 14-day trial and scale with your team.',
    monthly: 'Monthly',
    annual: 'Annual',
    save: '2 months free',
    perMonth: '/ month',
    perYear: '/ year',
    trial: '14-day trial',
    starterDesc: 'For small teams building their first outbound motion.',
    growthDesc: 'For growing teams with steady inbound leads and several salespeople.',
    enterpriseDesc: 'For multi-brand, multi-team organizations with higher sending volume.',
    popular: 'Most popular',
    choose: 'Request trial',
    talk: 'Talk to sales',
    users: 'team members',
    projects: 'project workspaces',
    emails: 'outreach emails / month',
    tokens: 'AI tokens / month',
    storage: 'GB attachment storage',
    overage: 'Usage overage is metered, never a hard stop',
    comparison: 'Compare plans',
    feature: 'Capability',
    featureUsers: 'Team members',
    featureProjects: 'Project workspaces',
    featureEmails: 'Outreach emails / month',
    featureTokens: 'AI tokens / month',
    featureStorage: 'Attachment storage',
    included: 'Included',
    faq: 'Frequently asked questions',
    faq1: 'How does the trial work?',
    a1: 'Workspaces are provisioned by a platform administrator. After you request access, we create an isolated organization and send credentials plus a 14-day trial guide.',
    faq2: 'What happens when we exceed a limit?',
    a2: 'Outreach, AI tokens and storage are metered. Overage is billed at the published rates; at a hard cap new usage pauses without deleting existing data.',
    faq3: 'Can we upgrade or downgrade?',
    a3: 'Yes. Upgrades take effect immediately; downgrades take effect at the next billing period. Annual commitments follow the signed order.',
    faq4: 'Which mail providers are supported?',
    a4: 'Bring your own SMTP for sending and IMAP/POP3 for receiving, compatible with major business mailboxes. Unsubscribe, SPF/DKIM/DMARC and sending-rate checks run before delivery.',
    faq5: 'Who owns our data?',
    a5: 'Customer, email, attachment and knowledge content belongs to your organization. We process it only under the Terms and DPA, with export and deletion support.',
    billingNote: 'Billing is currently invoiced manually in USD, monthly or annually. A payment gateway and automatic charging will follow.',
    ctaTitle: 'Ready to make outbound repeatable?',
    ctaDesc: 'Book a 30-minute walkthrough. We will configure a trial workspace around your products, markets and team.',
    ctaButton: 'Book a demo',
    salesSubject: 'GlobalCRM trial inquiry',
  },
} as const;

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function compact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function PricingPage(): React.JSX.Element {
  const { language } = useI18n();
  const copy = COPY[language];
  const [annual, setAnnual] = React.useState(false);
  const [catalog, setCatalog] = React.useState<PublicPlansResponse>(FALLBACK);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    apiGet<PublicPlansResponse>('/public/plans')
      .then((value) => { if (live && value?.plans?.length) setCatalog(value); })
      .catch(() => undefined)
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const price = (plan: PlanDefinition): number => annual ? (plan.annualPriceUsd ?? plan.monthlyPriceUsd * 10) : plan.monthlyPriceUsd;
  const mailto = `mailto:sales@genesisgroup.cn?subject=${encodeURIComponent(copy.salesSubject)}`;

  return (
    <PublicLayout title={copy.title} description={copy.subtitle}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="group" aria-label="Billing period">
          <button type="button" onClick={() => setAnnual(false)} className={`rounded-md px-4 py-2 text-sm font-medium ${!annual ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{copy.monthly}</button>
          <button type="button" onClick={() => setAnnual(true)} className={`rounded-md px-4 py-2 text-sm font-medium ${annual ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{copy.annual}</button>
        </div>
        <Badge variant="outline" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" />{copy.save}</Badge>
      </div>

      {loading ? <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading plans…</div> : null}

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {catalog.plans.map((plan) => {
          const popular = plan.id === 'growth';
          return (
            <Card key={plan.id} className={popular ? 'relative border-primary/60 shadow-[var(--shadow-pop)]' : 'relative'}>
              {popular ? <Badge className="absolute -top-3 left-4"> {copy.popular}</Badge> : null}
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">{plan.label[language]} {popular ? <Sparkles className="h-4 w-4 text-primary" /> : null}</CardTitle>
                <CardDescription>{plan.id === 'starter' ? copy.starterDesc : plan.id === 'growth' ? copy.growthDesc : copy.enterpriseDesc}</CardDescription>
                <div className="pt-3">
                  <span className="text-3xl font-semibold tracking-tight">{money(price(plan))}</span>
                  <span className="ml-1 text-sm text-muted-foreground">{annual ? copy.perYear : copy.perMonth}</span>
                  {annual ? <p className="mt-1 text-xs text-muted-foreground">{money(Math.round((plan.annualPriceUsd ?? plan.monthlyPriceUsd * 10) / 12))}{copy.perMonth}</p> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button asChild className="w-full" variant={popular ? 'default' : 'outline'}>
                  <a href={mailto}>{copy.choose}<ArrowRight className="ml-1 h-4 w-4" /></a>
                </Button>
                <ul className="space-y-2.5 text-sm">
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{plan.limits.users} {copy.users}</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{plan.limits.projects} {copy.projects}</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{compact(plan.limits.monthlyEmails)} {copy.emails}</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{compact(plan.limits.monthlyAiTokens)} {copy.tokens}</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{Math.round(plan.limits.storageBytes / 1024 ** 3)} {copy.storage}</li>
                </ul>
                <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">{copy.overage}: ${plan.overage.emailUsdPer1000}/1k emails · ${plan.overage.aiTokensUsdPer1M}/1M tokens · ${plan.overage.storageUsdPerGb}/GB.</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">{copy.comparison}</h2>
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="p-3 font-medium">{copy.feature}</th>{catalog.plans.map((plan) => <th key={plan.id} className="p-3 font-medium">{plan.label[language]}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {[
                [copy.featureUsers, (plan: PlanDefinition) => String(plan.limits.users)],
                [copy.featureProjects, (plan: PlanDefinition) => String(plan.limits.projects)],
                [copy.featureEmails, (plan: PlanDefinition) => compact(plan.limits.monthlyEmails)],
                [copy.featureTokens, (plan: PlanDefinition) => compact(plan.limits.monthlyAiTokens)],
                [copy.featureStorage, (plan: PlanDefinition) => `${Math.round(plan.limits.storageBytes / 1024 ** 3)} GB`],
              ].map(([label, value]) => (
                <tr key={label as string}><td className="p-3 text-muted-foreground">{label as string}</td>{catalog.plans.map((plan) => <td key={plan.id} className="p-3">{(value as (plan: PlanDefinition) => string)(plan)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{copy.billingNote}</p>
      </section>

      <section className="mt-12 rounded-xl border bg-muted/20 p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight">{copy.faq}</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {[[copy.faq1, copy.a1], [copy.faq2, copy.a2], [copy.faq3, copy.a3], [copy.faq4, copy.a4], [copy.faq5, copy.a5]].map(([q, a]) => (
            <div key={q}><p className="flex items-start gap-2 font-medium"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{q}</p><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{a}</p></div>
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-xl bg-slate-950 px-6 py-10 text-white sm:px-10">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.ctaTitle}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{copy.ctaDesc}</p>
        <Button asChild className="mt-5 bg-white text-slate-950 hover:bg-slate-100"><a href={mailto}>{copy.ctaButton}<ArrowRight className="ml-1 h-4 w-4" /></a></Button>
      </section>
    </PublicLayout>
  );
}

export default PricingPage;
