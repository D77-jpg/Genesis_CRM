import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { KnowledgeFeedback, type FeedbackIssue } from '../../models/KnowledgeFeedback';
import { KnowledgeTrainingState } from '../../models/KnowledgeTrainingState';
import { AgentKnowledge } from '../../models/AgentKnowledge';
import { requireProjectId } from '../../utils/access';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../types/express';
import type { KnowledgeReview } from './knowledge-types';

/**
 * 自动校准的安全边界：
 * - 只在管理员显式启用后生效；
 * - 只使用本项目“审核通过”的草稿；
 * - 只调整已召回、已通过 rerank 阈值的候选顺序；
 * - 最大加权 0.02，不足以让一个被拒绝的来源越过准入阈值；
 * - 不新增来源、不放宽项目/角色/产品/版本权限。
 */
export const MAX_FEEDBACK_BOOST = 0.02;
const MIN_MATCHED_TERMS = 2;
const MAX_QUERY_TERMS = 32;
const SAMPLE_LIMIT = 200;
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'please', 'our', 'your', 'you', 'are', 'can', 'what', 'which', 'how', 'does', 'did', 'was', 'were', 'will', 'would', 'could', 'should', 'have', 'has', 'had', 'not', '但', '我们', '你们', '这个', '那个', '以及', '并且', '可以', '需要', '请']);

/** 轻量、可解释的检索反馈词项：英文词 + 中文二元组，不保存原文全文。 */
export function trainingQueryTerms(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9-]{2,}/g)) {
    if (!STOP.has(match[0])) terms.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\u3400-\u9fff]+/g)) {
    const chars = Array.from(match[0]);
    if (chars.length === 1) terms.add(chars[0]);
    for (let i = 0; i < chars.length - 1; i++) terms.add(chars[i] + chars[i + 1]);
  }
  return [...terms].slice(0, MAX_QUERY_TERMS);
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 字符级编辑比例，长文按 4000 字截断，避免审核接口被长正文拖慢。 */
export function editRatio(before: string, after: string): number {
  const a = before.replace(/\s+/g, ' ').trim().slice(0, 4000);
  const b = after.replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (a === b) return 0;
  const max = Math.max(a.length, b.length, 1);
  // 超长正文只保留长度差下界；训练样本仍记录 edited=true。
  if (a.length > 1200 || b.length > 1200) return Math.min(1, Math.abs(a.length - b.length) / max || 1);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return Math.min(1, previous[b.length] / max);
}

interface ReviewFeedbackInput {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  customerId: Types.ObjectId;
  agentTaskId?: Types.ObjectId;
  subject: string;
  contentText: string;
  aiSnapshot?: { subject: string; contentText: string; at: Date };
  knowledgeReview?: KnowledgeReview;
}

/**
 * A retrieved source is not automatically a used source. Only claims that
 * actually survive into the human final body become positive labels; otherwise
 * an approval would train the system to prefer every candidate that happened to
 * be retrieved. If a final body was fully rewritten, fewer labels are preferable
 * to noisy ones.
 */
function usedSourceIds(review: KnowledgeReview, finalBody: string): string[] {
  const sources = review.sources ?? [];
  if (!sources.length) return [];
  const bySourceId = new Map<string, string>();
  for (const source of sources) {
    if (source.knowledgeId) bySourceId.set(source.sourceId, String(source.knowledgeId));
    if (source.sourceId.startsWith('knowledge:')) bySourceId.set(source.sourceId, source.sourceId.slice(10));
  }
  const claims = review.claims ?? [];
  if (!claims.length) {
    // Legacy snapshots without claim text cannot prove which source was used.
    return [];
  }
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const body = normalize(finalBody);
  const bodyTerms = new Set(trainingQueryTerms(body));
  const ids = new Set<string>();
  for (const claim of claims) {
    const text = normalize(claim.text);
    if (!text) continue;
    const probe = text.slice(0, 80);
    const exact = probe.length >= 8 && body.includes(probe);
    const terms = trainingQueryTerms(text);
    const overlap = terms.filter(term => bodyTerms.has(term)).length;
    const covered = exact || (terms.length >= 3 && overlap / terms.length >= 0.6);
    if (!covered) continue;
    for (const sourceId of claim.sourceIds ?? []) {
      const knowledgeId = bySourceId.get(sourceId)
        ?? (sourceId.startsWith('knowledge:') ? sourceId.slice(10) : undefined);
      if (knowledgeId) ids.add(knowledgeId);
    }
  }
  return [...ids];
}

function reviewQuery(review: KnowledgeReview, fallback: string): string {
  const context = review.context ?? {};
  return [context.request, context.customerProfile?.interestedProducts, context.customerProfile?.industry]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .slice(0, 4000) || fallback.slice(0, 4000);
}

/**
 * 审核结论落库后自动调用。失败不应回滚人工审核：审核结论是事实，
 * 训练样本是可再生衍生数据；调用方记录警告即可。
 */
export async function recordLetterReviewFeedback(
  letter: ReviewFeedbackInput,
  decision: 'approved' | 'rejected',
  actor: AuthUser | undefined,
  extra: { issues?: FeedbackIssue[]; note?: string } = {},
): Promise<void> {
  const review = letter.knowledgeReview;
  if (!review || !letter.aiSnapshot || !actor?.id) return;
  const aiBody = letter.aiSnapshot.contentText.slice(0, 12000);
  const finalBody = letter.contentText.slice(0, 12000);
  const sourceIds = usedSourceIds(review, finalBody).slice(0, 10);
  const aiHash = sha(aiBody);
  const finalHash = sha(finalBody);
  const query = reviewQuery(review, letter.subject);
  const terms = trainingQueryTerms(query);
  await KnowledgeFeedback.findOneAndUpdate(
    { projectId: letter.projectId, letterId: letter._id },
    {
      $set: {
        customerId: letter.customerId,
        ...(letter.agentTaskId ? { taskId: letter.agentTaskId } : {}),
        taskType: review.taskType,
        reviewerId: actor.id,
        decision,
        query,
        queryTerms: terms,
        sourceIds,
        aiSubject: letter.aiSnapshot.subject.slice(0, 300),
        aiBody,
        finalSubject: letter.subject.slice(0, 300),
        finalBody,
        aiHash,
        finalHash,
        edited: aiHash !== finalHash,
        editRatio: editRatio(aiBody, finalBody),
        issues: extra.issues ?? [],
        ...(extra.note ? { note: extra.note.slice(0, 500) } : {}),
        status: 'included',
        split: Number.parseInt(finalHash.slice(0, 2), 16) % 5 === 0 ? 'validation' : 'train',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/** 撤销审核时保留历史样本，但不再参与校准。 */
export async function retractLetterReviewFeedback(letterId: Types.ObjectId, projectId: Types.ObjectId): Promise<void> {
  await KnowledgeFeedback.updateOne({ letterId, projectId }, { $set: { status: 'retracted' } });
}

export interface FeedbackBoostResult {
  enabled: boolean;
  samples: number;
  matched: number;
  boosts: Map<string, number>;
}

/**
 * 相似请求的“人工通过来源”先验。只用词项覆盖率，不把客户正文、邮箱或
 * 未发布资料送进检索；样本不足 3 条时返回空结果。
 */
export async function feedbackBoostsForQuery(projectId: string, query: string): Promise<FeedbackBoostResult> {
  const empty: FeedbackBoostResult = { enabled: false, samples: 0, matched: 0, boosts: new Map() };
  const state = await KnowledgeTrainingState.findOne({ projectId }).lean();
  if (!state?.enabled) return empty;
  const rows = await KnowledgeFeedback.find({
    projectId,
    status: 'included',
    decision: 'approved',
    'queryTerms.1': { $exists: true },
    'sourceIds.0': { $exists: true },
  }).sort({ createdAt: -1 }).limit(SAMPLE_LIMIT).select('queryTerms sourceIds createdAt').lean();
  if (rows.length < 3) return { ...empty, enabled: true, samples: rows.length };
  const queryTerms = new Set(trainingQueryTerms(query));
  if (queryTerms.size < MIN_MATCHED_TERMS) return { ...empty, enabled: true, samples: rows.length };
  const now = Date.now();
  const scores = new Map<string, number>();
  let matched = 0;
  for (const row of rows) {
    const terms = row.queryTerms ?? [];
    const overlap = terms.filter(term => queryTerms.has(term)).length;
    if (overlap < MIN_MATCHED_TERMS) continue;
    if (overlap / Math.max(1, Math.min(terms.length, queryTerms.size)) < 0.5) continue;
    matched++;
    const ageDays = Math.max(0, (now - new Date(row.createdAt).getTime()) / 86_400_000);
    const recency = 0.5 + 0.5 * Math.exp(-ageDays / 180);
    const weight = overlap * recency;
    for (const sourceId of row.sourceIds ?? []) {
      scores.set(sourceId, (scores.get(sourceId) ?? 0) + weight);
    }
  }
  if (!scores.size) return { enabled: true, samples: rows.length, matched, boosts: new Map() };
  const max = Math.max(...scores.values());
  const boosts = new Map<string, number>();
  for (const [sourceId, score] of scores) {
    const value = (score / max) * MAX_FEEDBACK_BOOST;
    if (value > 0) boosts.set(sourceId, value);
  }
  return { enabled: true, samples: rows.length, matched, boosts };
}

export interface TrainingSampleSummary {
  id: string;
  taskType: string;
  decision: 'approved' | 'rejected';
  edited: boolean;
  editRatio: number;
  sourceCount: number;
  queryPreview: string;
  aiPreview: string;
  finalPreview: string;
  createdAt: string;
}

export interface TrainingOverview {
  enabled: boolean;
  total: number;
  approved: number;
  rejected: number;
  edited: number;
  eligible: number;
  validation: number;
  topSources: { knowledgeId: string; title: string; approvals: number }[];
  recent: TrainingSampleSummary[];
  limits: { maxBoost: number; minSamples: number; sampleLimit: number; onlyApproved: true };
}

/** 管理员概览只返回元数据，不把 AI 原文/人工正文返回给业务员。 */
export async function trainingOverview(actor: AuthUser): Promise<TrainingOverview> {
  if (actor.role !== 'admin') throw ApiError.forbidden('只有管理员可以查看审核训练概况');
  const projectId = requireProjectId(actor);
  const match = { projectId, status: 'included' as const };
  const [state, total, approved, rejected, edited, eligible, validation, recent, grouped] = await Promise.all([
    KnowledgeTrainingState.findOne({ projectId }).lean(),
    KnowledgeFeedback.countDocuments(match),
    KnowledgeFeedback.countDocuments({ ...match, decision: 'approved' }),
    KnowledgeFeedback.countDocuments({ ...match, decision: 'rejected' }),
    KnowledgeFeedback.countDocuments({ ...match, decision: 'approved', edited: true }),
    KnowledgeFeedback.countDocuments({ ...match, decision: 'approved', 'queryTerms.1': { $exists: true }, 'sourceIds.0': { $exists: true } }),
    KnowledgeFeedback.countDocuments({ ...match, split: 'validation' }),
    KnowledgeFeedback.find(match).sort({ createdAt: -1 }).limit(12)
      .select('taskType decision edited editRatio sourceIds query aiBody finalBody createdAt').lean(),
    KnowledgeFeedback.aggregate([
      { $match: { ...match, decision: 'approved' } },
      { $unwind: '$sourceIds' },
      { $group: { _id: '$sourceIds', approvals: { $sum: 1 } } },
      { $sort: { approvals: -1, _id: 1 } },
      { $limit: 10 },
    ]),
  ]);
  const knowledge = await AgentKnowledge.find({
    _id: { $in: grouped.map((row: { _id: string }) => row._id).filter(Types.ObjectId.isValid) },
    projectId,
  }).select('revisions.title approvedVersion version').lean();
  const topSources = grouped.map((row: { _id: string; approvals: number }) => {
    const item = knowledge.find(entry => String(entry._id) === row._id);
    const revision = item?.revisions?.find(value => value.version === (item.approvedVersion || item.version));
    return { knowledgeId: row._id, title: revision?.title ?? '已删除或不可见资料', approvals: row.approvals };
  });
  return {
    enabled: Boolean(state?.enabled),
    total, approved, rejected, edited, eligible, validation,
    topSources,
    recent: recent.map(item => ({
      id: String(item._id), taskType: item.taskType, decision: item.decision,
      edited: item.edited, editRatio: item.editRatio, sourceCount: item.sourceIds?.length ?? 0,
      queryPreview: String(item.query ?? '').slice(0, 80),
      aiPreview: String(item.aiBody ?? '').slice(0, 240),
      finalPreview: String(item.finalBody ?? '').slice(0, 240),
      createdAt: new Date(item.createdAt).toISOString(),
    })),
    limits: { maxBoost: MAX_FEEDBACK_BOOST, minSamples: 3, sampleLimit: SAMPLE_LIMIT, onlyApproved: true },
  };
}

export async function setTrainingEnabled(actor: AuthUser, enabled: boolean): Promise<{ enabled: boolean }> {
  if (actor.role !== 'admin') throw ApiError.forbidden('只有管理员可以启用自动校准');
  const projectId = requireProjectId(actor);
  await KnowledgeTrainingState.findOneAndUpdate(
    { projectId },
    { $set: { enabled, ...(actor.id ? { updatedBy: actor.id } : {}) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { enabled };
}

/**
 * 只重排“已接受的命中”。未接受候选仍保持原顺序，避免反馈先验把未达阈值的
 * 内容推入来源列表；显式选择/规则来源在调用方先拼接，不经过此函数。
 */
export function reorderHitsWithFeedback<T extends { id: string; accepted?: boolean }>(
  hits: T[],
  itemToKnowledge: Map<string, string>,
  boosts: Map<string, number>,
): T[] {
  if (!boosts.size) return hits;
  return hits
    .map((hit, index) => ({ hit, index, boost: boosts.get(itemToKnowledge.get(hit.id) ?? '') ?? 0 }))
    .sort((a, b) => {
      const accepted = Number(Boolean(b.hit.accepted)) - Number(Boolean(a.hit.accepted));
      if (accepted) return accepted;
      return b.boost - a.boost || a.index - b.index;
    })
    .map(item => item.hit);
}
