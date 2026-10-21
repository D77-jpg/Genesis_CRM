/**
 * 开发信固定结尾（公司统一签名）
 * ------------------------------------------------------------------
 * 结尾不允许每个业务员各写一套，统一由服务端追加：
 *   第一行  当前使用账号的姓名（个人发件邮箱显示名 → 登录账号姓名 → 项目署名）
 *   第二行  固定职位与公司
 *   细线
 *   固定联系方式、站点与资质行
 *
 * 三条约束：
 *  1. 生成稿在逐项核验阶段就写入纯文本签名，`knowledgeReview.bodyHash` 因此包含签名；
 *     保存成 HTML 草稿时再把同一段换成 HTML 版，`contentText` 必须与纯文本版逐字一致，
 *     否则审核页会误报「内容已变化」。
 *  2. `safeMailHtml` 只放行排版类标签（img 会被剥离），所以签名只用文字 + `<hr>` 还原版式。
 *  3. 已经带签名（含 {SIGNATURE_MARKER}）的内容不重复追加。
 */
import env from '../config/env';
import { BRAND_LOGO_PATH } from '../constants/brand-logo';
import { escapeHtml } from '../utils/text';

export const LETTER_SIGNATURE = {
  /** 固定职位行：所有业务员对外统一使用 */
  title: 'Sales Manager, Genesis (Xiamen) Bags Co., Ltd.',
  /** 固定联系方式 / 站点 / 资质行 */
  lines: [
    'Genesis Bags · Custom Packaging Manufacturer · Xiamen· Where Packaging Begins',
    'WhatsApp +86 153 0600 1357 · sales@genesisbags.com',
    'genesisbags.com · genesisgroup.en.alibaba.com',
    'Gold Supplier on Alibaba.com since 2014 · ISO 9001 / FSC® / BSCI Certified',
  ],
} as const;

/** 正文里出现这一行就认为已经带了固定结尾，不再追加 */
export const SIGNATURE_MARKER = LETTER_SIGNATURE.lines[3];

const SIGNOFF_LINE = /^(?:(?:best|kind|warm|many)(?:\s+(?:regards|wishes|thanks))?|regards|sincerely|thanks)[,.!\s]*$/i;
const PLACEHOLDER_ONLY = /^\{\{\s*(?:senderName|companyName|companyWebsite|senderEmail)\s*\}\}$/i;

/** 结尾第一行：优先当前账号姓名，其次项目署名，最后兜底 */
export function signatureName(preferred?: string | null, fallback?: string | null): string {
  const first = (preferred ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (first) return first;
  const second = (fallback ?? '').replace(/[\r\n]+/g, ' ').trim();
  return second || 'Sales Team';
}

/** 纯文本版签名（生成稿 / contentText / 邮件 text 部分） */
export function renderSignatureText(name: string): string {
  return [signatureName(name), LETTER_SIGNATURE.title, '', ...LETTER_SIGNATURE.lines].join('\n');
}

export function hasSignature(text: string): boolean {
  return text.includes(SIGNATURE_MARKER);
}

/** 品牌 logo 的对外地址；关闭 SIGNATURE_LOGO 时为空（只输出文字签名） */
export function signatureLogoUrl(): string {
  return env.SIGNATURE_LOGO ? `${env.publicBaseUrl}${BRAND_LOGO_PATH}` : '';
}

/**
 * HTML 版签名。
 * 注意：htmlToPlainText(renderSignatureHtml(n)) === renderSignatureText(n)，改动时保持成立。
 */
export function renderSignatureHtml(name: string): string {
  const who = escapeHtml(signatureName(name));
  const lines = LETTER_SIGNATURE.lines.map((line) => escapeHtml(line)).join('<br>');
  const logoUrl = signatureLogoUrl();
  const logo = logoUrl
    ? `<br><img src="${escapeHtml(logoUrl)}" alt="Genesis Packaging" width="180" style="display:block;border:0;max-width:180px;height:auto;margin:8px 0 0">`
    : '';
  return `<div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6">`
    + `<strong>${who}</strong><br>${escapeHtml(LETTER_SIGNATURE.title)}${logo}<hr><br>${lines}</div>`;
}

/** 把正文里的固定签名切出来（名字取签名块第一行），没有签名时 body 原样返回 */
export function splitSignatureText(text: string): { body: string; name?: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const titleIndex = lines.map((line) => line.trim()).lastIndexOf(LETTER_SIGNATURE.title);
  if (titleIndex < 1) return { body: text.replace(/\r\n/g, '\n').trim() };
  const name = lines[titleIndex - 1]?.trim();
  let cut = titleIndex - 1;
  while (cut > 0 && !lines[cut - 1].trim()) cut--;
  return { body: lines.slice(0, cut).join('\n').trim(), name: name || undefined };
}

/**
 * 正文 + 固定签名 → 邮件 HTML。
 * 纯文本正文转义后用 <br> 保留换行；签名用 HTML 版，两者之间隔一个空行。
 */
export function renderLetterContent(bodyText: string, fallbackName: string): string {
  const { body, name } = splitSignatureText(bodyText);
  const signer = name || signatureName(fallbackName);
  const paragraphs = body ? `<p>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</p><br>` : '';
  return `${paragraphs}${renderSignatureHtml(signer)}`;
}

/**
 * 去掉正文尾部已有的签名（固定格式或模型自己写的 `Best regards,` 落款），返回纯正文。
 * `known` 传入企业名、邮箱、网站等，避免把落款里的这些行当成正文。
 */
export function stripSignatureText(text: string, known: readonly (string | undefined)[] = []): string {
  const lines = splitSignatureText(text).body.split('\n');
  const extras = new Set(known.map((value) => (value ?? '').trim()).filter(Boolean));
  const isContact = (line: string) => extras.has(line)
    || /^(?:genesis|www\.|https?:\/\/|[^@\s]+@[^@\s]+\.[a-z]{2,})/i.test(line);
  const isNameLike = (line: string) => line.split(/\s+/).length <= 4 && !/[.!?]$/.test(line) && !isContact(line);

  // 有落款词时，把它后面跟着的姓名 / 公司 / 邮箱 / 网址整段一起切掉
  let cut = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (SIGNOFF_LINE.test(lines[index].trim())) { cut = index; break; }
  }
  if (cut >= 0 && lines.slice(cut + 1).map((line) => line.trim()).filter(Boolean).every((line) => isContact(line) || isNameLike(line))) {
    while (cut > 0 && !lines[cut - 1].trim()) cut--;
    return lines.slice(0, cut).join('\n').trim();
  }

  // 没有落款词时只剥掉纯联系方式的尾巴
  let end = lines.length;
  while (end > 0 && (!lines[end - 1].trim() || isContact(lines[end - 1].trim()))) end--;
  return lines.slice(0, end).join('\n').trim();
}

/**
 * 去掉模板自带的老式落款（`Best,` + 署名 + 公司），避免和固定结尾重复出现两次。
 * 富文本编辑器会把落款拆成多个段落（`<p>Best regards,</p><p>{{senderName}}</p>…`），
 * 所以按「最后一个段落」反复剥，直到不再变化。
 */
export function stripTrailingSignoff(content: string): string {
  let current = content;
  for (let guard = 0; guard < 8; guard++) {
    const next = stripLastSignoffBlock(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function stripLastSignoffBlock(content: string): string {
  const match = content.match(/(<(?:p|div)[^>]*>)((?:(?!<\/p>|<\/div>)[\s\S])*)(<\/p>|<\/div>)\s*$/i);
  if (!match || match.index === undefined) return content;
  const lines = match[2]
    .split(/<br\s*\/?>/i)
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 8) return content;
  // 一个段落要么以落款词开头，要么整段只有占位符/联系方式，才算落款的一部分
  const isSignoff = SIGNOFF_LINE.test(lines[0]);
  const allSignatureish = lines.every((line) => PLACEHOLDER_ONLY.test(line) || /^(?:genesis|www\.|https?:\/\/|[^@\s]+@)/i.test(line));
  if (!isSignoff && !allSignatureish) return content;
  return content.slice(0, match.index).trim();
}

/** 保证正文带固定结尾：已有就不动，没有就补上（模板自带的落款先去掉） */
export function ensureSignature(content: string, name: string): string {
  if (hasSignature(content)) return content;
  const signer = signatureName(name);
  // 纯文本正文保持纯文本：不引入标签，否则会被当成 HTML 邮件并挂上追踪像素
  if (!/<[a-z!/][^>]*>/i.test(content)) {
    const body = stripSignatureText(content);
    return body ? `${body}\n\n${renderSignatureText(signer)}` : renderSignatureText(signer);
  }
  return `${stripTrailingSignoff(content)}<br>${renderSignatureHtml(signer)}`;
}
