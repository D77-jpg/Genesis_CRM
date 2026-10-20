// LLM brand-fit scoring against 01-客户画像. Runs only on candidates that survived
// the deterministic prefilter, in small batches, and never overrides "needs contact".
import { resolveAgentProvider } from '../agent/ai-settings.service';
import type { AgentProvider } from '../agent/provider';
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

const RUBRIC = `你是箱包/礼品包装工厂（Genesis Bags，厦门）的外贸业务助理。根据《01-客户画像》给每个候选品牌打分：
- 目标：美国/欧洲/澳洲的独立珠宝、香薰蜡烛、护肤美妆、设计师服饰/配饰、礼品品牌，通常 20–200 人，重视设计与包装，有定制袋/盒需求。
- 加分：自有品牌与独立站、手作/小批量、设计师故事、可持续、礼品属性、明确的目标市场。
- 排除（exclude=true）：目录站/商城/零售商/批发商/经销商/包装供应商/制造商/行业协会/展会展商/代运营/贸易公司；与我方是同行或明显不需要定制包装的公司。
- 联系方式不作为评分依据（邮箱由系统另行补全）。
只输出 JSON，不要解释。每个候选给出 0–100 的匹配分、最多 3 条简短理由；不匹配时给 exclude=true 和一句原因。`;

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

export async function scoreLeadsWithLlm(items: LlmScoreInput[], provider?: AgentProvider, profileText?: string | null): Promise<Map<string, LlmScore>> {
  const scores = new Map<string, LlmScore>();
  const active = provider ?? await resolveAgentProvider();
  if (!active.isAvailable()) throw new Error('AI 未配置，暂时只用规则评分');
  const instructions = profileText
    ? `${RUBRIC}\n\n以下是本项目资料库中的《客户画像》原文，评分时优先遵循：\n${profileText}`
    : RUBRIC;
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
