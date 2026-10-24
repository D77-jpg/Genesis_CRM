/**
 * 补齐邮件来源客户的资料（公司名 / 行业 / 国家 / 官网 / 脏名字）。
 *
 * 证据：该客户最近几封来信正文 + 现有官网首页 + （无官网时）Serper 搜索结果
 * 判断：调用系统当前配置的 AI（AgentAiSettings 或 .env），输出严格 JSON
 * 写入：只补空字段；「脏值」（纯数字、邮箱域名、客户档案、占位域名）允许覆盖
 *
 * 用法（在 server 目录下执行）：
 *   node --import tsx scripts/backfill-mail-customers.ts             # 只出报告
 *   node --import tsx scripts/backfill-mail-customers.ts --apply      # 写库
 *   node --import tsx scripts/backfill-mail-customers.ts --limit=5    # 只跑前 5 条
 *   node --import tsx scripts/backfill-mail-customers.ts --nocache    # 重新问 AI
 */
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import env from '../src/config/env';
import { Customer, Project } from '../src/models';
import { MailMessage } from '../src/models/MailMessage';
import { AgentAiSettings } from '../src/models/AgentAiSettings';
import { decryptAiCredential } from '../src/services/credential-crypto';
import { fetchWebsite } from '../src/services/website/public-web';
import { parseWebsitePage } from '../src/services/website/site-analysis';
import { serperSearch } from '../src/services/prospecting/lead-source';
import { resolveCountry } from '../src/utils/country';

const APPLY = process.argv.includes('--apply');
const NOCACHE = process.argv.includes('--nocache');
/** 第二轮：只处理仍然缺国家/行业的客户，并且额外做一次搜索 */
const PASS2 = process.argv.includes('--pass2');
/** 处理全部客户（含线索池转过来的），默认只看邮件来源 */
const SCOPE_ALL = process.argv.includes('--scope=all');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] || 0);
const PROJECT_ID = '6aa2360776ab59e92117bb18';
const REPORT = path.resolve(__dirname, '../../.dsh/backfill-report.txt');
const CACHE = path.resolve(__dirname, '../../.dsh/backfill-cache.json');

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'qq.com', '163.com', '126.com', 'sina.com', 'foxmail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com',
  'mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'yandex.ru', 'comcast.net', 'zohomail.com', 'aol.com', 'gmx.de',
  'gmx.net', 'web.de', 't-online.de', 'proton.me', 'protonmail.com', 'mail.com', 'naver.com', 'hanmail.net',
  'bigpond.com', 'optusnet.com.au', 'shaw.ca', 'telus.net', 'verizon.net', 'att.net', 'sbcglobal.net']);

/** 只在 AI 没给国家时兜底用；不确定宁可不填 */
const TLD_COUNTRY: Record<string, string> = {
  ru: '俄罗斯', cn: '中国', fr: '法国', de: '德国', it: '意大利', se: '瑞典', be: '比利时', ee: '爱沙尼亚',
  mn: '蒙古', jp: '日本', kr: '韩国', au: '澳大利亚', uk: '英国', es: '西班牙', nl: '荷兰', ch: '瑞士',
  ae: '阿联酋', sg: '新加坡', dk: '丹麦', no: '挪威', fi: '芬兰', pl: '波兰', tr: '土耳其', br: '巴西',
  mx: '墨西哥', il: '以色列', za: '南非', th: '泰国', vn: '越南', my: '马来西亚', id: '印尼', ph: '菲律宾',
  ua: '乌克兰', cz: '捷克', at: '奥地利', pt: '葡萄牙', gr: '希腊', sa: '沙特阿拉伯', ie: '爱尔兰',
};

const INDUSTRIES = ['珠宝首饰', '美妆护肤', '香薰蜡烛', '家居生活', '礼品定制', '服装服饰', '食品饮料', '酒类',
  '宠物用品', '茶叶咖啡', '数码电子', '零售电商', '包装印刷', '其他'];

const SYSTEM = [
  '你是外贸 CRM 的资料整理助手。根据给出的证据（客户来信正文、官网首页文字、搜索结果），判断这家客户的：',
  '1) company：客户公司或品牌的规范写法（保留原文大小写与重音，最多 60 字符）。证据不足就给空字符串。',
  `2) industry：从这些里选一个最接近的：${INDUSTRIES.join('、')}。`,
  '3) country：客户公司所在国家/地区，用规范中文名（例如 美国、英国、德国、法国、澳大利亚、瑞典、日本、韩国、加拿大、意大利、西班牙、荷兰、比利时、阿联酋、新加坡、印度、俄罗斯）。',
  '4) website：客户官网（含 https://）。只有当证据里明确出现，或搜索结果显示就是该品牌官网时才给，否则空字符串。',
  '5) personName：来信署名里能确认的真人姓名。若现有姓名已经合理，返回空字符串。',
  '6) confidence：high / medium / low。只按证据强度判断，不要为了给答案而提高。',
  '只输出 JSON 对象，字段固定为 company, industry, country, website, personName, confidence。',
  '严禁编造：证据里看不出来就留空；只能靠语言或邮箱后缀猜国家时，confidence 必须填 low。',
].join('\n');

/** 人工确认过的特例（原始数据是占位内容或是供应商而非客户） */
const MANUAL: Record<string, { name?: string; company?: null; country?: string | null; website?: null; industry?: null; note?: string }> = {
  '8708778@qq.com': { name: 'QQ 客户 8708778', company: null, country: '中国', website: null, industry: null, note: '原邮件地址 8708778@qq.com，公司资料待人工确认' },
  'fordsupplyash@zohomail.com': { name: 'Ford Supply Ash', company: null, country: null, website: null, industry: null, note: '原邮件地址 fordsupplyash@zohomail.com，公司资料待人工确认' },
  'info@quickemail22.org': { name: 'Michael Legros', company: null, country: null, website: null, industry: null, note: '原邮箱域名 quickemail22.org 是占位域名，公司资料待人工确认' },
  'development@nadiakamara.com': { name: 'Nadia Kamara', note: '原姓名是角色名 Development，改用品牌名' },
  'mandy.zhao@goodilfetextile.com': { industry: null, country: null, note: '官网编码异常抓不到证据，行业与国家无法确认，先留空' },
  'amberdog.cat@gmail.com': { company: null, note: '搜索证据不足以确认品牌名，公司先留空' },
  'xinhang2xh@gmail.com': { industry: null, note: '证据不足以判断行业，先留空' },
  'atelier@atelierskal.com': { industry: null, note: '证据不足以区分珠宝首饰/服装服饰，先留空' },
};

function escapeReg(input: string): string { return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function cleanText(raw: string, max: number): string {
  let text = raw || '';
  if (!text.trim()) return '';
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  const kept = text.split('\n').map((line) => line.trim())
    .filter((line) => line && !line.startsWith('>') && !/^(On .+ wrote:|在 .+ 写道：|-----\s*Original Message)/i.test(line));
  return kept.join('\n').replace(/[ \t]{2,}/g, ' ').slice(0, max);
}

const ROLE_WORDS = /^(development|dev|info|sales|contact|admin|office|team|support|hello|enquiry|enquiries|orders?|marketing|service|customercare|procurement)$/i;
const JUNK_NAME = [/^\d+$/, /^[0-9\s\-_.]+$/, /^(客户档案|未知|无)$/];
const JUNK_COMPANY = [/^(客户档案|未知|无|you|-)?$/i, /^\d+$/, /^(zohomail|gmail|qq|hotmail|outlook|yahoo|icloud|mail)\.?(com|ru|net|org)?$/i];

function junkName(value?: string | null): boolean {
  const v = (value ?? '').trim();
  return !v || JUNK_NAME.some((re) => re.test(v));
}
function junkCompany(value?: string | null, emailDomain?: string): boolean {
  const v = (value ?? '').trim();
  if (!v || JUNK_COMPANY.some((re) => re.test(v))) return true;
  if (emailDomain && v.toLowerCase().replace(/^www\./, '') === emailDomain.toLowerCase()) return true;
  return false;
}
function hostOf(url?: string | null): string {
  try { return new URL(url ?? '').hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
}
/** Michael.legros → Michael Legros；Development 这类角色名返回空 */
function tidyPerson(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw || ROLE_WORDS.test(raw)) return '';
  if (/[.]/.test(raw) && !/\s/.test(raw)) {
    return raw.split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  return raw;
}

async function resolveAi(): Promise<{ baseUrl: string; model: string; apiKey: string; source: string }> {
  const doc = await AgentAiSettings.findOne({ key: 'global' })
    .select('+credentialCiphertext +credentialIv +credentialTag provider modelName baseUrl').lean() as any;
  if (doc && doc.provider === 'openai' && doc.credentialCiphertext) {
    const apiKey = decryptAiCredential({ ciphertext: doc.credentialCiphertext, iv: doc.credentialIv, tag: doc.credentialTag } as any);
    return { baseUrl: doc.baseUrl, model: doc.modelName, apiKey, source: 'database' };
  }
  if (env.OPENAI_API_KEY) return { baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY, source: 'environment' };
  throw new Error('没有可用的 AI 凭证');
}

async function askAi(ai: { baseUrl: string; model: string; apiKey: string }, evidence: string): Promise<any> {
  const res = await fetch(`${ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: evidence }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json: any = await res.json();
  const raw = json?.choices?.[0]?.message?.content ?? '';
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`AI 输出无法解析: ${String(raw).slice(0, 160)}`);
  return JSON.parse(match[0]);
}

interface Evidence { text: string; note: string }
interface Outcome { id: string; email: string; before: any; patch: any; ai: any; note: string; error?: string }

function decide(before: any, aiResult: any, emailDomain: string): any {
  const patch: any = {};
  const confidence = String(aiResult?.confidence || 'low').toLowerCase();
  const strong = confidence === 'high';
  const ok = confidence === 'high' || confidence === 'medium';

  const aiCompany = String(aiResult?.company || '').trim().slice(0, 120);
  const aiPerson = tidyPerson(aiResult?.personName).slice(0, 60);
  const aiIndustry = String(aiResult?.industry || '').trim();
  const aiCountry = String(aiResult?.country || '').trim();
  const aiWebsite = String(aiResult?.website || '').trim();
  const currentName = String(before.name ?? '').trim();

  // 姓名：纯数字 / 角色名 / 小写点号形式 → 用 AI 给的联系人或公司名
  if (ROLE_WORDS.test(currentName)) {
    // 「Development」「info」这类是邮箱别名，不是人名：优先用公司/品牌名当客户名
    const label = aiCompany && ok ? aiCompany : String(before.company ?? '').trim();
    if (label) patch.name = label;
    else if (aiPerson) patch.name = aiPerson;
  } else if (aiPerson && junkName(currentName)) patch.name = aiPerson;
  else if (aiPerson && before.company && currentName === String(before.company).trim()) patch.name = aiPerson;
  else if (junkName(currentName) && aiCompany && ok) patch.name = aiCompany;
  else if (tidyPerson(currentName) && tidyPerson(currentName) !== currentName) patch.name = tidyPerson(currentName);

  // 公司：只补空值或脏值，低置信度不写
  const pretty = /^[a-z0-9 .&'-]+$/.test(aiCompany) && aiCompany.length > 2
    ? aiCompany.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : aiCompany;
  if (pretty && ok && junkCompany(before.company, emailDomain)) patch.company = pretty;

  // 行业：空值才补；「其他 + 低置信度」没有信息量，跳过
  if (!before.industry && INDUSTRIES.includes(aiIndustry) && !(aiIndustry === '其他' && confidence === 'low')) {
    patch.industry = aiIndustry;
  }

  // 国家：中高置信度直接用；低置信度只在邮箱后缀能佐证时采用
  if (!before.country) {
    const tld = TLD_COUNTRY[(emailDomain.split('.').pop() ?? '').toLowerCase()];
    let country = '';
    if (ok && aiCountry) country = aiCountry;
    else if (aiCountry && tld && resolveCountry(aiCountry).value === resolveCountry(tld).value) country = aiCountry;
    if (country) {
      const resolved = resolveCountry(country);
      if (resolved && !resolved.unknown && resolved.value) patch.country = resolved.value;
    } else if (tld && confidence !== 'low') {
      patch.country = resolveCountry(tld).value || tld;
    }
  }

  // 官网：只补空值；需高置信度或与自有域名一致；mail 服务商域名一律不要
  if (!before.website && /^https?:\/\//i.test(aiWebsite)) {
    const host = hostOf(aiWebsite);
    const isProvider = FREE_MAIL.has(host);
    const matchesDomain = Boolean(host) && (host === emailDomain || host.endsWith('.' + emailDomain) || emailDomain.endsWith('.' + host));
    if (!isProvider && (strong || matchesDomain)) patch.website = aiWebsite.slice(0, 300);
  }

  return patch;
}

async function gather(customer: any): Promise<Evidence> {
  const email = String(customer.email || '').toLowerCase();
  const parts: string[] = [];
  parts.push(`当前记录：姓名=${customer.name || '空'}；公司=${customer.company || '空'}；行业=${customer.industry || '空'}；国家=${customer.country || '空'}；邮箱=${email || '空'}；官网=${customer.website || '空'}`);

  try {
    const filter: any = { projectId: customer.projectId, deleted: { $ne: true } };
    filter.$or = [{ customerId: customer._id }];
    if (email) filter.$or.push({ from: new RegExp(escapeReg(email), 'i') });
    const mails = await MailMessage.find(filter).sort({ sentAt: -1 }).limit(3).select('subject fromName text html').lean() as any[];
    let used = 0;
    for (const mail of mails) {
      const text = cleanText(mail.text || mail.html || '', 1200);
      if (!text) continue;
      used += 1;
      parts.push(`【来信】主题：${(mail.subject || '').slice(0, 120)}\n发件人显示名：${mail.fromName || '无'}\n正文：\n${text}`);
    }
    if (!used) parts.push('【来信】没有可读的邮件正文。');
  } catch (error) {
    parts.push(`【来信】读取失败：${(error as Error).message}`);
  }

  if (customer.website) {
    try {
      const response = await fetchWebsite(customer.website, 'html');
      const page = parseWebsitePage(response.text, response.url);
      parts.push(`【官网】${page.url}\n站点名：${page.name || '无'}\n标题：${page.title || '无'}\n正文节选：\n${cleanText(page.text, 1400)}`);
    } catch (error) {
      parts.push(`【官网】抓取失败（${(error as Error).message}）。`);
    }
  }

  const domain = email.split('@')[1] ?? '';
  if (customer.website) {
    // 第二轮补国家：官网没有明确地址时，再抓一次 /contact 页
  }
  if (PASS2 || (!customer.website && FREE_MAIL.has(domain))) {
    const query = [customer.name, customer.company].filter((v) => v && !junkCompany(v)).join(' ') || customer.name || domain;
    try {
      const hits = await serperSearch(`${query} brand official site`, 5);
      const lines = hits.slice(0, 4).map((hit) => `- ${hit.title || hit.name || '无标题'} | ${hit.website || hit.domain} | ${(hit.snippet || '').slice(0, 200)}`);
      parts.push(`【搜索】关键词：${query}\n${lines.join('\n') || '没有搜到结果。'}`);
    } catch (error) {
      parts.push(`【搜索】失败：${(error as Error).message}`);
    }
  }

  return { text: parts.join('\n\n').slice(0, 12_000), note: parts.map((p) => p.split('\n')[0].slice(0, 70)).join(' / ') };
}

async function handleOne(customer: any, ai: { baseUrl: string; model: string; apiKey: string }, cache: Record<string, any>): Promise<Outcome> {
  const email = String(customer.email || '').toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const before = { name: customer.name, company: customer.company, industry: customer.industry, country: customer.country, website: customer.website };
  const key = String(customer._id);

  let aiResult = cache[key];
  let note = cache[`${key}:note`] ?? '';
  if (!aiResult || NOCACHE) {
    const evidence = await gather(customer);
    note = evidence.note;
    aiResult = await askAi(ai, evidence.text);
    cache[key] = aiResult;
    cache[`${key}:note`] = note;
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1), 'utf8');
  }

  const patch = decide(before, aiResult, domain);

  // 脏官网（邮箱服务商域名）直接清空
  if (before.website && FREE_MAIL.has(hostOf(before.website))) patch.website = '';

  // 人工特例
  const manual = MANUAL[email];
  if (manual) {
    if (manual.name) patch.name = manual.name;
    if (manual.company === null) delete patch.company;
    if (manual.country === null) delete patch.country;
    else if (manual.country) patch.country = manual.country;
    if (manual.website === null) patch.website = '';
    if (manual.industry === null) delete patch.industry;
    note = `${note}${note ? ' / ' : ''}[人工特例] ${manual.note ?? ''}`;
  }

  return { id: key, email, before, patch, ai: { ...(aiResult ?? {}), confidence: aiResult?.confidence }, note };
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const project = await Project.findById(PROJECT_ID).select('name').lean() as any;
  const ai = await resolveAi();
  const cache: Record<string, any> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const filter: any = { projectId: new mongoose.Types.ObjectId(PROJECT_ID) };
  if (!SCOPE_ALL) filter.source = 'mail';
  let customers = await Customer.find(filter).sort({ createdAt: 1 }).lean() as any[];
  if (PASS2) customers = customers.filter((c) => !c.country || !c.industry);
  if (LIMIT > 0) customers = customers.slice(0, LIMIT);
  console.log(`项目：${project?.name ?? PROJECT_ID} · 客户 ${customers.length} 位 · AI=${ai.model}（${ai.source}）· ${APPLY ? '写库' : '只出报告'}`);

  const results: Outcome[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < customers.length) {
      const index = cursor++;
      const customer = customers[index];
      try {
        results[index] = await handleOne(customer, ai, cache);
        console.log(`[${index + 1}/${customers.length}] ${results[index].before.name} → ${JSON.stringify(results[index].patch)}`);
      } catch (error) {
        results[index] = { id: String(customer._id), email: customer.email, before: customer, patch: {}, ai: {}, note: '', error: (error as Error).message };
        console.log(`[${index + 1}/${customers.length}] 失败：${(error as Error).message}`);
      }
    }
  }));

  let updated = 0;
  if (APPLY) {
    for (const row of results) {
      if (!row || row.error || !Object.keys(row.patch).length) continue;
      await Customer.updateOne({ _id: row.id }, { $set: row.patch });
      updated += 1;
    }
  }

  const lines: string[] = [];
  lines.push(`# 邮件客户资料补齐报告 ${new Date().toISOString()} · ${APPLY ? '写库' : '只出报告'} · 共 ${results.length} 位 · 写入 ${updated} 位`);
  lines.push('');
  for (const row of results) {
    if (!row) continue;
    const changed = Object.keys(row.patch).length > 0;
    lines.push(`## ${row.before.name} <${row.email}>${row.error ? '  [失败] ' + row.error : changed ? '' : '  [无需改动]'}`);
    lines.push(`   原值：姓名=${row.before.name ?? '-'} | 公司=${row.before.company || '-'} | 行业=${row.before.industry || '-'} | 国家=${row.before.country || '-'} | 官网=${row.before.website || '-'}`);
    if (changed) lines.push(`   写入：${Object.entries(row.patch).map(([k, v]) => `${k}=${v === '' ? '（清空）' : v}`).join(' | ')}（AI 置信度 ${row.ai.confidence ?? '-'}）`);
    if (row.ai?.company) lines.push(`   AI 判断：公司=${row.ai.company} | 行业=${row.ai.industry} | 国家=${row.ai.country} | 官网=${row.ai.website || '-'} | 联系人=${row.ai.personName || '-'}`);
    lines.push(`   证据：${row.note}`);
    lines.push('');
  }
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
  console.log(`报告已写入 ${REPORT}`);
  await mongoose.connection.close();
}

main().catch(async (error) => { console.error('ERR', error); await mongoose.connection.close().catch(() => {}); process.exit(1); });
