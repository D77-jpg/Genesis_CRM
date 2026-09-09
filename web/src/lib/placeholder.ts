/**
 * 占位符渲染（前端本地版）
 * ------------------------------------------------------------------
 * 与 server/src/utils/text.ts 的 renderTemplate 行为保持一致，
 * 用于编辑器里的「实时预览」——不依赖网络，输入即渲染。
 * 正式发送时仍以后端渲染结果为准（后端会做 HTML 转义与落库）。
 */
import type { Customer, MetaResponse } from '@/types';

export type PlaceholderValues = Record<string, string>;

const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * 各占位符在取不到值时的兜底文案。
 *
 * 必须与后端 constants/index.ts 的 LETTER_PLACEHOLDERS.fallback **逐字保持一致**：
 * 这里只用于编辑器内的实时预览，真正发出去的文本是后端渲染的，
 * 两边兜底不同就会出现「预览看到 your industry、客户收到空字符串」这类偏差。
 */
export const PLACEHOLDER_FALLBACK: Record<string, string> = {
  name: 'there',
  firstName: 'there',
  company: 'your company',
  email: '',
  phone: '',
  title: '',
  industry: '',
  country: '',
  address: '',
  customerWebsite: '',
  grade: '',
  notes: '',
  companyName: '',
  companyWebsite: '',
  moq: '',
  senderName: '',
};

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 从「Ella Drake」中取出「Ella」；中文名保留全名 */
export function extractFirstName(fullName?: string): string {
  const name = (fullName ?? '').trim();
  if (!name) return '';
  if (/[\u4e00-\u9fa5]/.test(name)) return name;
  return name.split(/\s+/)[0] ?? name;
}

/**
 * 渲染占位符所需的客户字段。
 * 新增一个「客户信息」类占位符时，除了 LETTER_PLACEHOLDERS / PLACEHOLDER_DEFS，
 * 还要把对应字段补进这里，否则编译就会提醒。
 */
type PlaceholderCustomer = Pick<
  Customer,
  | 'name'
  | 'company'
  | 'email'
  | 'phone'
  | 'title'
  | 'industry'
  | 'country'
  | 'address'
  | 'website'
  | 'grade'
  | 'notes'
>;

/** 由客户档案 + 我方公司信息构造占位符取值表 */
export function buildPlaceholderValues(
  customer: PlaceholderCustomer | null,
  company?: MetaResponse['company'] | null,
): PlaceholderValues {
  const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

  return {
    name: text(customer?.name),
    firstName: extractFirstName(customer?.name),
    company: text(customer?.company),
    email: text(customer?.email),
    phone: text(customer?.phone),
    title: text(customer?.title),
    industry: text(customer?.industry),
    country: text(customer?.country),
    address: text(customer?.address),
    // 客户自己的官网（Customer.website），与下方「我方官网 companyWebsite」区分
    customerWebsite: text(customer?.website),
    grade: text(customer?.grade),
    notes: text(customer?.notes),
    companyName: text(company?.name),
    companyWebsite: text(company?.website),
    moq: text(company?.moq),
    senderName: text(company?.senderName),
  };
}

export interface RenderOptions {
  /** 是否对取值做 HTML 转义（正文渲染必须开启，防存储型 XSS） */
  escape?: boolean;
  /** 取不到值时是否使用兜底文案 */
  fallback?: boolean;
}

/**
 * 渲染 {{key}} 占位符。
 * @param template 含占位符的原始文本 / HTML
 */
export function renderTemplate(template: string, values: PlaceholderValues, options: RenderOptions = {}): string {
  const { escape = false, fallback = true } = options;
  if (!template) return '';

  return template.replace(PLACEHOLDER_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.trim();
    let value = values[key];
    if (value === undefined || value === '') {
      value = fallback ? (PLACEHOLDER_FALLBACK[key] ?? '') : '';
    }
    return escape ? escapeHtml(value) : value;
  });
}

/** 提取文本中出现过的占位符 key（去重） */
export function extractPlaceholderKeys(text: string): string[] {
  if (!text) return [];
  const keys = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    keys.add((match[1] ?? '').trim());
  }
  return Array.from(keys);
}

/** 找出文本里「客户档案中取不到值」的占位符，用于发送前的友好提醒 */
export function findMissingPlaceholders(text: string, values: PlaceholderValues): string[] {
  return extractPlaceholderKeys(text).filter((key) => {
    const value = values[key];
    return value === undefined || value === '' || value === PLACEHOLDER_FALLBACK[key];
  });
}
