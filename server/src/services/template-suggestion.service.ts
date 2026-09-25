import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { TemplateCategory } from '../constants';
import { DevelopmentLetter } from '../models/DevelopmentLetter';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { LetterTemplate, type LetterTemplateDocument } from '../models/LetterTemplate';
import { TemplateSuggestion, type TemplateSuggestionDocument, type TemplateSuggestionSourceSummary } from '../models/TemplateSuggestion';
import type { AuthUser } from '../types/express';
import { ApiError } from '../utils/ApiError';
import { requireProjectId } from '../utils/access';

const MINIMUM_SAMPLE_SIZE = 20;

export interface TemplateSuggestionDto {
  id: string;
  projectId: string;
  userId: string;
  sourceTemplateId: string;
  sourceTemplateSnapshot: { name: string; subject: string; contentHash: string; updatedAt: Date };
  model: 'rule-based-v1';
  sourceSummary: TemplateSuggestionSourceSummary;
  suggested: { name: string; subject: string; content: string; category: TemplateCategory };
  explanation: string[];
  status: 'preview' | 'copied' | 'cancelled';
  version: number;
  createdTemplateId?: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function dto(doc: TemplateSuggestionDocument): TemplateSuggestionDto {
  return {
    id: String(doc._id), projectId: String(doc.projectId), userId: String(doc.userId),
    sourceTemplateId: String(doc.sourceTemplateId),
    sourceTemplateSnapshot: {
      name: doc.sourceTemplateSnapshot.name, subject: doc.sourceTemplateSnapshot.subject,
      contentHash: doc.sourceTemplateSnapshot.contentHash, updatedAt: doc.sourceTemplateSnapshot.updatedAt,
    },
    model: doc.model, sourceSummary: doc.sourceSummary,
    suggested: { name: doc.suggested.name, subject: doc.suggested.subject, content: doc.suggested.content, category: doc.suggested.category },
    explanation: doc.explanation, status: doc.status, version: doc.version,
    createdTemplateId: doc.createdTemplateId ? String(doc.createdTemplateId) : undefined,
    generatedAt: doc.generatedAt, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

async function scopedActor(actor: AuthUser): Promise<{ projectId: Types.ObjectId; userId: Types.ObjectId }> {
  const projectId = requireProjectId(actor);
  if (!actor?.id || !Types.ObjectId.isValid(actor.id)) throw ApiError.notFound('用户不存在或无权访问');
  const userId = new Types.ObjectId(actor.id);
  if (!await Project.exists({ _id: projectId, status: 'active' }) ||
      !await User.exists({ _id: userId, status: 'active', ...(actor.role === 'admin' ? {} : { projectIds: projectId }) })) {
    throw ApiError.notFound('用户或项目不存在或无权访问');
  }
  return { projectId, userId };
}

function objectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw ApiError.notFound('资源不存在或无权访问');
  return new Types.ObjectId(value);
}

function validKey(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_:.\-]{8,128}$/.test(value)) {
    throw ApiError.badRequest(`${label}须为 8–128 位字母、数字或 _ : . -`);
  }
  return value;
}

function contentHash(source: Pick<LetterTemplateDocument, 'subject' | 'content'>): string {
  return createHash('sha256').update(JSON.stringify([source.subject, source.content])).digest('hex');
}

async function suggestionScope(templateId: string, suggestionId: string, actor: AuthUser) {
  return { ...await scopedActor(actor), sourceTemplateId: objectId(templateId), _id: objectId(suggestionId) };
}

async function findSuggestion(templateId: string, suggestionId: string, actor: AuthUser): Promise<TemplateSuggestionDocument> {
  const doc = await TemplateSuggestion.findOne(await suggestionScope(templateId, suggestionId, actor));
  if (!doc) throw ApiError.notFound('建议不存在或无权访问');
  return doc;
}

/** Only attributed, sent letters belonging to the active project contribute to evidence. */
export async function generateTemplateSuggestion(
  templateId: string, input: { idempotencyKey: string }, actor: AuthUser,
): Promise<TemplateSuggestionDto> {
  const { projectId, userId } = await scopedActor(actor);
  const sourceTemplateId = objectId(templateId);
  const idempotencyKey = validKey(input?.idempotencyKey, 'idempotencyKey');
  const scope = { projectId, userId, sourceTemplateId, idempotencyKey };
  const previous = await TemplateSuggestion.findOne(scope);
  if (previous) return dto(previous);
  const source = await LetterTemplate.findOne({ _id: sourceTemplateId, projectId });
  if (!source) throw ApiError.notFound('模板不存在或无权访问');
  const windowStart = new Date(Date.now() - 30 * 86400000);
  const sentCount = await DevelopmentLetter.countDocuments({ projectId, templateId: sourceTemplateId,
    templateNameSnapshot: source.name, templateContentHash: contentHash(source),
    status: { $in: ['sent', 'opened'] }, sentAt: { $gte: windowStart, $lte: new Date() } });
  const summary: TemplateSuggestionSourceSummary = {
    sentCount, replyCount: 0, interestedCount: 0, quoteCount: 0, wonCount: 0,
    unsubscribeCount: 0, bounceCount: 0, minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    sampleSufficient: sentCount >= MINIMUM_SAMPLE_SIZE, evidence: 'project-scoped-letter-count',
    referenceTemplateId: templateId,
  };
  // No external API call or prompt/key persistence. Preserve original HTML and placeholders.
  // Funnel counts are unavailable in this independent module: zeros are NOT performance claims.
  const subjectSuffix = ' · 您方便分享需求吗？';
  const suggestedSubject = source.subject.length + subjectSuffix.length <= 300 ? source.subject + subjectSuffix : source.subject;
  const invitation = '<p>若方便，欢迎回复您的具体需求或采购计划；如不希望再收到邮件，请告知。</p>';
  const suggestedContent = source.content.length + invitation.length <= 100000 ? source.content + invitation : source.content;
  const explanation = [
    `已核实本项目近 30 天归因到该模板当前名称与内容快照的已发送开发信 ${sentCount} 封。回复、意向、报价、成交、退订和退信尚未接入该建议证据，不参与推断。`,
    sentCount < MINIMUM_SAMPLE_SIZE ? `样本不足（门槛 ${MINIMUM_SAMPLE_SIZE}），不做排名或效果推断。` : '发送样本达到门槛，但单凭发送量不能推断转化或因果效果。',
    '规则建议在长度允许时微调主题及补充末尾提问句，以提供可人工核对的变体；原模板不会修改。',
  ];
  try {
    const doc = await TemplateSuggestion.create({
      ...scope,
      sourceTemplateSnapshot: { name: source.name, subject: source.subject, contentHash: contentHash(source), updatedAt: source.updatedAt },
      model: 'rule-based-v1', sourceSummary: summary,
      suggested: { name: `${source.name} 优化建议`.slice(0, 120), subject: suggestedSubject, content: suggestedContent, category: source.category },
      explanation, status: 'preview', version: 1, generatedAt: new Date(),
    });
    return dto(doc);
  } catch (error) {
    // Unique scoped idempotency key: retry and concurrent generation return exactly one preview.
    if ((error as { code?: number }).code === 11000) {
      const existing = await TemplateSuggestion.findOne(scope);
      if (existing) return dto(existing);
    }
    throw error;
  }
}

export async function getTemplateSuggestion(templateId: string, suggestionId: string, actor: AuthUser): Promise<TemplateSuggestionDto> {
  return dto(await findSuggestion(templateId, suggestionId, actor));
}

/** Confirmation is a separate explicit request; no preview generation writes a LetterTemplate. */
export async function confirmTemplateSuggestionCopy(
  templateId: string, suggestionId: string, input: { expectedVersion: number; requestKey: string }, actor: AuthUser,
): Promise<TemplateSuggestionDto> {
  const scope = await suggestionScope(templateId, suggestionId, actor);
  const requestKey = validKey(input?.requestKey, 'requestKey');
  if (!Number.isSafeInteger(input?.expectedVersion) || input.expectedVersion < 1) throw ApiError.badRequest('expectedVersion 须为正整数');
  let suggestion = await findSuggestion(templateId, suggestionId, actor);
  if (suggestion.status === 'copied') {
    if (suggestion.confirmationKey !== requestKey) throw ApiError.conflict('建议已通过另一确认请求复制');
    return dto(suggestion);
  }
  if (suggestion.status !== 'preview') throw ApiError.conflict('建议已取消');
  if (!suggestion.confirmationKey) {
    if (suggestion.version !== input.expectedVersion) throw ApiError.conflict('建议版本已变更，请刷新预览');
    const claimed = await TemplateSuggestion.findOneAndUpdate(
      { ...scope, status: 'preview', version: input.expectedVersion, confirmationKey: { $exists: false } },
      { $set: { confirmationKey: requestKey }, $inc: { version: 1 } }, { new: true },
    );
    if (!claimed) {
      suggestion = await findSuggestion(templateId, suggestionId, actor);
      if (suggestion.confirmationKey !== requestKey || suggestion.status !== 'preview') throw ApiError.conflict('建议已变更，请刷新预览');
    } else suggestion = claimed;
  }
  if (suggestion.confirmationKey !== requestKey || suggestion.version !== input.expectedVersion + 1) {
    throw ApiError.conflict('建议正在通过另一确认请求复制');
  }
  const source = await LetterTemplate.findOne({ _id: scope.sourceTemplateId, projectId: scope.projectId });
  if (!source || source.name !== suggestion.sourceTemplateSnapshot.name || source.subject !== suggestion.sourceTemplateSnapshot.subject ||
      contentHash(source) !== suggestion.sourceTemplateSnapshot.contentHash ||
      source.updatedAt.getTime() !== suggestion.sourceTemplateSnapshot.updatedAt.getTime()) {
    // Source deletion/edit is never silently accepted; release claim only if copy was not created.
    const existing = await LetterTemplate.findOne({ projectId: scope.projectId, sourceSuggestionId: suggestion._id });
    if (!existing) {
      await TemplateSuggestion.updateOne({ ...scope, status: 'preview', confirmationKey: requestKey },
        { $unset: { confirmationKey: '' }, $inc: { version: 1 } });
      throw ApiError.conflict('原模板已编辑或删除，请重新生成建议');
    }
  }
  // LetterTemplate.sourceSuggestionId has a scoped unique index for idempotent reviewed copies.
  // Atomic upsert + unique index ensures one copy even if confirmations race or crash/retry.
  let copy: LetterTemplateDocument | null;
  try {
    copy = await LetterTemplate.findOneAndUpdate(
      { projectId: scope.projectId, sourceSuggestionId: suggestion._id },
      { $setOnInsert: {
        projectId: scope.projectId, sourceSuggestionId: suggestion._id,
        name: suggestion.suggested.name, subject: suggestion.suggested.subject,
        content: suggestion.suggested.content, category: suggestion.suggested.category,
        createdBy: scope.userId,
      } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    copy = await LetterTemplate.findOne({ projectId: scope.projectId, sourceSuggestionId: suggestion._id });
  }
  if (!copy) throw ApiError.conflict('复制未完成，请使用相同 requestKey 重试');
  const updated = await TemplateSuggestion.findOneAndUpdate(
    { ...scope, status: 'preview', confirmationKey: requestKey },
    { $set: { status: 'copied', createdTemplateId: copy._id }, $inc: { version: 1 } }, { new: true },
  );
  if (updated) return dto(updated);
  suggestion = await findSuggestion(templateId, suggestionId, actor);
  if (suggestion.status === 'copied' && String(suggestion.createdTemplateId) === String(copy._id) && suggestion.confirmationKey === requestKey) return dto(suggestion);
  throw ApiError.conflict('确认状态冲突，请刷新后重试');
}

export async function cancelTemplateSuggestion(templateId: string, suggestionId: string, actor: AuthUser): Promise<TemplateSuggestionDto> {
  const scope = await suggestionScope(templateId, suggestionId, actor);
  const cancelled = await TemplateSuggestion.findOneAndUpdate(
    { ...scope, status: 'preview', confirmationKey: { $exists: false } },
    { $set: { status: 'cancelled' }, $inc: { version: 1 } }, { new: true },
  );
  if (cancelled) return dto(cancelled);
  const current = await findSuggestion(templateId, suggestionId, actor);
  if (current.status === 'cancelled') return dto(current);
  throw ApiError.conflict('建议正在复制或已经复制，无法取消');
}
