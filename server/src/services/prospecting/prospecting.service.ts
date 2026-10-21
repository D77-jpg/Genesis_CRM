import {randomUUID} from 'node:crypto';
import { Types } from 'mongoose';
import { createLogger } from '../../config/logger';
import { Customer } from '../../models/Customer';
import { DevelopmentLetter } from '../../models/DevelopmentLetter';
import { MailMessage } from '../../models/MailMessage';
import { Prospect, type ProspectStatus } from '../../models/Prospect';
import { ProspectingConfig,type SearchProfile } from '../../models/ProspectingConfig';
import {prospectCustomerInput} from './prospect-customer';
import { ProspectingRun } from '../../models/ProspectingRun';
import { requireProjectId,customerScope } from '../../utils/access';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../types/express';
import { createCustomer,getCustomerByIdOrThrow,getCustomer } from '../customer.service';
import { createAgentSession } from '../agent/agent.service';
import { createAgentTask } from '../agent/task.service';
import { dedupeLeads, domainOf, enrichLead, serperSearch, type RawLead } from './lead-source';
import { hunterDomainSearch } from './hunter';
import { mergeScores, scoreLeadsWithLlm, type LlmScore } from './llm-scoring';
import { loadProfileText } from './profile';
import { scoreLead } from './scoring';

const logger = createLogger('prospecting');

export const DEFAULT_QUERIES = [
  'independent jewelry brand "made in usa" shop -site:etsy.com -site:amazon.com',
  'handmade candle brand usa online store -site:etsy.com',
  'jewelry designer usa "our story" online shop -site:etsy.com',
  'skincare brand usa "our story" -site:etsy.com',
];

export interface ProspectDto {
  id: string;
  day: string;
  domain: string;
  website: string;
  name?: string;
  company?: string;
  country?: string;
  emails: string[];
  emailSource?: 'site' | 'hunter';
  emailConfidence?: number;
  contactName?: string;
  contactTitle?: string;
  phone?:string;address?:string;industry?:string;facebook?:string;whatsapp?:string;
  contactSources?:RawLead['contactSources'];
  instagram?: string;
  linkedin?: string;
  snippet?: string;
  excerpt?: string;
  sourceUrl: string;
  score: number;
  aiScore?: number;
  reasons: string[];
  status: ProspectStatus;
  customerId?: string;
  draftTaskId?: string;
  outcome?: { sent: number; replied: number; bounced: number };
  createdAt: string;
}

export interface RunDto {
  id: string;
  day: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  queries: string[];
  profileId?:string;profileName?:string;
  imported: number;
  deduped: number;
  enriched: number;
  hunterFound: number;
  scored: number;
  selected: number;
  failed: { domain: string; reason: string }[];
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

const toProspect = (raw: Record<string, unknown>): ProspectDto => ({
  id: String(raw._id), day: String(raw.day), domain: String(raw.domain), website: String(raw.website),
  name: raw.name ? String(raw.name) : undefined, company: raw.company ? String(raw.company) : undefined,
  phone:raw.phone?String(raw.phone):undefined,address:raw.address?String(raw.address):undefined,industry:raw.industry?String(raw.industry):undefined,
  facebook:raw.facebook?String(raw.facebook):undefined,whatsapp:raw.whatsapp?String(raw.whatsapp):undefined,contactSources:raw.contactSources as RawLead['contactSources'],
  country: raw.country ? String(raw.country) : undefined, emails: (raw.emails as string[]) ?? [],
  emailSource: raw.emailSource as 'site' | 'hunter' | undefined,
  emailConfidence: raw.emailConfidence ? Number(raw.emailConfidence) : undefined,
  contactName: raw.contactName ? String(raw.contactName) : undefined,
  contactTitle: raw.contactTitle ? String(raw.contactTitle) : undefined,
  instagram: raw.instagram ? String(raw.instagram) : undefined, linkedin: raw.linkedin ? String(raw.linkedin) : undefined,
  snippet: raw.snippet ? String(raw.snippet) : undefined, excerpt: raw.excerpt ? String(raw.excerpt) : undefined,
  sourceUrl: String(raw.sourceUrl), score: Number(raw.score ?? 0), aiScore: raw.aiScore ? Number(raw.aiScore) : undefined, reasons: (raw.scoreReasons as string[]) ?? [],
  status: raw.status as ProspectStatus, customerId: raw.customerId ? String(raw.customerId) : undefined,
  draftTaskId: raw.draftTaskId ? String(raw.draftTaskId) : undefined,
  createdAt: (raw.createdAt as Date).toISOString(),
});

const toRun = (raw: Record<string, unknown>): RunDto => ({
  id: String(raw._id), day: String(raw.day), status: raw.status as RunDto['status'], queries: (raw.queries as string[]) ?? [],
  profileId:raw.profileId?String(raw.profileId):undefined,profileName:raw.profileName?String(raw.profileName):undefined,
  imported: Number(raw.imported ?? 0), deduped: Number(raw.deduped ?? 0), enriched: Number(raw.enriched ?? 0),
  hunterFound: Number(raw.hunterFound ?? 0),
  scored: Number(raw.scored ?? 0), selected: Number(raw.selected ?? 0), failed: (raw.failed as RunDto['failed']) ?? [],
  error: raw.error ? String(raw.error) : undefined,
  startedAt: raw.startedAt ? (raw.startedAt as Date).toISOString() : undefined,
  endedAt: raw.endedAt ? (raw.endedAt as Date).toISOString() : undefined,
});

export function dayIn(timezone: string) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

export async function getProspectingConfig(actor: AuthUser) {
 const projectId=new Types.ObjectId(requireProjectId(actor));
 const existing=await ProspectingConfig.findOne({projectId}).lean()??await ProspectingConfig.findOneAndUpdate({projectId},{$setOnInsert:{projectId,updatedBy:actor.id}},{upsert:true,new:true,setDefaultsOnInsert:true}).lean();
 const profiles:SearchProfile[]=existing.profiles?.length?existing.profiles:[{id:'default',name:'原默认方案',queries:existing.queries.length?existing.queries:DEFAULT_QUERIES,enrichLimit:existing.enrichLimit,hunterLimit:existing.hunterLimit??15,minScore:existing.minScore,llmScoring:existing.llmScoring??true}];
 const activeProfileId=profiles.some(p=>p.id===existing.activeProfileId)?existing.activeProfileId!:profiles[0].id;
 return {...existing,profiles,activeProfileId,version:existing.version??0};
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function executeRun(runId: string, actor: AuthUser) {
  const run = await ProspectingRun.findById(runId);
  if (!run) return;
  try {
    const config = run.settings ?? await getProspectingConfig(actor);
    const projectId = new Types.ObjectId(requireProjectId(actor));
    const queries = run.queries.length ? run.queries : DEFAULT_QUERIES;
    const collected: RawLead[] = [];
    for (const query of queries) {
      try { collected.push(...await serperSearch(query, 10)); }
      catch (error) { run.failed.push({ domain: `search:${query.slice(0, 40)}`, reason: error instanceof Error ? error.message : '搜索失败' }); }
    }
    run.imported = collected.length;
    const unique = dedupeLeads(collected);
    const taken = new Set<string>();
    for (const existing of await Prospect.find({ projectId }).select('domain').lean()) taken.add(existing.domain);
    for (const customer of await Customer.find({ projectId }).select('website email').lean()) {
      const domain = customer.website ? domainOf(customer.website) : '';
      if (domain) taken.add(domain);
    }
    const fresh = unique.filter((lead) => !taken.has(lead.domain));
    run.deduped = fresh.length;
    await run.save();
    const hunterLimit = config.hunterLimit ?? 15;
    let hunterUsed = 0;
    const enriched = await mapLimit(fresh.slice(0, config.enrichLimit), 3, async (lead) => {
      let result = lead;
      try {
        result = await enrichLead(lead);
        run.enriched += 1;
        if (run.enriched % 3 === 0) await run.save().catch(() => undefined);
      } catch (error) {
        run.failed.push({ domain: lead.domain, reason: error instanceof Error ? error.message : '补全失败' });
      }
      // Hunter only fills the gap: the site exposed no email and today's credit budget allows it.
      if (!result.emails?.length && hunterUsed < hunterLimit) {
        hunterUsed += 1;
        try {
          const found = await hunterDomainSearch(result.domain);
          if (found.emails.length) {
            result.emails = found.emails.slice(0, 3).map((item) => item.value);
            result.emailSource = 'hunter';
            result.emailConfidence = found.emails[0].confidence;
            result.contactName = found.contactName;
            result.contactTitle = found.contactTitle;
            result.company??=found.organization;result.phone??=found.phone;result.linkedin??=found.linkedin;
            result.contactSources=[...(result.contactSources??[]),{source:'hunter',url:'https://hunter.io/search/'+result.domain,fields:['emails',...(found.organization?['company']:[]),...(found.contactName?['contactName']:[]),...(found.contactTitle?['contactTitle']:[]),...(found.phone?['phone']:[]),...(found.linkedin?['linkedin']:[])]}];
            run.hunterFound += 1;
          }
        } catch (error) {
          run.failed.push({ domain: result.domain, reason: `Hunter: ${error instanceof Error ? error.message : '查询失败'}` });
        }
      }
      return result;
    });
    let selected = 0;
    let llmScores = new Map<string, LlmScore>();
    if (config.llmScoring !== false && enriched.length) {
      try {
        const profileText = await loadProfileText(projectId).catch(() => null);
        llmScores = await scoreLeadsWithLlm(enriched.map((lead) => ({
          domain: lead.domain, name: lead.name, country: lead.country, snippet: lead.snippet,
          excerpt: lead.excerpt, emails: lead.emails, contactTitle: lead.contactTitle,
        })), undefined, profileText);
      } catch (error) {
        run.failed.push({ domain: 'llm', reason: error instanceof Error ? error.message : 'AI 评分失败' });
      }
    }
    for (const lead of enriched) {
      const rule = scoreLead(lead, config.minScore);
      const ai = llmScores.get(lead.domain.toLowerCase());
      const scored = mergeScores(rule, ai, config.minScore);
      if (scored.status === 'ready') selected += 1;
      await Prospect.updateOne(
        { projectId, domain: lead.domain },
        {
          $setOnInsert: {
            projectId, day: run.day, domain: lead.domain, website: lead.website,
            name: lead.name, company: lead.company, country:lead.country,phone:lead.phone,address:lead.address,industry:lead.industry,facebook:lead.facebook,whatsapp:lead.whatsapp,contactSources:lead.contactSources, emails: lead.emails ?? [], instagram: lead.instagram,
            emailSource: lead.emailSource, emailConfidence: lead.emailConfidence,
            contactName: lead.contactName, contactTitle: lead.contactTitle,
            linkedin: lead.linkedin, snippet: lead.snippet, excerpt: lead.excerpt, sourceUrl: lead.sourceUrl,
            source: 'serper', score: scored.score, aiScore: ai?.score, scoreReasons: scored.reasons, status: scored.status,
          },
        },
        { upsert: true },
      ).catch((error: { code?: number }) => {
        if (error.code !== 11000) throw error;
      });
      run.scored += 1;
    }
    run.selected = selected;
    run.status = run.failed.length ? 'partial' : 'completed';
  } catch (error) {
    run.status = 'failed';
    run.error = error instanceof Error ? error.message : '运行失败';
  } finally {
    run.endedAt = new Date();
    await run.save();
  }
}

/** Starts a run and returns immediately; the page polls GET /prospecting/today. */
export async function startProspecting(actor: AuthUser, input: { profileId?:string;queries?: string[]; enrichLimit?: number } = {}) {
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const running = await ProspectingRun.findOne({ projectId, status: 'running', startedAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) } }).lean();
  if (running) throw ApiError.conflict('已有一次生成正在运行，请稍后刷新');
  const config = await getProspectingConfig(actor);
  const selected=config.profiles.find(p=>p.id===(input.profileId??config.activeProfileId));
  if(!selected)throw ApiError.badRequest('搜索方案不存在，请重新选择');
  const day = dayIn(config.timezone);
  const run = await ProspectingRun.create({
    projectId, day, status: 'running', triggeredBy: new Types.ObjectId(actor.id),
    queries: input.queries?.length ? input.queries : selected.queries,
    profileId:selected.id,profileName:selected.name,
    settings:{enrichLimit:input.enrichLimit??selected.enrichLimit,hunterLimit:selected.hunterLimit,minScore:selected.minScore,llmScoring:selected.llmScoring},
  });
  const actorSnapshot = { ...actor };
  void executeRun(String(run._id), actorSnapshot);
  return toRun(run.toObject() as unknown as Record<string, unknown>);
}

export async function prospectingToday(actor: AuthUser) {
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const config = await getProspectingConfig(actor);
  const day = dayIn(config.timezone);
  let run = await ProspectingRun.findOne({ projectId, day }).sort({ createdAt: -1 }).lean();
  if (run?.status === 'running' && Date.now() - new Date(run.startedAt).getTime() > 15 * 60 * 1000) {
    await ProspectingRun.updateOne({ _id: run._id }, { $set: { status: 'failed', error: '运行超时，已标记失败', endedAt: new Date() } });
    run = await ProspectingRun.findOne({ projectId, day }).sort({ createdAt: -1 }).lean();
  }
  const order: Record<string, number> = { ready: 0, needs_contact: 1, low: 2, rejected: 3, converted: 4 };
  // Unhandled candidates carry over until approved/rejected; only handled states are day-scoped.
  const carried = await Prospect.find({ projectId, status: { $in: ['ready', 'needs_contact', 'low'] } })
    .sort({ day: -1, score: -1 }).limit(200).lean();
  const finished = await Prospect.find({ projectId, day, status: { $in: ['converted', 'rejected'] } }).lean();
  const unique = new Map<string, (typeof carried)[number]>();
  for (const item of [...carried, ...finished]) unique.set(String(item._id), item);
  const prospects = [...unique.values()]
    .sort((a, b) => (order[a.status] - order[b.status]) || (b.score - a.score) || b.day.localeCompare(a.day));
  const counts = {
    total: prospects.length,
    ready: prospects.filter((p) => p.status === 'ready').length,
    needsContact: prospects.filter((p) => p.status === 'needs_contact').length,
    low: prospects.filter((p) => p.status === 'low').length,
    converted: prospects.filter((p) => p.status === 'converted').length,
    carriedFromEarlier: prospects.filter((p) => p.day !== day && ['ready', 'needs_contact', 'low'].includes(p.status)).length,
  };
  const dtos = prospects.map((p) => toProspect(p as unknown as Record<string, unknown>));
  await attachOutcomes(projectId, dtos);
  return { day, run: run ? toRun(run as unknown as Record<string, unknown>) : null, prospects: dtos, counts };
}

async function attachOutcomes(projectId: Types.ObjectId, prospects: ProspectDto[]) {
  const ids = prospects.filter((item) => item.status === 'converted' && item.customerId)
    .map((item) => new Types.ObjectId(item.customerId));
  if (!ids.length) return;
  const [sent, bounced, replied] = await Promise.all([
    DevelopmentLetter.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { projectId, customerId: { $in: ids }, status: { $in: ['sent', 'opened'] } } },
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
    ]),
    DevelopmentLetter.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { projectId, customerId: { $in: ids }, status: 'failed' } },
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
    ]),
    MailMessage.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { projectId, customerId: { $in: ids }, deleted: { $ne: true } } },
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
    ]),
  ]);
  const map = new Map<string, { sent: number; replied: number; bounced: number }>();
  const bump = (rows: { _id: Types.ObjectId; count: number }[], key: 'sent' | 'bounced' | 'replied') => {
    for (const row of rows) {
      const entry = map.get(String(row._id)) ?? { sent: 0, replied: 0, bounced: 0 };
      entry[key] = row.count;
      map.set(String(row._id), entry);
    }
  };
  bump(sent, 'sent'); bump(bounced, 'bounced'); bump(replied, 'replied');
  for (const item of prospects) {
    if (item.customerId && item.status === 'converted') item.outcome = map.get(item.customerId) ?? { sent: 0, replied: 0, bounced: 0 };
  }
}

/** 24h project-wide bounce guard; used by the scheduler and the report. */
export function bounceRisk(sent: number, bounced: number) {
  const rate = sent ? bounced / sent : 0;
  return { sent, bounced, rate, risky: bounced >= 5 || (sent >= 10 && rate > 0.08) };
}

export async function recentBounceRisk(projectId: Types.ObjectId) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [sent, bounced] = await Promise.all([
    DevelopmentLetter.countDocuments({ projectId, status: { $in: ['sent', 'opened'] }, sentAt: { $gte: since } }),
    DevelopmentLetter.countDocuments({ projectId, status: 'failed', updatedAt: { $gte: since } }),
  ]);
  return bounceRisk(sent, bounced);
}

export async function approveProspect(actor: AuthUser, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('候选 ID 格式不正确');
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const prospect = await Prospect.findOne({ _id: id, projectId });
  if (!prospect) throw ApiError.notFound('候选不存在');
  if (prospect.status === 'converted') throw ApiError.conflict('该候选已经转为客户');
  if (!prospect.emails.length) throw ApiError.badRequest('该候选还没有邮箱，请先人工补联系方式或直接跳过');
  const config = await getProspectingConfig(actor);
  try {
    const customer = await createCustomer(prospectCustomerInput(prospect), actor, { source: 'prospecting', ownerId: config.ownerId ? String(config.ownerId) : undefined });
    prospect.status = 'converted';
    prospect.customerId = new Types.ObjectId(customer.id);
    prospect.convertedBy = new Types.ObjectId(actor.id);
    await prospect.save();
    // Queue the first-outreach draft immediately; the agent worker picks it up.
    let draftTaskId: string | undefined;
    let draftError: string | undefined;
    try {
      const session = await createAgentSession({
        context: { type: 'customer', resourceId: customer.id },
        title: `自动开发 · ${customer.name}`,
      }, actor);
      const task = await createAgentTask({
        sessionId: session.id,
        goal: '为首封开发信准备英文草稿，收件人是刚通过审核的新客户',
        requestKey: `prospect:${String(prospect._id)}`,
        customerId: customer.id,
      }, actor);
      draftTaskId = task.id;
      prospect.draftTaskId = new Types.ObjectId(task.id);
      await prospect.save();
    } catch (error) {
      draftError = error instanceof Error ? error.message : '草稿任务创建失败';
      logger.warn(`自动草稿任务创建失败：${String(prospect.domain)}`, draftError);
    }
    return { prospect: toProspect(prospect.toObject() as unknown as Record<string, unknown>), customer, draftTaskId, draftError };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 409) throw ApiError.conflict('该邮箱或公司已经存在于客户列表');
    throw error;
  }
}

/** Explicit bounded re-acquisition for legacy records; paid API calls require admin. */
export async function refreshProspectContact(actor:AuthUser,id:string){
 if(actor.role!=='admin')throw ApiError.forbidden('仅管理员可重新采集官网资料');
 if(!Types.ObjectId.isValid(id))throw ApiError.badRequest('候选 ID 格式不正确');
 const projectId=requireProjectId(actor),row=await Prospect.findOne({_id:id,projectId});
 if(!row)throw ApiError.notFound('候选不存在或不可访问');
 if(row.customerId)await getCustomerByIdOrThrow(String(row.customerId),actor);
 const token=randomUUID(),now=new Date();
 const locked=await Prospect.findOneAndUpdate({_id:id,projectId,$and:[{$or:[{contactRefreshUntil:{$exists:false}},{contactRefreshUntil:{$lte:now}}]},{$or:[{contactRefreshedAt:{$exists:false}},{contactRefreshedAt:{$lt:new Date(now.getTime()-60000)}}]}]},{$set:{contactRefreshToken:token,contactRefreshUntil:new Date(now.getTime()+600000)}},{new:true});
 if(!locked)throw ApiError.conflict('该候选正在更新或刚刚更新，请稍后再试');
 try{
  const result=await enrichLead(locked.toObject());
  if(!result.pagesRead)throw ApiError.badRequest('官网未返回可读资料，请检查 Firecrawl 配置、额度或官网可访问性');
  const keys=['company','country','phone','address','industry','instagram','linkedin','facebook','whatsapp','emails','emailSource','excerpt','contactSources'] as const;
  const patch=Object.fromEntries(keys.flatMap(key=>result[key]===undefined?[]:[[key,result[key]]]));
  await Prospect.updateOne({_id:id,projectId,contactRefreshToken:token},{$set:{...patch,contactRefreshedAt:new Date()}},{runValidators:true});
  if(result.emails?.length){const config=await getProspectingConfig(actor),scored=scoreLead(result,config.minScore);await Prospect.updateOne({_id:id,projectId,contactRefreshToken:token,status:'needs_contact'},{$set:{status:scored.status,score:scored.score,scoreReasons:scored.reasons}});}
  const latest=await Prospect.findOne({_id:id,projectId});
  const synced=latest?.status==='converted'?await syncProspectCustomer(actor,id):undefined;
  return {prospect:latest?toProspect(latest.toObject() as unknown as Record<string,unknown>):undefined,filledFields:synced?.filledFields??[]};
 }finally{await Prospect.updateOne({_id:id,projectId,contactRefreshToken:token},{$unset:{contactRefreshToken:1,contactRefreshUntil:1}});}
}

/** Backfill existing converted records from acquired data; never replace manual edits. */
export async function syncProspectCustomer(actor:AuthUser,id:string){
 if(!Types.ObjectId.isValid(id))throw ApiError.badRequest('候选 ID 格式不正确');
 const prospect=await Prospect.findOne({_id:id,projectId:requireProjectId(actor),status:'converted'});
 if(!prospect?.customerId)throw ApiError.notFound('候选尚未转客户或不可访问');
 const customer=await getCustomerByIdOrThrow(String(prospect.customerId),actor);
 const input=prospectCustomerInput(prospect);
 const keys=['company','title','country','phone','address','industry','instagram','linkedin','facebook','whatsapp'] as const;
 const filled:string[]=[];
 for(const key of keys){const value=input[key];if(!value)continue;
  const changed=await Customer.updateOne({...customerScope(actor),_id:customer._id,[key]:{$in:['',null]}},{$set:{[key]:value}},{runValidators:true});
  if(changed.modifiedCount)filled.push(key);
 }
 const marker='候选资料补齐 '+prospect.id;
 const old=customer.notes??'';
 if(!old.includes(marker)&&old.length<4500){
  await Customer.updateOne({...customerScope(actor),_id:customer._id,notes:customer.notes??{$exists:false}},{$set:{notes:(old+'\n'+marker+'\n'+input.notes).trim().slice(0,5000)}},{runValidators:true});
 }
 return {customer:await getCustomer(String(customer._id),actor),filledFields:filled};
}

export async function rejectProspect(actor: AuthUser, id: string, reason?: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('候选 ID 格式不正确');
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const prospect = await Prospect.findOneAndUpdate(
    { _id: id, projectId, status: { $ne: 'converted' } },
    { $set: { status: 'rejected', rejectReason: reason?.slice(0, 500) || '人工跳过' } },
    { new: true },
  ).lean();
  if (!prospect) throw ApiError.notFound('候选不存在或已转客户');
  return toProspect(prospect as unknown as Record<string, unknown>);
}

function daysAgo(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function prospectingReport(actor: AuthUser, days = 14) {
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const config = await getProspectingConfig(actor);
  const today = dayIn(config.timezone);
  const sinceDay = daysAgo(today, Math.max(0, days - 1));
  const runs = await ProspectingRun.find({ projectId, day: { $gte: sinceDay } })
    .sort({ day: -1, createdAt: -1 }).limit(100).lean();
  const grouped = await Prospect.aggregate<{ _id: { day: string; status: string }; count: number }>([
    { $match: { projectId, day: { $gte: sinceDay } } },
    { $group: { _id: { day: '$day', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const daily = new Map<string, { day: string; candidates: number; ready: number; needsContact: number; low: number; rejected: number; converted: number }>();
  for (const row of grouped) {
    const day = row._id.day;
    const entry = daily.get(day) ?? { day, candidates: 0, ready: 0, needsContact: 0, low: 0, rejected: 0, converted: 0 };
    entry.candidates += row.count;
    if (row._id.status === 'ready') entry.ready += row.count;
    if (row._id.status === 'needs_contact') entry.needsContact += row.count;
    if (row._id.status === 'low') entry.low += row.count;
    if (row._id.status === 'rejected') entry.rejected += row.count;
    if (row._id.status === 'converted') entry.converted += row.count;
    daily.set(day, entry);
  }
  const convertedIds = (await Prospect.find({ projectId, status: 'converted', customerId: { $exists: true } })
    .select('customerId').lean()).map((item) => item.customerId).filter(Boolean);
  const start = new Date(Date.now() - days * 86400000);
  const [sent, bounced, replies] = convertedIds.length ? await Promise.all([
    DevelopmentLetter.countDocuments({ projectId, customerId: { $in: convertedIds }, status: { $in: ['sent', 'opened'] }, sentAt: { $gte: start } }),
    DevelopmentLetter.countDocuments({ projectId, customerId: { $in: convertedIds }, status: 'failed', updatedAt: { $gte: start } }),
    MailMessage.countDocuments({ projectId, customerId: { $in: convertedIds }, sentAt: { $gte: start }, deleted: { $ne: true } }),
  ]) : [0, 0, 0];
  const list = [...daily.values()].sort((a, b) => b.day.localeCompare(a.day));
  const totals = {
    candidates: list.reduce((sum, item) => sum + item.candidates, 0),
    ready: list.reduce((sum, item) => sum + item.ready, 0),
    needsContact: list.reduce((sum, item) => sum + item.needsContact, 0),
    low: list.reduce((sum, item) => sum + item.low, 0),
    rejected: list.reduce((sum, item) => sum + item.rejected, 0),
    converted: list.reduce((sum, item) => sum + item.converted, 0),
    sent, bounced, replies,
  };
  const bounce = await recentBounceRisk(projectId);
  return {
    days, sinceDay, today, runs: runs.map((run) => toRun(run as unknown as Record<string, unknown>)),
    daily: list, totals, bounce,
    warning: bounce.risky ? {
      code: 'bounce_rate',
      message: `过去 24 小时发出 ${bounce.sent} 封、退信 ${bounce.bounced} 封（${Math.round(bounce.rate * 100)}%），已暂停自动生成；请先检查邮箱配置与名单质量，再手动重新开启。`,
    } : undefined,
  };
}

export async function updateProspectingConfig(actor:AuthUser,input:Record<string,unknown>){
 const current=await getProspectingConfig(actor);
 const {version,...values}=input;
 const profiles=(values.profiles as SearchProfile[]|undefined)??current.profiles;
 const activeProfileId=String(values.activeProfileId??current.activeProfileId);
 const active=profiles.find(p=>p.id===activeProfileId);
 if(!active)throw ApiError.badRequest('自动执行方案必须是已保存的方案');
 // Older clients can still change the single active profile's fields.
 const legacy=['queries','enrichLimit','hunterLimit','minScore','llmScoring'] as const;
 if(!values.profiles)for(const key of legacy)if(values[key]!==undefined)Object.assign(active,{[key]:values[key]});
 const patch={...values,profiles,activeProfileId,...Object.fromEntries(legacy.map(key=>[key,active[key]])),updatedBy:new Types.ObjectId(actor.id)};
 const filter={projectId:current.projectId,...(version!==undefined?{version:version===0?{$in:[0,null]}:version}:{})};
 const updated=await ProspectingConfig.findOneAndUpdate(filter,{$set:patch,$inc:{version:1}},{new:true,runValidators:true}).lean();
 if(!updated)throw ApiError.conflict('搜索方案已被其他人修改，请重新打开设置');
 return updated;
}
