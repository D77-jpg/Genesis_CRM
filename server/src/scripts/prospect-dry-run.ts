// Dry run: search leads with Serper, enrich a few with Firecrawl, print them.
// Writes nothing to the database. Usage:
//   npx tsx src/scripts/prospect-dry-run.ts --enrich 5 --queries "query a|query b"
import env from '../config/env';
import { dedupeLeads, enrichLead, serperSearch, type RawLead } from '../services/prospecting/lead-source';

void env;

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const DEFAULT_QUERIES = [
  'independent jewelry brand "made in usa" shop -site:etsy.com -site:amazon.com',
  'handmade candle brand usa online store -site:etsy.com',
  'jewelry designer usa "our story" online shop -site:etsy.com',
];

async function main() {
  const queries = arg('queries', '').split('|').map((q) => q.trim()).filter(Boolean);
  const perQuery = Number(arg('per-query', '10'));
  const enrichCount = Number(arg('enrich', '0'));
  const limit = Number(arg('limit', '30'));
  const list = queries.length ? queries : DEFAULT_QUERIES;
  const all: RawLead[] = [];
  for (const query of list) {
    const found = await serperSearch(query, perQuery);
    console.log(`· ${query} → ${found.length} 条`);
    all.push(...found);
  }
  const leads = dedupeLeads(all).slice(0, limit);
  console.log(`\n去重后 ${leads.length} 个域名，开始补全前 ${Math.min(enrichCount, leads.length)} 个\n`);
  const enriched: RawLead[] = [];
  for (let i = 0; i < leads.length; i++) {
    const lead = i < enrichCount ? await enrichLead(leads[i]) : leads[i];
    enriched.push(lead);
    const status = lead.emails?.length ? lead.emails.join(', ') : '（未找到邮箱）';
    console.log(`${String(i + 1).padStart(2)}. ${lead.domain.padEnd(34)} ${status}${lead.instagram ? '  IG:' + lead.instagram : ''}`);
  }
  const withEmail = enriched.filter((lead) => lead.emails?.length).length;
  console.log(`\n汇总：${enriched.length} 个候选，${withEmail} 个找到邮箱；仅补全了前 ${Math.min(enrichCount, leads.length)} 个。`);
  if (process.argv.includes('--json')) console.log(JSON.stringify(enriched, null, 2));
}

void main().catch((error) => { console.error('dry run 失败：', error instanceof Error ? error.message : error); process.exit(1); });
