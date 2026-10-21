// Hunter domain search: domain -> public emails (and a likely contact).
// Called only when the crawled site exposes no email; the service caps calls per run.

export interface HunterEmail {
  value: string;
  confidence: number;
  type: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  phone?:string;linkedin?:string;
}

export interface HunterResult {
  domain: string;
  emails: HunterEmail[];
  contactName?: string;
  contactTitle?: string;
  organization?: string;
  phone?:string;linkedin?:string;
}

export function mapHunterResponse(payload: unknown): HunterResult {
  const data = (payload as { data?: Record<string, unknown> })?.data ?? {};
  const raw = Array.isArray(data.emails)?data.emails.filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==='object'):[];
  const emails = raw.flatMap((item) => {
    const value = String(item.value ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return [];
    return [{
      value,
      confidence: Number(item.confidence ?? 0),
      type: String(item.type ?? 'generic'),
      firstName: item.first_name ? String(item.first_name) : undefined,
      lastName: item.last_name ? String(item.last_name) : undefined,
      position: item.position ? String(item.position).slice(0,120) : undefined,
      phone:typeof item.phone_number==='string'?item.phone_number.slice(0,60):undefined,
      linkedin:typeof item.linkedin==='string'?item.linkedin.slice(0,300):undefined,
    }];
  }).sort((a, b) => {
    // Prefer a named decision maker, then confidence.
    const rank = (email: HunterEmail) => (email.type === 'personal' && email.position ? 2 : email.type === 'personal' ? 1 : 0);
    return rank(b) - rank(a) || b.confidence - a.confidence;
  });
  const person = emails[0]&&(emails[0].firstName||emails[0].lastName)?emails[0]:undefined;
  return {
    domain: String(data.domain ?? ''),
    emails,
    contactName: person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : undefined,
    contactTitle: person?.position,
    organization: data.organization ? String(data.organization).slice(0,200) : undefined,
    phone:emails[0]?.phone,linkedin:emails[0]?.linkedin,
  };
}

export async function hunterDomainSearch(domain: string): Promise<HunterResult> {
  const key = process.env.LEAD_HUNTER_API_KEY;
  if (!key) throw new Error('LEAD_HUNTER_API_KEY 未配置');
  const response = await fetch(
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${encodeURIComponent(key)}`,
    { signal: AbortSignal.timeout(20000) },
  );
  if (response.status === 401 || response.status === 403) throw new Error('Hunter key 无效或额度不足');
  if (response.status === 429) throw new Error('Hunter 请求过于频繁');
  if (!response.ok) throw new Error(`Hunter HTTP ${response.status}`);
  return mapHunterResponse(await response.json());
}
