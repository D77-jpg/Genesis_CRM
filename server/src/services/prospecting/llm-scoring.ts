// LLM brand-fit scoring against 01-客户画像. Runs only on candidates that survived
// the deterministic prefilter, in small batches, and never overrides "needs contact".
import { resolveAgentProvider } from '../agent/ai-settings.service';
import type { AgentProvider } from '../agent/provider';
import type { ProjectPromptContext } from '../project-profile';
import type { ScoreResult } from './scoring';

export interface LlmScoreInput {
  domain: string;
  name?: string;
  country?: string;
  snippet?: string;
  excerpt?: string;
  emails?: string[];
  contactTitle?: string;
}

export interface LlmScore {
  domain: string;
  score: number;
  reasons: string[];
  exclude: boolean;
  excludeReason?: string;
}

function buildRubric(profile?: ProjectPromptContext): string {
  const p = profile ?? {
    identity: '本项目的供应商',
    offerSummary: '本项目的产品与服务。',
    outreachFocus: '与本项目产品/服务相关的采购需求',
    avoidTopics: '其他项目、其他行业，以及知识库未确认的品类和承诺',
    subjectFocus: '本项目产品/服务',
  };
  return `你是${p.identity}的外贸业务助理。根据本项目《客户画像》给每个候选品牌打分：
- 目标：美国/欧洲/澳洲的、与「${p.subjectFocus}」相关的品牌、采购商或渠道商；${p.offerSummary}他们可能有${p.outreachFocus}。
- 加分：自有品牌与独立站、相关产品线、明确的目标市场、有采购/定制/分销信号。
- 排除（exclude=true）：目录站/商城/纯零售商/与我方无关的经销商/${p.subjectFocus}同类产品供应商/制造商/行业协会/展会展商/代运营/贸易公司；明显不需要${p.subjectFocus}的公司，或只涉及${p.avoidTopics}的公司。
- 联系方式不作为评分依据（邮箱由系统另行补全）。
只输出 JSON，不要解释。每个候选给出 0–100 的匹配分、最多 3 条简短理由；不匹配时给 exclude=true 和一句原因。`;
}

const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['domain', 'score', 'reasons', 'exclude', 'excludeReason'],
        properties: {
          domain: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          reasons: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          exclude: { type: 'boolean' },
          excludeReason: { type: 'string' },
        },
      },
    },
  },
};

export function parseLlmScores(text: string, domains: string[]): Map<string, LlmScore> {
  const allowed = new Set(domains.map((domain) => domain.toLowerCase()));
  const result = new Map<string, LlmScore>();
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return result;
    try { payload = JSON.parse(match[0]); } catch { return result; }
  }
  const items = (payload as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return result;
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const domain = String(item.domain ?? '').trim().toLowerCase();
    if (!allowed.has(domain)) continue;
    const score = Math.max(0, Math.min(100, Number(item.score ?? 0)));
    if (!Number.isFinite(score)) continue;
    result.set(domain, {
      domain,
      score,
      reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 3).map((reason) => String(reason).slice(0, 120)) : [],
      exclude: Boolean(item.exclude),
      excludeReason: item.excludeReason ? String(item.excludeReason).slice(0, 160) : undefined,
    });
  }
  return result;
}

/** 60% AI + 40% rules; AI can reject a lead but cannot turn "no contact" into "ready". */
export function mergeScores(rule: ScoreResult, ai: LlmScore | undefined, minScore: number): ScoreResult {
  if (!ai) return rule;
  if (ai.exclude) {
    return { score: Math.min(rule.score, 20), reasons: [ai.excludeReason || 'AI 判断不是目标客户'], status: 'rejected' };
  }
  const score = Math.round(rule.score * 0.4 + ai.score * 0.6);
  const reasons = [`AI 匹配 ${ai.score}`, ...ai.reasons, ...rule.reasons].slice(0, 4);
  if (rule.status === 'needs_contact') return { score, reasons, status: 'needs_contact' };
  return { score, reasons, status: score >= minScore ? 'ready' : 'low' };
}

export async function scoreLeadsWithLlm(items: LlmScoreInput[], provider?: AgentProvider, profileText?: string | null, profile?: ProjectPromptContext): Promise<Map<string, LlmScore>> {
  const scores = new Map<string, LlmScore>();
  const active = provider ?? await resolveAgentProvider();
  if (!active.isAvailable()) throw new Error('AI 未配置，暂时只用规则评分');
  const rubric = buildRubric(profile);
  const instructions = profileText
    ? `${rubric}\n\n以下是本项目资料库中的《客户画像》原文，评分时优先遵循：\n${profileText}`
    : rubric;
  for (let offset = 0; offset < items.length; offset += 8) {
    const batch = items.slice(offset, offset + 8);
    const turn = await active.createTurn({
      instructions,
      input: [{ role: 'user', content: JSON.stringify(batch.map((item) => ({
        domain: item.domain, name: item.name, country: item.country,
        snippet: item.snippet?.slice(0, 200), excerpt: item.excerpt?.slice(0, 500),
      }))) }],
      tools: [],
      context: { type: 'global' },
      userPrompt: '给每个候选打分并只返回 JSON。',
      safetyIdentifier: 'prospecting-scoring',
      outputFormat: { type: 'json_schema', name: 'lead_scores', strict: true, schema: OUTPUT_SCHEMA },
    });
    for (const [domain, score] of parseLlmScores(turn.text, batch.map((item) => item.domain))) scores.set(domain, score);
  }
  return scores;
}
