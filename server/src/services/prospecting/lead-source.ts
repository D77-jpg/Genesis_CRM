// Lead discovery + enrichment for daily prospecting.
// Serper = Google search (discovery), Firecrawl = page markdown (enrichment).
// Both are called server-side only; keys live in server/.env and never reach the UI.

export interface RawLead {
  externalId?: string;
  name?: string;
  company?: string;
  domain: string;
  website: string;
  country?: string;
  snippet?: string;
  sourceUrl: string;
  emails?: string[];
  instagram?: string;
  linkedin?: string;
  title?: string;
  excerpt?: string;
  contactName?: string;
  contactTitle?: string;
  emailSource?: 'site' | 'hunter';
  emailConfidence?: number;
  markdownChars?: number;
}

const BLOCKED = /(^|\.)(etsy|amazon|ebay|pinterest|facebook|instagram|linkedin|youtube|tiktok|alibaba|aliexpress|walmart|target|shopify|wixsite|blogspot|wordpress|tumblr|reddit|x|twitter)\./i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IGNORE_EMAIL = /(example|sentry|wixpress|domain\.com|email\.com|yourdomain|@2x|\.png|\.jpg|\.webp)$/i;

function key(name: 'LEAD_SERPER_API_KEY' | 'LEAD_FIRECRAWL_API_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 未配置，请写入 server/.env`);
  return value;
}

async function request(url: string, init: RequestInit, attempts = 3): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45000) });
    if (response.ok) return response.json();
    last = new Error(`${url} HTTP ${response.status}`);
    if (![429, 500, 502, 503, 504].includes(response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw last;
}

export function domainOf(link: string) {
  try { return new URL(link).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
}

export async function serperSearch(query: string, count = 10): Promise<RawLead[]> {
  const data = await request('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key('LEAD_SERPER_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: Math.min(count, 20) }),
  }) as { organic?: { title?: string; link?: string; snippet?: string }[] };
  return (data.organic ?? []).flatMap((item) => {
    if (!item.link) return [];
    const domain = domainOf(item.link);
    if (!domain || BLOCKED.test(domain)) return [];
    return [{ name: item.title?.trim(), domain, website: `https://${domain}/`, snippet: item.snippet?.trim(), sourceUrl: item.link }];
  });
}

export async function firecrawlScrape(url: string): Promise<{ markdown: string; title?: string } | null> {
  try {
    const data = await request('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key('LEAD_FIRECRAWL_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 30000 }),
    }) as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string } } };
    if (!data.success || !data.data?.markdown) return null;
    return { markdown: data.data.markdown, title: data.data.metadata?.title };
  } catch {
    return null;
  }
}

const unique = (values: string[]) => [...new Set(values)];

export async function enrichLead(lead: RawLead): Promise<RawLead> {
  const pages = [lead.website];
  for (const path of ['contact', 'pages/contact', 'about', 'pages/about']) pages.push(new URL(path, lead.website).toString());
  const emails: string[] = [];
  let markdown = '';
  let title = lead.name;
  for (const page of pages.slice(0, 3)) {
    const result = await firecrawlScrape(page);
    if (!result) continue;
    markdown += '\n' + result.markdown;
    if (result.title) title = title ?? result.title;
    emails.push(...(result.markdown.match(EMAIL) ?? []).filter((mail) => !IGNORE_EMAIL.test(mail)));
    if (emails.length) break;
  }
  const ig = markdown.match(/instagram\.com\/([A-Za-z0-9_.]{2,40})/i)?.[1];
  const li = markdown.match(/linkedin\.com\/(?:company|in)\/([A-Za-z0-9-_%]{2,80})/i)?.[1];
  return {
    ...lead,
    name: title?.slice(0, 200),
    emails: unique(emails.map((mail) => mail.toLowerCase())).slice(0, 3),
    emailSource: emails.length ? 'site' : undefined,
    instagram: ig,
    linkedin: li,
    excerpt: markdown.replace(/\s+/g, ' ').trim().slice(0, 600),
    markdownChars: markdown.length,
  };
}

/** Dedupe by domain, preferring the first search hit. */
export function dedupeLeads(leads: RawLead[]) {
  const seen = new Set<string>();
  return leads.filter((lead) => (seen.has(lead.domain) ? false : (seen.add(lead.domain), true)));
}
