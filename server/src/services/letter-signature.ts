/**
 * 开发信固定结尾（公司统一签名）
 * ------------------------------------------------------------------
 * 结尾不允许每个业务员各写一套，统一由服务端追加：
 *   第一行  当前使用账号的姓名（个人发件邮箱显示名 → 登录账号姓名 → 项目署名）
 *   第二行  固定职位与公司
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
import { escapeHtml, htmlToPlainText } from '../utils/text';

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

/** 账号名常常是全大写（CARLOS）：对外署名转成正常大小写，缩写（ISO/USA）保持原样 */
const tidySignatureName = (value: string) => value
  .split(/\s+/)
  .map((token) => (/^[A-Z]{4,}$/.test(token) ? token[0] + token.slice(1).toLowerCase() : token))
  .join(' ');

/** 结尾第一行：优先当前账号姓名，其次项目署名，最后兜底 */
export function signatureName(preferred?: string | null, fallback?: string | null): string {
  const first = (preferred ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (first) return tidySignatureName(first);
  const second = (fallback ?? '').replace(/[\r\n]+/g, ' ').trim();
  return second ? tidySignatureName(second) : 'Sales Team';
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
    ? `<img src="${escapeHtml(logoUrl)}" alt="Genesis Packaging" width="160" style="display:block;border:0;width:160px;height:auto;margin:6px 0">`
    : '';
  return `<div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6">`
    + `<strong>${who}</strong><br>${escapeHtml(LETTER_SIGNATURE.title)}<br>${logo}<br>${lines}</div>`;
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

  // 没有落款词时：剥掉「联系方式 + 姓名」组成的尾巴（老草稿常见：姓名 / 公司 / 网址），
  // 但要求这一串里至少有一行是明确的联系方式，避免把正文最后一句当成签名删掉。
  const trailing: string[] = [];
  let index = lines.length - 1;
  while (index >= 0) {
    const line = lines[index].trim();
    if (!line) { trailing.push(''); index--; continue; }
    if (isContact(line) || isNameLike(line)) { trailing.push(line); index--; continue; }
    break;
  }
  const hasContact = trailing.some((line) => line && isContact(line));
  if (!hasContact) return lines.join('\n').trim();
  return lines.slice(0, index + 1).join('\n').trim();
}

/**
 * 去掉模板自带的老式落款（`Best,` + 署名 + 公司 + 网址），避免和固定结尾重复出现两次。
 * 富文本编辑器会把落款拆成多个段落（`<p>Best regards,</p><p>Genesis Admin</p>…`），
 * 所以按「最后一个段落」反复剥，直到不再变化；姓名单行只在已经剥掉落款/联系方式后才允许删。
 */
export function stripTrailingSignoff(content: string): string {
  let current = content;
  let sawStrong = false;
  for (let guard = 0; guard < 12; guard++) {
    const result = stripLastSignoffBlock(current, sawStrong);
    if (!result) break;
    current = result.html;
    sawStrong = sawStrong || result.strong;
  }
  return current;
}

function stripLastSignoffBlock(content: string, sawStrong: boolean): { html: string; strong: boolean } | undefined {
  const match = content.match(/(<(?:p|div)[^>]*>)((?:(?!<\/p>|<\/div>)[\s\S])*)(<\/p>|<\/div>)\s*$/i);
  if (!match || match.index === undefined) return undefined;
  const lines = match[2]
    .split(/<br\s*\/?>/i)
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 8) return undefined;
  const contact = (line: string) => PLACEHOLDER_ONLY.test(line) || /^(?:genesis|www\.|https?:\/\/|[^@\s]+@)/i.test(line);
  const nameLike = (line: string) => !contact(line) && line.split(/\s+/).length <= 4 && !/[.!?]$/.test(line) && !/\d/.test(line);
  // 落款词、纯联系方式、或（已剥过落款/联系方式之后的）姓名单行都算结尾的一部分
  const isSignoff = SIGNOFF_LINE.test(lines[0]);
  const allContact = lines.every(contact);
  const singleName = lines.length === 1 && nameLike(lines[0]) && sawStrong;
  if (!isSignoff && !allContact && !singleName) return undefined;
  return { html: content.slice(0, match.index).trim(), strong: isSignoff || allContact };
}

/**
 * 保证正文带固定结尾。
 * - 正文里还没有结尾：HTML 正文补 HTML 版（带 logo），纯文本正文补纯文本版；
 * - 正文里已有编辑器写入的文字结尾（没有 logo/分隔线）：升级成 HTML 版，
 *   纯文本保持不变，避免审核哈希与已保存正文不一致。
 */
export function ensureSignature(content: string, name: string): string {
  if (hasSignature(content)) {
    if (/genesis-logo/.test(content)) return content;
    const text = htmlToPlainText(content);
    const { body, name: signerFromBody } = splitSignatureText(text);
    const signer = signerFromBody || signatureName(name);
    // 老草稿里可能还留着「姓名 / 公司 / 网址」这类旧落款，先剥掉再补固定结尾
    const cleanBody = stripSignatureText(body);
    // 用单个换行衔接，和编辑器里「每段一行」的排版保持一致，纯文本不增加空行
    const bodyHtml = cleanBody ? `${escapeHtml(cleanBody).replace(/\r?\n/g, '<br>')}<br>` : '';
    return `${bodyHtml}${renderSignatureHtml(signer)}`;
  }
  const signer = signatureName(name);
  // 纯文本正文保持纯文本：不引入标签，否则会被当成 HTML 邮件并挂上追踪像素
  if (!/<[a-z!/][^>]*>/i.test(content)) {
    const body = stripSignatureText(content);
    return body ? `${body}\n\n${renderSignatureText(signer)}` : renderSignatureText(signer);
  }
  return `${stripTrailingSignoff(content)}<br>${renderSignatureHtml(signer)}`;
}
