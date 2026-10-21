// Lead discovery + enrichment for daily prospecting.
// Serper = Google search (discovery), Firecrawl = page markdown (enrichment).
// Both are called server-side only; keys live in server/.env and never reach the UI.

import {extractSiteContact,type LeadContact} from './lead-contact';
export interface RawLead extends LeadContact {
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
  pagesRead?:number;
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

export async function firecrawlScrape(url: string): Promise<{ markdown: string; title?: string;company?:string;rawHtml?:string } | null> {
  try {
    const data = await request('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key('LEAD_FIRECRAWL_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown','rawHtml'], onlyMainContent: false, timeout: 30000 }),
    }) as { success?: boolean; data?: { markdown?: string;rawHtml?:string; metadata?: { title?: string;ogSiteName?:string } } };
    if (!data.success || (!data.data?.markdown&&!data.data?.rawHtml)) return null;
    return { markdown: (data.data!.markdown??'').slice(0,40000), title: data.data.metadata?.title,company:data.data.metadata?.ogSiteName,rawHtml:data.data.rawHtml?.slice(0,500000) };
  } catch {
    return null;
  }
}

const unique = (values: string[]) => [...new Set(values)];

export async function enrichLead(lead:RawLead,scrape:typeof firecrawlScrape=firecrawlScrape):Promise<RawLead>{
 const result:RawLead={...lead,contactSources:[...(lead.contactSources??[])]};
 const pages=[lead.website];let markdown='',pagesRead=0;const emails=[...(lead.emails??[])];
 for(let i=0;i<pages.length&&i<3;i++){
  const page=pages[i],content=await scrape(page);if(!content)continue;pagesRead++;
  markdown+='\n'+content.markdown;
  const found=extractSiteContact(content.markdown,content.rawHtml??'',lead.domain);
  if(i===0&&content.company&&!found.company)found.company=content.company.slice(0,200);
  const fields:string[]=[];
  for(const key of Object.keys(found) as (keyof typeof found)[])if(found[key]&&!result[key]){Object.assign(result,{[key]:found[key]});fields.push(key);}
  emails.push(...(content.markdown.match(EMAIL)??[]).filter(mail=>!IGNORE_EMAIL.test(mail)));
  if(i===0){
   const links=[...content.markdown.matchAll(/\]\(([^)\s]+)\)/g)].flatMap(match=>{try{const url=new URL(match[1],page);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&domainOf(url.href)===lead.domain?[url.href]:[];}catch{return [];}});
   for(const kind of ['contact','about'])pages.push(links.find(url=>new RegExp('(?:/|-)'+kind+'(?:[-/]|$)','i').test(new URL(url).pathname))??new URL(kind,page).href);
  }
  if(fields.length||emails.length)result.contactSources!.push({source:'site',url:page,fields:[...fields,...(content.markdown.match(EMAIL)?['emails']:[])]});
 }
 result.emails=unique(emails.map(mail=>mail.toLowerCase())).slice(0,3);
 if(result.emails.length&&!result.emailSource)result.emailSource='site';
 result.excerpt=markdown.replace(/\s+/g,' ').trim().slice(0,2000)||lead.excerpt;
 result.pagesRead=pagesRead;result.markdownChars=markdown.length;result.contactSources=result.contactSources!.slice(0,8);
 return result;
}

/** Dedupe by domain, preferring the first search hit. */
export function dedupeLeads(leads: RawLead[]) {
  const seen = new Set<string>();
  return leads.filter((lead) => (seen.has(lead.domain) ? false : (seen.add(lead.domain), true)));
}
