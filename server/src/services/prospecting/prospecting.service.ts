import {randomUUID} from 'node:crypto';
import { Types } from 'mongoose';
import { createLogger } from '../../config/logger';
import { Customer } from '../../models/Customer';
import { DevelopmentLetter } from '../../models/DevelopmentLetter';
import { MailMessage } from '../../models/MailMessage';
import { Prospect, type ProspectStatus } from '../../models/Prospect';
import { ProspectingConfig,type SearchProfile } from '../../models/ProspectingConfig';
import { Project } from '../../models/Project';
import { firstOutreachGoal, projectPromptContext, resolveProjectSalesProfile } from '../project-profile';
import {prospectCustomerInput} from './prospect-customer';
import { describeDuplicate, findCustomerDuplicates } from '../customer-duplicate';
import { ProspectingRun } from '../../models/ProspectingRun';
import { requireProjectId,customerScope } from '../../utils/access';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../types/express';
import { createCustomer,getCustomerByIdOrThrow,getCustomer } from '../customer.service';
import { createAgentSession } from '../agent/agent.service';
import { createAgentTask } from '../agent/task.service';
import { normalizeCountry } from '../../utils/country';
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

export type ProspectScope = 'mine' | 'shared' | 'team' | 'all';

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
  /** serper = 搜索抓取；excel = 业务员导入 */
  source: 'serper' | 'excel';
  grade?: string;
  priority?: string;
  notes?: string;
  leadSource?: string;
  status: ProspectStatus;
  /** 负责人；空表示还在公共池 */
  ownerId?: string;
  ownerName?: string;
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

function ownerFields(raw: Record<string, unknown>) {
  const value = raw.ownerId as { _id?: unknown; displayName?: string; username?: string } | Types.ObjectId | string | null | undefined;
  if (!value) return { ownerId: undefined, ownerName: undefined };
  if (typeof value === 'object' && '_id' in value) {
    const populated = value as { _id?: unknown; displayName?: string; username?: string };
    return {
      ownerId: String(populated._id),
      ownerName: populated.displayName?.trim() || populated.username || undefined,
    };
  }
  return { ownerId: String(value), ownerName: undefined };
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
  source: (raw.source as 'serper' | 'excel') ?? 'serper',
  grade: raw.grade ? String(raw.grade) : undefined, priority: raw.priority ? String(raw.priority) : undefined,
  notes: raw.notes ? String(raw.notes) : undefined, leadSource: raw.leadSource ? String(raw.leadSource) : undefined,
  status: raw.status as ProspectStatus, ...ownerFields(raw), customerId: raw.customerId ? String(raw.customerId) : undefined,
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

/** 单个官网补全最多等这么久；底层请求会继续收尾，但不能拖住整轮候选生成。 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function executeRun(runId: string, actor: AuthUser) {
  const run = await ProspectingRun.findById(runId);
  if (!run) return;
  const startedAt = Date.now();
  const searchDeadline = startedAt + 3 * 60 * 1000;
  try {
    const config = run.settings ?? await getProspectingConfig(actor);
    const projectId = new Types.ObjectId(requireProjectId(actor));
    const queries = run.queries.length ? run.queries : DEFAULT_QUERIES;
    const collected: RawLead[] = [];
    for (const query of queries) {
      if (Date.now() > searchDeadline) {
        run.failed.push({ domain: 'search', reason: '搜索阶段超时，已保留已搜到的候选' });
        break;
      }
      try {
        // 单个搜索词最多等 30 秒；不能因为一条查询卡住，让整轮 20 条都没有进度。
        collected.push(...await withTimeout(serperSearch(query, 10), 30_000, '搜索超时'));
      } catch (error) {
        run.failed.push({ domain: `search:${query.slice(0, 40)}`, reason: error instanceof Error ? error.message : '搜索失败' });
      }
      run.imported = collected.length;
      await run.save();
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
    const enrichDeadline = Date.now() + 10 * 60 * 1000;
    let hunterUsed = 0;
    const enriched = await mapLimit(fresh.slice(0, config.enrichLimit), 4, async (lead) => {
      let result = lead;
      if (Date.now() > enrichDeadline) {
        run.failed.push({ domain: lead.domain, reason: '补全阶段超时，已保留搜索到的候选' });
        return result;
      }
      try {
        const remaining = Math.max(1, enrichDeadline - Date.now());
        result = await withTimeout(enrichLead(lead), Math.min(75_000, remaining), '官网补全超时（75秒），已保留搜索到的候选');
        run.enriched += 1;
        if (run.enriched % 3 === 0) await run.save().catch(() => undefined);
      } catch (error) {
        run.failed.push({ domain: lead.domain, reason: error instanceof Error ? error.message : '补全失败，已保留搜索到的候选' });
      }
      // Hunter only fills the gap: the site exposed no email and today's credit budget allows it.
      if (!result.emails?.length && hunterUsed < hunterLimit && Date.now() < enrichDeadline) {
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
        const project = await Project.findById(projectId).select('code slug name companyName industry website mailFrom senderName').lean();
        const salesProfile = resolveProjectSalesProfile(project);
        llmScores = await scoreLeadsWithLlm(enriched.map((lead) => ({
          domain: lead.domain, name: lead.name, country: lead.country, snippet: lead.snippet,
          excerpt: lead.excerpt, emails: lead.emails, contactTitle: lead.contactTitle,
        })), undefined, profileText, projectPromptContext(salesProfile));
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
            // 业务员自己发起的搜索归个人库；管理员/调度器生成的结果进公共池
            ...(actor.role !== 'admin' ? { ownerId: new Types.ObjectId(actor.id) } : {}),
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
    if (run.failed.length && !run.error) run.error = `部分候选未完成：${run.failed[0].reason}`;
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
  // 业务员也能自己搜索，但每天限一轮；管理员保留不限轮次的项目级操作
  if (actor.role !== 'admin' && await ProspectingRun.exists({
    projectId, day, triggeredBy: new Types.ObjectId(actor.id), status: { $in: ['running', 'completed', 'partial'] },
  })) {
    throw ApiError.conflict('你今天已经生成过一轮候选，请明天再试；也可以让管理员再跑一轮');
  }
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

export async function prospectingToday(
  actor: AuthUser,
  options: { status?: string; limit?: number; offset?: number; scope?: ProspectScope } = {},
) {
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const config = await getProspectingConfig(actor);
  const day = dayIn(config.timezone);
  let run = await ProspectingRun.findOne({ projectId, day }).sort({ createdAt: -1 }).lean();
  if (run?.status === 'running' && Date.now() - new Date(run.startedAt).getTime() > 15 * 60 * 1000) {
    await ProspectingRun.updateOne({ _id: run._id }, { $set: { status: 'failed', error: '运行超时，已标记失败', endedAt: new Date() } });
    run = await ProspectingRun.findOne({ projectId, day }).sort({ createdAt: -1 }).lean();
  }
  const order: Record<string, number> = { ready: 0, needs_contact: 1, low: 2, rejected: 3, converted: 4 };
  const OPEN = ['ready', 'needs_contact', 'low'];
  const status = (options.status ?? 'all').trim() || 'all';
  const limit = Math.min(500, Math.max(20, Number(options.limit) || 200));
  const offset = Math.max(0, Number(options.offset) || 0);
  const actorId = new Types.ObjectId(actor.id);
  const requestedScope = options.scope ?? (actor.role === 'admin' ? 'all' : 'mine');
  // 业务员只能看自己的和公共池；管理员可额外看团队（不含自己，避免和「我的」重复）
  const scope: ProspectScope = actor.role === 'admin'
    ? requestedScope
    : requestedScope === 'shared' ? 'shared' : 'mine';
  const scopeFilter: Record<string, unknown> =
    scope === 'mine' ? { ownerId: actorId } :
    scope === 'shared' ? { $or: [{ ownerId: { $exists: false } }, { ownerId: null }] } :
    scope === 'team' ? { ownerId: { $exists: true, $nin: [null, actorId] } } :
    {};
  const scoped = { projectId, ...scopeFilter };

  // 计数一律走数据库：线索池上千条时，不能用「这一页的长度」当总数
  const byStatus = await Prospect.aggregate<{ _id: string; count: number }>([
    { $match: { ...scoped, status: { $in: OPEN } } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const countOf = (key: string) => Number(byStatus.find((item) => item._id === key)?.count ?? 0);
  const openCounts = {
    ready: countOf('ready'),
    needs_contact: countOf('needs_contact'),
    low: countOf('low'),
  };
  const openAll = openCounts.ready + openCounts.needs_contact + openCounts.low;
  const openTotal = status === 'all' || status === 'converted' ? openAll : countOf(status);

  // Unhandled candidates carry over until approved/rejected; only handled states are day-scoped.
  const openFilter: Record<string, unknown> = { ...scoped, status: { $in: OPEN } };
  if (status !== 'all' && status !== 'converted') openFilter.status = status;
  const carried = status === 'converted'
    ? []
    : await Prospect.find(openFilter).sort({ day: -1, score: -1 }).skip(offset).limit(limit)
      .populate('ownerId', 'displayName username').lean();
  const finished = status === 'all' || status === 'converted'
    ? await Prospect.find({ ...scoped, day, status: { $in: ['converted', 'rejected'] } })
      .populate('ownerId', 'displayName username').lean()
    : [];
  const unique = new Map<string, (typeof carried)[number]>();
  for (const item of [...carried, ...finished]) unique.set(String(item._id), item);
  const prospects = [...unique.values()]
    .sort((a, b) => (order[a.status] - order[b.status]) || (b.score - a.score) || b.day.localeCompare(a.day));
  const convertedToday = await Prospect.countDocuments({ ...scoped, day, status: 'converted' });
  const carriedFromEarlier = await Prospect.countDocuments({
    ...scoped,
    status: { $in: OPEN },
    day: { $ne: day },
  });
  // 三个互斥范围的总数，供页签显示；都按未处理线索计，不含今天已转
  const scopeBuckets = await Prospect.aggregate<{ _id: string; count: number }>([
    { $match: { projectId, status: { $in: OPEN } } },
    {
      $addFields: {
        scopeBucket: {
          $cond: [
            { $eq: ['$ownerId', actorId] },
            'mine',
            { $cond: [{ $ifNull: ['$ownerId', null] }, 'team', 'shared'] },
          ],
        },
      },
    },
    { $group: { _id: '$scopeBucket', count: { $sum: 1 } } },
  ]);
  const scopeCountOf = (key: string) => Number(scopeBuckets.find((item) => item._id === key)?.count ?? 0);
  const scopeTotals = {
    mine: scopeCountOf('mine'),
    shared: scopeCountOf('shared'),
    team: scopeCountOf('team'),
  };
  const counts = {
    total: openAll,
    ready: openCounts.ready,
    needsContact: openCounts.needs_contact,
    low: openCounts.low,
    converted: convertedToday,
    carriedFromEarlier,
  };
  const dtos = prospects.map((p) => toProspect(p as unknown as Record<string, unknown>));
  await attachOutcomes(projectId, dtos);
  return {
    day,
    run: run ? toRun(run as unknown as Record<string, unknown>) : null,
    prospects: dtos,
    counts,
    scope,
    scopeTotals,
    /** 还有更多没返回（用 offset 翻页） */
    hasMore: offset + carried.length < openTotal,
    openTotal,
    offset,
    status,
  };
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

export async function claimProspect(actor: AuthUser, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('候选 ID 格式不正确');
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const existing = await Prospect.findOne({ _id: id, projectId }).lean();
  if (!existing) throw ApiError.notFound('候选不存在');
  if (existing.status === 'converted') throw ApiError.conflict('该候选已经转为客户');
  const owner = existing.ownerId ? String(existing.ownerId) : '';
  if (owner && owner !== actor.id) throw ApiError.conflict('这条线索已被其他业务员领取');
  if (owner === actor.id) return toProspect(existing as unknown as Record<string, unknown>);
  const claimed = await Prospect.findOneAndUpdate(
    { _id: id, projectId, status: { $ne: 'converted' }, $or: [{ ownerId: { $exists: false } }, { ownerId: null }] },
    { $set: { ownerId: new Types.ObjectId(actor.id) } },
    { new: true },
  ).lean();
  if (!claimed) throw ApiError.conflict('这条线索刚刚被其他业务员领取，请刷新后再试');
  return toProspect(claimed as unknown as Record<string, unknown>);
}

export async function releaseProspect(actor: AuthUser, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('候选 ID 格式不正确');
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const row = await Prospect.findOne({ _id: id, projectId });
  if (!row) throw ApiError.notFound('候选不存在');
  if (row.status === 'converted') throw ApiError.conflict('已转客户的线索不能放回公共池');
  const owner = row.ownerId ? String(row.ownerId) : '';
  if (!owner) return toProspect(row.toObject() as unknown as Record<string, unknown>);
  if (owner !== actor.id && actor.role !== 'admin') throw ApiError.conflict('只能放回自己领取的线索');
  const released = await Prospect.findOneAndUpdate(
    { _id: id, projectId, status: { $ne: 'converted' }, ownerId: new Types.ObjectId(owner) },
    { $unset: { ownerId: 1 } },
    { new: true },
  ).lean();
  if (!released) throw ApiError.conflict('线索状态已变化，请刷新后再试');
  return toProspect(released as unknown as Record<string, unknown>);
}

export async function approveProspect(actor: AuthUser, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('候选 ID 格式不正确');
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const prospect = await Prospect.findOne({ _id: id, projectId });
  if (!prospect) throw ApiError.notFound('候选不存在');
  if (prospect.status === 'converted') throw ApiError.conflict('该候选已经转为客户');
  const existingOwner = prospect.ownerId ? String(prospect.ownerId) : '';
  // 业务员只能处理自己的线索或公共池；管理员可以从团队视图代转，但负责人保持原业务员
  if (existingOwner && actor.role !== 'admin' && existingOwner !== actor.id) {
    throw ApiError.conflict('这条线索已被其他业务员领取');
  }
  if (!prospect.emails.length) throw ApiError.badRequest('该候选还没有邮箱，请先人工补联系方式或直接跳过');
  // 转客户前查重：邮箱或网站撞上已有客户就是重复，直接拦下；同公司名的先提示
  const duplicateReport = await findCustomerDuplicates(
    projectId,
    {
      email: prospect.emails[0],
      website: prospect.website,
      company: prospect.company,
      name: prospect.name,
      phone: prospect.phone,
    },
    { strictDomain: true },
  );
  if (duplicateReport.hard.length > 0) {
    const hit = duplicateReport.hard[0]!;
    throw new ApiError(
      409,
      `${describeDuplicate(hit)}，这条线索可能重复；确认是另一家客户，请先改线索的网站或邮箱再转`,
      'CONFLICT',
      [{ field: 'duplicateCustomerId', message: hit.id }],
    );
  }
  const ownerForCustomer = existingOwner || actor.id;
  // 原子领取/锁定：两个业务员同时点「转为客户」时，只有一个能过
  const claimFilter: Record<string, unknown> = { _id: id, projectId, status: { $ne: 'converted' } };
  if (existingOwner) claimFilter.ownerId = new Types.ObjectId(existingOwner);
  else claimFilter.$or = [{ ownerId: { $exists: false } }, { ownerId: null }];
  const claimed = await Prospect.findOneAndUpdate(
    claimFilter,
    { $set: { ownerId: new Types.ObjectId(ownerForCustomer) } },
    { new: true },
  );
  if (!claimed) throw ApiError.conflict('这条线索刚刚被其他业务员领取，请刷新后再试');
  try {
    const customer = await createCustomer(prospectCustomerInput(claimed), actor, { source: 'prospecting', ownerId: ownerForCustomer });
    claimed.status = 'converted';
    claimed.customerId = new Types.ObjectId(customer.id);
    claimed.convertedBy = new Types.ObjectId(actor.id);
    await claimed.save();
    // Queue the first-outreach draft immediately; the agent worker picks it up.
    // 目标必须从当前项目的销售画像生成，不能复用其他项目的行业话术。
    const project = await Project.findById(projectId)
      .select('code slug name companyName industry website mailFrom senderName')
      .lean();
    const salesProfile = resolveProjectSalesProfile(project);
    let draftTaskId: string | undefined;
    let draftError: string | undefined;
    try {
      const session = await createAgentSession({
        context: { type: 'customer', resourceId: customer.id },
        title: `自动开发 · ${customer.name}`,
      }, actor);
      const task = await createAgentTask({
        sessionId: session.id,
        goal: firstOutreachGoal(salesProfile),
        requestKey: `prospect:${String(claimed._id)}`,
        customerId: customer.id,
      }, actor);
      draftTaskId = task.id;
      claimed.draftTaskId = new Types.ObjectId(task.id);
      await claimed.save();
    } catch (error) {
      draftError = error instanceof Error ? error.message : '草稿任务创建失败';
      logger.warn(`自动草稿任务创建失败：${String(claimed.domain)}`, draftError);
    }
    return {
      prospect: toProspect(claimed.toObject() as unknown as Record<string, unknown>),
      customer,
      draftTaskId,
      draftError,
      // 同公司名 / 同电话的客户：已经建好了，提醒一句让人去核对
      duplicates: duplicateReport.soft.map((item) => ({ id: item.id, name: item.name, reason: describeDuplicate(item) })),
    };
  } catch (error) {
    // 公共池领取后建客户失败，释放回公共池；自己原本的线索保持归属
    if (!existingOwner) {
      await Prospect.updateOne(
        { _id: id, projectId, status: { $ne: 'converted' }, ownerId: new Types.ObjectId(actor.id) },
        { $unset: { ownerId: 1 } },
      );
    }
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
 const input={...prospectCustomerInput(prospect)};
 // 客户记录里的国家统一成中文简称；候选表保留官网原始写法
 input.country=normalizeCountry(input.country)??input.country;
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
  const filter: Record<string, unknown> = { _id: id, projectId, status: { $ne: 'converted' } };
  if (actor.role !== 'admin') {
    filter.$or = [{ ownerId: { $exists: false } }, { ownerId: null }, { ownerId: new Types.ObjectId(actor.id) }];
  }
  const prospect = await Prospect.findOneAndUpdate(
    filter,
    { $set: { status: 'rejected', rejectReason: reason?.slice(0, 500) || '人工跳过' } },
    { new: true },
  ).lean();
  if (!prospect) throw ApiError.notFound('候选不存在、已被其他业务员领取或已转客户');
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
