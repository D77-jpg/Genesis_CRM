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
/** 占位邮箱/停放域：example.com、exemple.com、godaddy 停放页、模板里的 filler@… 都不是真邮箱 */
const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'exemple.com', 'exemplo.com',
  'domain.com', 'yourdomain.com', 'email.com', 'mail.com', 'test.com', 'test.test',
  'sentry.io', 'sentry-next.wixpress.com', 'wixpress.com',
  'godaddy.com', 'parked.com', 'sedo.com', 'afternic.com',
]);
/** 是不是不该拿来发信的「邮箱」（占位、停放、图片文件名） */
export function isBlockedEmail(mail: string): boolean {
  const value = mail.trim().toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg|bmp|css|js|woff2?)$/.test(value)) return true;
  const domain = value.split('@')[1] ?? '';
  if (!domain) return true;
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) return true;
  // filler@godaddy.com 这类停放页邮箱
  if (/^(filler|noreply|no-reply|donotreply|postmaster)@/.test(value) && /godaddy|parked|sedo|afternic/.test(domain)) return true;
  return false;
}

function key(name: 'LEAD_SERPER_API_KEY' | 'LEAD_FIRECRAWL_API_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 未配置，请写入 server/.env`);
  return value;
}

async function request(url: string, init: RequestInit, attempts = 3, timeoutMs = 45000): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
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

/**
 * 抓一个网页。
 * 默认只要 markdown：带 rawHtml 时响应体能有几 MB，45s 都读不完，等于每次抓取都超时失败。
 * 需要解析 JSON-LD（电话/社媒更全）时再传 { html: true }，单独抓一次。
 */
export async function firecrawlScrape(
  url: string,
  options: { html?: boolean } = {},
): Promise<{ markdown: string; title?: string;company?:string;rawHtml?:string } | null> {
  try {
    const formats = options.html ? ['markdown','rawHtml'] : ['markdown'];
    const data = await request('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key('LEAD_FIRECRAWL_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats, onlyMainContent: false, timeout: options.html ? 60000 : 30000 }),
    }, 3, options.html ? 120000 : 60000) as { success?: boolean; data?: { markdown?: string;rawHtml?:string; metadata?: { title?: string;ogSiteName?:string } } };
    if (!data.success || (!data.data?.markdown&&!data.data?.rawHtml)) return null;
    return { markdown: (data.data!.markdown??'').slice(0,40000), title: data.data.metadata?.title,company:data.data.metadata?.ogSiteName,rawHtml:data.data.rawHtml?.slice(0,500000) };
  } catch {
    return null;
  }
}

const unique = (values: string[]) => [...new Set(values)];

/**
 * 抓官网补联系方式。
 * options.stopWhenContactFound：批量补全用——拿到邮箱就不再抓后面两页，省额度。
 * 搜索流程仍按原来的三页全抓。
 */
export async function enrichLead(
 lead:RawLead,
 scrape:typeof firecrawlScrape=firecrawlScrape,
 options:{stopWhenContactFound?:boolean}={},
):Promise<RawLead>{
 const result:RawLead={...lead,contactSources:[...(lead.contactSources??[])]};
 const pages=[lead.website];let markdown='',pagesRead=0;const emails=[...(lead.emails??[])];
 for(let i=0;i<pages.length&&i<3;i++){
  const page=pages[i],content=await scrape(page);if(!content)continue;pagesRead++;
  markdown+='\n'+content.markdown;
  const found=extractSiteContact(content.markdown,content.rawHtml??'',lead.domain);
  if(i===0&&content.company&&!found.company)found.company=content.company.slice(0,200);
  const fields:string[]=[];
  for(const key of Object.keys(found) as (keyof typeof found)[])if(found[key]&&!result[key]){Object.assign(result,{[key]:found[key]});fields.push(key);}
  emails.push(...(content.markdown.match(EMAIL)??[]).filter(mail=>!isBlockedEmail(mail)));
  if(i===0){
   const links=[...content.markdown.matchAll(/\]\(([^)\s]+)\)/g)].flatMap(match=>{try{const url=new URL(match[1],page);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&domainOf(url.href)===lead.domain?[url.href]:[];}catch{return [];}});
   for(const kind of ['contact','about'])pages.push(links.find(url=>new RegExp('(?:/|-)'+kind+'(?:[-/]|$)','i').test(new URL(url).pathname))??new URL(kind,page).href);
  }
  if(fields.length||emails.length)result.contactSources!.push({source:'site',url:page,fields:[...fields,...(content.markdown.match(EMAIL)?['emails']:[])]});
  // 已经有邮箱了：后面两页（/contact、/about）就不用再抓，省 Firecrawl 额度
  if(options.stopWhenContactFound&&emails.length>0)break;
 }
 // markdown 里既没邮箱也没电话/社媒：再带 HTML 深抓一次首页，拿 JSON-LD 里的电话与社媒
  if(pagesRead>0&&emails.length===0&&!result.phone&&!result.instagram&&!result.linkedin&&!result.facebook){
   const deep=await scrape(pages[0],{html:true});
   if(deep){
    const found=extractSiteContact(deep.markdown??'',deep.rawHtml??'',lead.domain);
    for(const key of Object.keys(found) as (keyof typeof found)[])if(found[key]&&!result[key])Object.assign(result,{[key]:found[key]});
    emails.push(...((deep.markdown??'').match(EMAIL)??[]).filter(mail=>!isBlockedEmail(mail)));
    result.contactSources!.push({source:'site',url:pages[0],fields:['jsonld']});
   }
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
