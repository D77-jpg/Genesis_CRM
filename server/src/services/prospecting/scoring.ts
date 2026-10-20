// Deterministic, explainable pre-score for a discovered lead.
// LLM scoring against 01-客户画像 is the next step; this keeps P0 free of model calls
// and gives the reviewer a reason for every candidate.

export type LeadVerdict = 'ready' | 'low' | 'needs_contact' | 'rejected';

export interface ScoreResult {
  score: number;
  reasons: string[];
  status: LeadVerdict;
}

export interface ScoreInput {
  domain: string;
  name?: string;
  snippet?: string;
  excerpt?: string;
  emails?: string[];
  emailSource?: 'site' | 'hunter';
  emailConfidence?: number;
  instagram?: string;
  linkedin?: string;
}

const BRAND_SIGNALS = [/our story/i, /handmade|handcrafted/i, /designed in/i, /small batch/i, /founded/i, /atelier/i, /collection/i, /sustainab/i, /made in/i];
const CATEGORY = /jewelry|jewellery|candle|skincare|beauty|fashion|accessor|gift|fragrance|perfume|apparel|textile|home goods|ceramic/i;
const TARGET_MARKET = /made in (usa|the usa|america|uk|europe|australia)|united states|new york|los angeles|london|paris|berlin|sydney|toronto|melbourne/i;
// Only judged on domain / title / snippet: crawled footers mention "wholesale" and
// "supplier" too often to be a reliable signal.
const EXCLUDE_DOMAIN = /directory|marketplace|wholesale|supply|sourcing|expo|trade|association|magazine|news|blog|society|guild/i;
const EXCLUDE_TITLE = /directory|marketplace|wholesale|supplier|manufacturer|distributor|association|magazine|journal|blog|news|society|guild|trade show/i;
const EXCLUDE_SNIPPET = /wholesale supplier|contract packaging|packaging (supplier|manufacturer)|private label|sourcing agent|import export|trading company/i;

export function scoreLead(input: ScoreInput, minScore = 60): ScoreResult {
  const haystack = [input.name, input.snippet, input.excerpt].filter(Boolean).join(' ');
  const reasons: string[] = [];
  let score = 30;

  if (EXCLUDE_DOMAIN.test(input.domain) || EXCLUDE_TITLE.test(input.name ?? '') || EXCLUDE_SNIPPET.test(input.snippet ?? '')) {
    return { score: 0, reasons: ['看起来是目录站、零售商、供应商或协会，不是品牌方'], status: 'rejected' };
  }

  if (input.emails?.length) {
    if (input.emailSource === 'hunter') {
      score += 20;
      reasons.push(`Hunter 找到邮箱${input.emailConfidence ? `（置信度 ${input.emailConfidence}%）` : ''}`);
    } else { score += 25; reasons.push('官网有公开邮箱'); }
  }
  else if (input.instagram) { score += 12; reasons.push('有 Instagram（需要补邮箱）'); }
  else if (input.linkedin) { score += 6; reasons.push('有 LinkedIn（需要补邮箱）'); }

  if (CATEGORY.test(haystack)) { score += 15; reasons.push('品类与箱包/礼品/美妆客户相符'); }
  const brandHits = BRAND_SIGNALS.filter((pattern) => pattern.test(haystack)).length;
  if (brandHits) { score += Math.min(15, 6 * brandHits); reasons.push('有品牌/手作/独立站特征'); }
  if (TARGET_MARKET.test(haystack)) { score += 10; reasons.push('目标市场信号（美/欧/澳）'); }
  if (input.excerpt && input.excerpt.length > 150) { score += 5; reasons.push('官网内容较完整'); }

  score = Math.max(0, Math.min(100, score));
  // Ready means "can send an email today"; social-only candidates go to needs_contact.
  const status: LeadVerdict = !input.emails?.length
    ? 'needs_contact'
    : score >= minScore ? 'ready' : 'low';
  if (status === 'needs_contact') {
    reasons.push(input.instagram || input.linkedin ? '只有社交账号，没有公开邮箱，需要人工补联系方式' : '没有找到邮箱、Instagram 或 LinkedIn，需要人工补联系方式');
  }
  if (status === 'low') reasons.push(`评分低于阈值 ${minScore}，暂不进入今日名单`);
  return { score, reasons, status };
}
