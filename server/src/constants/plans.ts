/** Subscription plans and the quotas attached to each plan. */
export const ORGANIZATION_PLANS = ['starter', 'growth', 'enterprise'] as const;
export type OrganizationPlan = typeof ORGANIZATION_PLANS[number];

export const ORGANIZATION_PLAN_LABELS: Record<OrganizationPlan, { zh: string; en: string }> = {
  starter: { zh: '入门版', en: 'Starter' },
  growth: { zh: '成长版', en: 'Growth' },
  enterprise: { zh: '企业版', en: 'Enterprise' },
};

export interface OrganizationLimits {
  integrationCredentialsPerProject?: number;
  users: number;
  projects: number;
  monthlyEmails: number;
  monthlyAiTokens: number;
  storageBytes: number;
}

export interface PlanDefinition {
  id: OrganizationPlan;
  monthlyPriceUsd: number;
  /** Annual list price (10 monthly payments; two months free). */
  annualPriceUsd: number;
  limits: OrganizationLimits;
  overage: {
    emailUsdPer1000: number;
    aiTokensUsdPer1M: number;
    storageUsdPerGb: number;
  };
}

/** Prices are list prices; an organization can carry custom limits afterwards. */
export const PLAN_CATALOG: Record<OrganizationPlan, PlanDefinition> = {
  starter: {
    id: 'starter',
    monthlyPriceUsd: 49,
    annualPriceUsd: 490,
    limits: { users: 5, projects: 2, monthlyEmails: 5_000, monthlyAiTokens: 1_000_000, storageBytes: 5 * 1024 ** 3 },
    overage: { emailUsdPer1000: 2, aiTokensUsdPer1M: 5, storageUsdPerGb: 0.5 },
  },
  growth: {
    id: 'growth',
    monthlyPriceUsd: 149,
    annualPriceUsd: 1_490,
    limits: { users: 20, projects: 10, monthlyEmails: 50_000, monthlyAiTokens: 10_000_000, storageBytes: 50 * 1024 ** 3 },
    overage: { emailUsdPer1000: 1.5, aiTokensUsdPer1M: 4, storageUsdPerGb: 0.35 },
  },
  enterprise: {
    id: 'enterprise',
    monthlyPriceUsd: 499,
    annualPriceUsd: 4_990,
    limits: { users: 200, projects: 100, monthlyEmails: 500_000, monthlyAiTokens: 100_000_000, storageBytes: 500 * 1024 ** 3 },
    overage: { emailUsdPer1000: 1, aiTokensUsdPer1M: 3, storageUsdPerGb: 0.2 },
  },
};

export function limitsForPlan(plan: OrganizationPlan): OrganizationLimits {
  return { ...PLAN_CATALOG[plan].limits, integrationCredentialsPerProject: integrationCredentialLimit(plan) };
}

export function integrationCredentialLimit(plan: OrganizationPlan): number {
  return ({ starter: 3, growth: 10, enterprise: 50 } as const)[plan];
}

export function planCatalog(): Array<PlanDefinition & { label: { zh: string; en: string } }> {
  return Object.values(PLAN_CATALOG).map((plan) => ({ ...plan, label: ORGANIZATION_PLAN_LABELS[plan.id] }));
}
