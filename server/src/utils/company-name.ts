/**
 * 公司名清洗
 * ------------------------------------------------------------------
 * 潜客抓取时，官网没有明确公司名，就退化成落库网页 <title>：
 *   "Colonial Candle: Dinner Candles, Scented Candles, Wax …"
 *   "Beeswax & Custom Candles For Sale | GreenTree Home …"
 *   "CandleStore.com (Made in USA Scented Candles) Pocono …"
 * 这些字符串放给业务员看很别扭，所以统一按「取品牌段」的规则收缩：
 *  1. 去掉末尾的省略号 / 多个句点；
 *  2. 去掉括号补充说明；
 *  3. 按 `|` `:` `–` `—` `-` 切段，取第一个「像品牌」的段
 *     （带逗号、词太多、含 for sale / best / shop all 这类营销词的段算「描述段」）；
 *  4. 段首如果是域名（CandleStore.com），只留域名本身。
 * 认不出来的（本来就是一个完整名字）原样返回，绝不硬改。
 */

/** 营销/描述性词汇：出现即认为这一段是网页标题里的说明，不是品牌 */
const DESCRIPTIVE = /(?:^|\W)(?:shop all|shop now|buy now|for sale|free shipping|best |the best|official|online store|online shop|reviews?|gifts?|coupons?|discount|cheap|wholesale|home page|welcome)(?:\W|$)/i;

/** 描述性开头：Top 30 / Best … / Shop … */
const DESCRIPTIVE_HEAD = /^(?:top\s*\d*|best|shop|buy|official|welcome|home page)\b/i;

const SEPARATORS = /\s*[|｜:：]\s*|\s+[–—]\s+|\s+-\s+/;

function tidy(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    // 末尾的 "..." / "…" / 多个句点
    .replace(/[\s.…]+$/, '')
    .trim();
}

/** 去掉尾部的括号补充：「CandleStore.com (Made in USA Scented Candles)」→「CandleStore.com」 */
function stripParenthetical(value: string): string {
  return tidy(value.replace(/\s*[(（][^()（）]*[)）]\s*$/, ''));
}

function isDescriptive(segment: string): boolean {
  if (segment.includes(',')) return true;
  if (DESCRIPTIVE_HEAD.test(segment)) return true;
  if (DESCRIPTIVE.test(segment)) return true;
  // 超过 5 个词基本是说明句，不是品牌
  return segment.split(' ').length > 5;
}

/** 段首是域名时只保留域名：「CandleStore.com Pocono」→「CandleStore.com」 */
function domainHead(segment: string): string {
  const first = segment.split(' ')[0] ?? '';
  return /^[a-z0-9-]+\.(?:com|net|org|co|io|shop|store|us|cn|uk)$/i.test(first) ? first : '';
}

/**
 * 把网页标题形状的公司名收缩成品牌名。
 * 清洗后比原文短很多时，说明确实是标题尾巴，调用方可以据此提示人工复核。
 */
export function cleanCompanyName(raw?: string | null): string {
  const original = tidy((raw ?? '').replace(/[\r\n\t]+/g, ' '));
  if (!original) return '';

  const segments = original
    .split(SEPARATORS)
    .map((segment) => stripParenthetical(tidy(segment)))
    .filter(Boolean);

  const brand = segments.find((segment) => !isDescriptive(segment)) ?? segments[0] ?? original;
  const withDomain = domainHead(brand) || brand;

  // 一个词都不剩就别动
  return withDomain.trim() || original;
}

/**
 * 清洗后是否仍需人工看一眼：
 *  - 剩下的还是长句（「Top Jewelry Manufacturers In USA …」这类榜单标题）；
 *  - 或者收得太狠，只剩一个被截断的品牌词（「Candles… | Yankee …」→「Yankee」）。
 */
export function needsManualReview(raw?: string | null): boolean {
  const original = (raw ?? '').trim();
  const cleaned = cleanCompanyName(raw);
  if (!cleaned || cleaned === original) return false;
  if (cleaned.split(' ').length > 4 || isDescriptive(cleaned)) return true;
  const bare = cleaned.replace(/[®™]/g, '');
  return bare.length <= 6 && /[|｜–—]/.test(original);
}
