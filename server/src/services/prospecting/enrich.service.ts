/**
 * 线索批量补全
 * ------------------------------------------------------------------
 * Excel 导入的线索经常缺邮箱、电话、社媒。这里把补全做成一个后台任务：
 *
 *   1. discover —— 连官网都没有的：用 Serper 按「公司名 + 国家」找官网（只用品牌词命中的域名）
 *   2. site     —— 有官网的：抓首页 + /contact + /about（最多 3 页），抽邮箱、电话、社媒、地址
 *   3. hunter   —— 抓完还没有邮箱的：用 Hunter 按域名找邮箱
 *
 * 原则：只补空字段，绝不覆盖业务员在 Excel 里填的内容（备注尤其不能动）。
 * 任务状态写在 ProspectEnrichRun 里，前端轮询看进度，可以中途取消。
 */
import { Types } from 'mongoose';
import { createLogger } from '../../config/logger';
import { Customer } from '../../models/Customer';
import { Prospect } from '../../models/Prospect';
import { ProspectEnrichRun, type EnrichMode, type IProspectEnrichRun } from '../../models/ProspectEnrichRun';
import { requireProjectId } from '../../utils/access';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../types/express';
import { enrichLead, serperSearch, type RawLead } from './lead-source';
import { hunterDomainSearch } from './hunter';

const logger = createLogger('prospect-enrich');

/** 同时跑几条：Hunter 有每秒限流，3 路比较稳 */
const CONCURRENCY = 3;
const MAX_QUEUE = 5000;
const ERROR_KEEP = 40;

export interface EnrichScopeInput {
  grade?: string;
  source?: string;
}

export interface EnrichRunDto {
  id: string;
  status: IProspectEnrichRun['status'];
  modes: EnrichMode[];
  scope: EnrichScopeInput;
  total: number;
  done: number;
  siteFilled: number;
  hunterFilled: number;
  discovered: number;
  stillMissing: number;
  failed: number;
  failures: { name?: string; message: string }[];
  startedAt: string;
  endedAt?: string;
  heartbeatAt?: string;
}

export interface EnrichPreviewDto {
  /** 正在跑的任务（前端打开弹窗直接接着看进度） */
  activeRun?: EnrichRunDto;
  /** 这次会被补全的线索数 */
  pending: number;
  /** 有官网，可以直接抓 */
  withWebsite: number;
  /** 连官网都没有，需要先搜 */
  withoutWebsite: number;
  /** 抓完能接着用 Hunter 的条数（有真实域名的） */
  hunterReady: number;
  /** 预估外部调用次数 */
  estimate: { crawl: number; hunter: number; search: number };
}

/** 域名像不像真域名（Excel 导入没有官网时会把公司名 slug 当 domain） */
function isRealHost(domain: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain);
}

function hostOf(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 品牌词命中：公司名里的词出现在域名里，才认为这是「这家公司自己的官网」 */
function brandScore(company: string, domain: string): number {
  const tokens = company
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 3);
  const flat = domain.replace(/[^a-z0-9]/g, '');
  return tokens.filter((token) => flat.includes(token.replace(/[^a-z0-9]/g, ''))).length;
}

/** 待补全的线索：没有邮箱、且还在池子里（没被跳过/转过客户） */
function scopeQuery(projectId: Types.ObjectId, scope: EnrichScopeInput): Record<string, unknown> {
  const and: Record<string, unknown>[] = [
    { $or: [{ emails: { $size: 0 } }, { emails: { $exists: false } }] },
  ];
  const grade = (scope.grade ?? '').trim().toUpperCase();
  if (grade) {
    and.push({
      $or: [
        { grade },
        // 搜索来的线索没有等级，用分数兜底
        ...(grade === 'A' ? [{ grade: { $exists: false }, score: { $gte: 85 } }] : []),
      ],
    });
  }
  const source = (scope.source ?? '').trim();
  if (source) and.push({ source });
  return { projectId, status: { $in: ['needs_contact', 'ready', 'low'] }, $and: and };
}

function toDto(doc: IProspectEnrichRun & { _id: unknown }): EnrichRunDto {
  return {
    id: String(doc._id),
    status: doc.status,
    modes: doc.modes ?? [],
    scope: doc.scope ?? {},
    total: doc.total ?? 0,
    done: doc.done ?? 0,
    siteFilled: doc.siteFilled ?? 0,
    hunterFilled: doc.hunterFilled ?? 0,
    discovered: doc.discovered ?? 0,
    stillMissing: doc.stillMissing ?? 0,
    failed: doc.failed ?? 0,
    failures: (doc.failures ?? []).slice(-ERROR_KEEP),
    startedAt: (doc.startedAt ?? new Date()).toISOString(),
    endedAt: doc.endedAt ? doc.endedAt.toISOString() : undefined,
    heartbeatAt: doc.heartbeatAt ? doc.heartbeatAt.toISOString() : undefined,
  };
}

/** 开跑之前的预估：让人知道会花多少次外部调用 */
export async function previewEnrich(actor: AuthUser, scope: EnrichScopeInput): Promise<EnrichPreviewDto> {
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const base = scopeQuery(projectId, scope);
  const withWebsite = await Prospect.countDocuments({ ...base, website: { $nin: ['', null] } });
  const pending = await Prospect.countDocuments(base);
  const withoutWebsite = Math.max(0, pending - withWebsite);
  const hunterReady = await Prospect.countDocuments({ ...base, domain: { $regex: '\\.' } });
  const active = await ProspectEnrichRun.findOne({ projectId, status: 'running' })
    .sort({ createdAt: -1 })
    .lean();
  return {
    activeRun: active ? toDto(active as unknown as IProspectEnrichRun & { _id: unknown }) : undefined,
    pending,
    withWebsite,
    withoutWebsite,
    hunterReady,
    // 每条最多抓 3 页；没官网的先搜 1 次
    estimate: { crawl: withWebsite * 3, hunter: hunterReady, search: withoutWebsite },
  };
}

export async function startEnrichRun(
  actor: AuthUser,
  input: { modes: EnrichMode[]; scope?: EnrichScopeInput; limit?: number },
): Promise<EnrichRunDto> {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可批量补全联系方式（会消耗抓取与邮箱查找额度）');
  const modes = [...new Set(input.modes)];
  if (modes.length === 0) throw ApiError.badRequest('至少选择一种补全方式');
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const scope = { grade: input.scope?.grade ?? '', source: input.scope?.source ?? '' };

  const limit = Math.min(MAX_QUEUE, Math.max(1, Number(input.limit) || MAX_QUEUE));
  const queue = await Prospect.find(scopeQuery(projectId, scope))
    .sort({ grade: 1, score: -1 })
    .limit(limit)
    .select('_id')
    .lean();
  if (queue.length === 0) throw ApiError.badRequest('没有需要补全的线索（都有邮箱了）');

  const run = await ProspectEnrichRun.create({
    projectId,
    status: 'running',
    modes,
    scope,
    queue: queue.map((item) => item._id),
    total: queue.length,
    triggeredBy: new Types.ObjectId(actor.id),
    startedAt: new Date(),
    heartbeatAt: new Date(),
  });

  logger.info(`批量补全开始：${queue.length} 条，方式 ${modes.join('+')}`);
  // 后台跑，接口立刻返回；前端轮询 getEnrichRun 看进度
  void runQueue(String(run._id)).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('批量补全中断', message);
    await ProspectEnrichRun.updateOne(
      { _id: run._id },
      { $set: { status: 'failed', error: message, endedAt: new Date() } },
    ).catch(() => undefined);
  });

  return toDto(run.toObject() as unknown as IProspectEnrichRun & { _id: unknown });
}

export async function getEnrichRun(actor: AuthUser, id: string): Promise<EnrichRunDto> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('任务 ID 格式不正确');
  const projectId = requiresProject(actor);
  const doc = await ProspectEnrichRun.findOne({ _id: id, projectId }).lean();
  if (!doc) throw ApiError.notFound('补全任务不存在');
  return toDto(doc as unknown as IProspectEnrichRun & { _id: unknown });
}

export async function cancelEnrichRun(actor: AuthUser, id: string): Promise<EnrichRunDto> {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可停止补全任务');
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('任务 ID 格式不正确');
  const projectId = requiresProject(actor);
  const doc = await ProspectEnrichRun.findOneAndUpdate(
    { _id: id, projectId, status: 'running' },
    { $set: { status: 'cancelled', endedAt: new Date() } },
    { new: true },
  ).lean();
  if (!doc) {
    const existing = await ProspectEnrichRun.findOne({ _id: id, projectId }).lean();
    if (!existing) throw ApiError.notFound('补全任务不存在');
    return toDto(existing as unknown as IProspectEnrichRun & { _id: unknown });
  }
  logger.info('批量补全已取消', id);
  return toDto(doc as unknown as IProspectEnrichRun & { _id: unknown });
}

function requiresProject(actor: AuthUser): Types.ObjectId {
  return new Types.ObjectId(requireProjectId(actor));
}

type Outcome = {
  /** 这次主要是靠哪一步补上的 */
  filled: 'site' | 'hunter' | 'discover' | '';
  discovered: boolean;
  hasEmail: boolean;
  skipped?: string;
};

/** Hunter 额度用完后整批停用，别每条线索都白跑三次重试 */
let hunterDisabled = false;

/** 补一条线索 */
async function enrichOne(projectId: Types.ObjectId, prospectId: Types.ObjectId, modes: EnrichMode[]): Promise<Outcome> {
  const prospect = await Prospect.findOne({ _id: prospectId, projectId }).lean();
  if (!prospect) return { filled: '', discovered: false, hasEmail: false, skipped: '线索已不存在' };

  const patch: Record<string, unknown> = {};
  let domain = String(prospect.domain ?? '');
  let discovered = false;
  let filled: Outcome['filled'] = '';
  let emails = [...(prospect.emails ?? [])].map((email) => String(email).toLowerCase());

  // ---------- 1) 连官网都没有：先搜官网 ----------
  if (modes.includes('discover') && (!prospect.website || !isRealHost(hostOf(prospect.website)))) {
    const found = await discoverWebsite(projectId, prospect.company || prospect.contactName || prospect.name || '', String(prospect.country ?? ''), domain);
    if (found) {
      patch.website = found.website;
      patch.sourceUrl = found.website;
      patch.domain = found.domain;
      domain = found.domain;
      discovered = true;
      filled = 'discover';
    }
  }

  // ---------- 2) 抓官网 ----------
  const website = String(patch.website ?? prospect.website ?? '');
  if (modes.includes('site') && website && isRealHost(hostOf(website))) {
    const lead: RawLead = {
      ...(prospect as unknown as RawLead),
      website,
      domain: isRealHost(domain) ? domain : hostOf(website),
      emails,
    };
    // 批量场景：拿到邮箱就不再抓后两页，省额度
    const enriched = await enrichLead(lead, undefined, { stopWhenContactFound: true });
    const enrichedFields = enriched as unknown as Record<string, unknown>;
    // 只补空字段：Excel 里业务员填的内容优先
    const keys = ['phone', 'address', 'industry', 'country', 'instagram', 'linkedin', 'facebook', 'whatsapp', 'contactName', 'contactTitle'] as const;
    for (const key of keys) {
      const value = enrichedFields[key];
      if (!(prospect as Record<string, unknown>)[key] && typeof value === 'string' && value.trim()) {
        patch[key] = value.trim().slice(0, 500);
      }
    }
    // Excel 线索的 excerpt 是业务员备注，别被官网简介冲掉
    if (prospect.source !== 'excel' && !prospect.excerpt && enriched.excerpt) patch.excerpt = enriched.excerpt;
    if (!prospect.company && enriched.company) patch.company = enriched.company;

    const merged = [...new Set([...emails, ...(enriched.emails ?? []).map((email) => String(email).toLowerCase())])];
    if (merged.length > emails.length) {
      emails = merged;
      patch.emails = merged;
      patch.emailSource = 'site';
      if (!filled) filled = 'site';
    }
    if (enriched.contactSources?.length) {
      patch.contactSources = [...(prospect.contactSources ?? []), ...enriched.contactSources].slice(-8);
    }
  }

  // ---------- 3) 还是没有邮箱：Hunter 按域名找 ----------
  if (modes.includes('hunter') && !hunterDisabled && emails.length === 0 && isRealHost(domain)) {
    let hunter;
    try {
      hunter = await hunterDomainSearch(domain);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/额度已用完|key 无效/.test(message)) {
        hunterDisabled = true;
        logger.warn(`Hunter 停用：${message}`);
      }
      throw error;
    }
    if (hunter.emails.length > 0) {
      emails = hunter.emails.map((item) => String(item.value).toLowerCase());
      patch.emails = emails;
      patch.emailSource = 'hunter';
      patch.emailConfidence = hunter.emails[0]?.confidence;
      if (!prospect.contactName && hunter.contactName) patch.contactName = hunter.contactName.slice(0, 120);
      if (!prospect.contactTitle && hunter.contactTitle) patch.contactTitle = hunter.contactTitle.slice(0, 120);
      if (!prospect.phone && hunter.phone) patch.phone = String(hunter.phone).slice(0, 60);
      if (!prospect.linkedin && hunter.linkedin) patch.linkedin = String(hunter.linkedin).slice(0, 300);
      filled = 'hunter';
    }
  }

  // ---------- 4) 状态与评分徽标 ----------
  if (emails.length > 0) {
    patch.status = 'ready';
    const reasons = [...(prospect.scoreReasons ?? [])];
    if (!reasons.includes('批量补全')) reasons.push('批量补全');
    patch.scoreReasons = reasons;
  } else if (prospect.status === 'ready') {
    // 原来标着可发送但没邮箱（历史脏数据）→ 回到待补
    patch.status = 'needs_contact';
  }

  if (Object.keys(patch).length > 0) {
    try {
      await Prospect.updateOne({ _id: prospectId, projectId }, { $set: patch }, { runValidators: true });
    } catch (error) {
      // 域名撞上另一条线索的唯一键：保留其他字段，放弃改域名
      if ((error as { code?: number }).code === 11000 && patch.domain) {
        delete patch.domain;
        if (Object.keys(patch).length > 0) {
          await Prospect.updateOne({ _id: prospectId, projectId }, { $set: patch }, { runValidators: true });
        }
      } else {
        throw error;
      }
    }
  }

  return { filled, discovered, hasEmail: emails.length > 0 };
}

/** 用搜索找官网：只接受品牌词能对上、且没被别的线索/客户占用的域名 */
async function discoverWebsite(
  projectId: Types.ObjectId,
  company: string,
  country: string,
  currentDomain: string,
): Promise<{ website: string; domain: string } | null> {
  const name = company.trim();
  if (!name) return null;
  const query = `${name} ${country ? `${country} ` : ''}official website`.replace(/\s+/g, ' ').trim();
  const results = await serperSearch(query, 6);
  const ranked = results
    .map((item) => ({ item, score: brandScore(name, item.domain ?? '') }))
    .filter((entry) => entry.score > 0 && isRealHost(entry.item.domain ?? '') && entry.item.domain !== currentDomain)
    .sort((a, b) => b.score - a.score);

  for (const entry of ranked) {
    const domain = String(entry.item.domain);
    // 域名已被别的线索占用（唯一索引）→ 跳过
    if (await Prospect.exists({ projectId, domain })) continue;
    // 已经是客户库里的客户 → 别再当新线索补
    const scope = '(?:^|//)(?:www\\.)?' + domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[/:]|$)';
    if (await Customer.exists({ projectId, website: { $regex: scope, $options: 'i' } })) continue;
    return { website: `https://${domain}/`, domain };
  }
  return null;
}

/** 处理一条并记进度；失败只记账，不打断整批 */
async function processOne(
  runId: string,
  projectId: Types.ObjectId,
  prospectId: Types.ObjectId,
  modes: EnrichMode[],
): Promise<void> {
  let outcome: Outcome;
  let failure: string | undefined;
  try {
    outcome = await enrichOne(projectId, prospectId, modes);
    failure = outcome.skipped;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    outcome = { filled: '', discovered: false, hasEmail: false };
  }

  const inc: Record<string, number> = { done: 1 };
  if (outcome.discovered) inc.discovered = 1;
  if (outcome.filled === 'site') inc.siteFilled = 1;
  if (outcome.filled === 'hunter') inc.hunterFilled = 1;
  if (!outcome.hasEmail) inc.stillMissing = 1;
  if (failure) inc.failed = 1;

  const update: Record<string, unknown> = { $inc: inc, $set: { heartbeatAt: new Date() } };
  if (failure) {
    update.$push = { failures: { $each: [{ message: failure.slice(0, 300) }], $slice: -ERROR_KEEP } };
  }
  await ProspectEnrichRun.updateOne({ _id: runId }, update);
}

/**
 * 后台并发跑；每处理一条都更新进度，前端轮询即可。
 * 每片跑之前查一次任务状态，取消后最多再跑完当前这一片。
 */
async function runQueue(runId: string): Promise<void> {
  const run = await ProspectEnrichRun.findById(runId).lean();
  if (!run) return;
  const projectId = run.projectId as Types.ObjectId;
  const modes = (run.modes ?? []) as EnrichMode[];
  const queue = (run.queue ?? []) as Types.ObjectId[];
  hunterDisabled = false;

  for (let index = 0; index < queue.length; index += CONCURRENCY) {
    const state = await ProspectEnrichRun.findById(runId).select('status').lean();
    if (!state || state.status !== 'running') return;
    const slice = queue.slice(index, index + CONCURRENCY);
    await Promise.all(slice.map((prospectId) => processOne(runId, projectId, prospectId, modes)));
  }

  const result = await ProspectEnrichRun.findById(runId).lean();
  // 单条失败不影响整体：跑完就是 completed，失败明细留在 errors 里
  await ProspectEnrichRun.updateOne(
    { _id: runId, status: 'running' },
    { $set: { status: 'completed', endedAt: new Date() } },
  );
  logger.info(
    `批量补全结束：${runId}，处理 ${result?.done ?? 0}/${run.total}，` +
      `抓官网补到 ${result?.siteFilled ?? 0}，Hunter 补到 ${result?.hunterFilled ?? 0}，` +
      `仍缺邮箱 ${result?.stillMissing ?? 0}，失败 ${result?.failed ?? 0}`,
  );
}
