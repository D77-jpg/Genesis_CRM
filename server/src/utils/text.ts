/**
 * 文本处理工具
 * ------------------------------------------------------------------
 * - HTML → 纯文本（用于 contentText 字段与全文搜索）
 * - 占位符渲染 {{name}} / {{company}} ...
 * - 正则转义，防止用户输入破坏 RegExp（ReDoS / 语法错误）
 */
import { LETTER_PLACEHOLDERS } from '../constants';
import type { ICustomer } from '../models/Customer';

/** 转义正则元字符 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** HTML 实体 → 字符 */
const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(#?\w+);/g, (match, entity: string) => {
      const key = entity.toLowerCase();
      if (ENTITY_MAP[key] !== undefined) return ENTITY_MAP[key];
      const numeric = key.startsWith('#') ? Number(key.slice(1)) : Number.NaN;
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : match;
    });
}

/**
 * 将 HTML 字符串转换为可读纯文本。
 * 块级元素之间插入换行，行内元素直接拼接。
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    // 移除 style / script 整块内容
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // <br> 与块级闭合标签转换行
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    // 列表项前置符号
    .replace(/<li[^>]*>/gi, '• ')
    // 去掉其余所有标签
    .replace(/<[^>]+>/g, '')
    // 解码实体
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#?\w+);/gi, (m) => decodeEntities(m))
    // 压缩多余空白
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** 将任意值转义为可安全嵌入 HTML 的字符串（防存储型 XSS） */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 从姓名中提取 First Name（按空格切分取第一段） */
export function extractFirstName(fullName?: string): string {
  if (!fullName) return '';
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  // 中文名（无空格）整体返回；英文名返回第一段
  return trimmed.includes(' ') ? trimmed.split(/\s+/)[0] : trimmed;
}

export type PlaceholderValues = Record<string, string>;

/**
 * 由客户档案构造占位符取值表。
 * 返回的值都是「原始文本」，注入 HTML 时由调用方负责转义。
 */
export function buildPlaceholderValues(customer: Partial<ICustomer>): PlaceholderValues {
  const name = customer.name ?? '';
  return {
    name,
    firstName: extractFirstName(name),
    company: customer.company ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    title: customer.title ?? '',
    industry: customer.industry ?? '',
    country: customer.country ?? '',
    address: customer.address ?? '',
    // 客户自己的官网（模型字段叫 website），占位符改叫 customerWebsite 以区分我方官网
    customerWebsite: customer.website ?? '',
    grade: customer.grade ?? '',
    notes: customer.notes ?? '',
    // 以下三项由 controller 从 env 注入，这里给空默认值兜底
    companyName: '',
    companyWebsite: '',
    moq: '',
    senderName: '',
  };
}

/**
 * 渲染模板：把 {{key}} 替换成实际值。
 * @param template  含占位符的原始内容（HTML 或纯文本）
 * @param values    占位符取值
 * @param options.escape 是否对取值做 HTML 转义（渲染 HTML 时必须为 true）
 * @param options.fallback 值为空时使用的兜底文案（按 placeholder 定义）
 */
export function renderTemplate(
  template: string,
  values: PlaceholderValues,
  options: { escape?: boolean; fallback?: boolean } = {},
): string {
  const { escape = false, fallback = true } = options;
  const fallbackMap = new Map<string, string>(LETTER_PLACEHOLDERS.map((p) => [p.key, p.fallback]));

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    let value = values[key];
    if (value === undefined || value === '') {
      value = fallback ? fallbackMap.get(key) ?? '' : '';
    }
    return escape ? escapeHtml(value) : value;
  });
}

/** 提取模板中实际用到的占位符 key 列表（去重） */
export function extractPlaceholderKeys(template: string): string[] {
  const keys = new Set<string>();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let match: RegExpExecArray | null = re.exec(template);
  while (match !== null) {
    keys.add(match[1].trim());
    match = re.exec(template);
  }
  return [...keys];
}

/** 规范化邮箱：trim + 小写 */
export function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

/** 简单的邮箱格式校验（与模型层保持一致） */
export function isValidEmail(email?: string | null): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email ?? '').trim());
}

/** 截断字符串，超出部分以省略号结尾 */
export function truncate(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
