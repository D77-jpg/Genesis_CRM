/**
 * 格式化与展示辅助
 * ------------------------------------------------------------------
 * 后端返回的时间字段可能是 ISO 字符串或 Date（axios 反序列化后为字符串），
 * 这里统一容错处理，任何非法值都渲染成占位符而不是 "Invalid Date"。
 */
import { format, isValid, parseISO } from 'date-fns';

const DATE_TIME_PATTERN = 'yyyy-MM-dd HH:mm';
const DATE_PATTERN = 'yyyy-MM-dd';
const PLACEHOLDER = '—';

/** 把任意时间输入转成 Date，失败返回 null */
export function toDate(value?: string | Date | number | null): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : parseISO(value);
  return isValid(date) ? date : null;
}

export function formatDateTime(value?: string | Date | number | null, fallback = PLACEHOLDER): string {
  const date = toDate(value);
  return date ? format(date, DATE_TIME_PATTERN) : fallback;
}

export function formatDate(value?: string | Date | number | null, fallback = PLACEHOLDER): string {
  const date = toDate(value);
  return date ? format(date, DATE_PATTERN) : fallback;
}

/** 「3 天前」这类中文相对时间，用于列表的时间列与最近联系 */
export function formatRelative(value?: string | Date | number | null, fallback = PLACEHOLDER): string {
  const date = toDate(value);
  if (!date) return fallback;

  const diffMs = Date.now() - date.getTime();
  const abs = Math.abs(diffMs);
  const suffix = diffMs >= 0 ? '前' : '后';
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return '刚刚';
  if (abs < hour) return `${Math.floor(abs / minute)} 分钟${suffix}`;
  if (abs < day) return `${Math.floor(abs / hour)} 小时${suffix}`;
  if (abs < 30 * day) return `${Math.floor(abs / day)} 天${suffix}`;
  if (abs < 365 * day) return `${Math.floor(abs / (30 * day))} 个月${suffix}`;
  return `${Math.floor(abs / (365 * day))} 年${suffix}`;
}

/** 转成 <input type="date"> 需要的 yyyy-MM-dd */
export function toInputDate(value?: string | Date | number | null): string {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
}

/* ---------------------------- 跟进时间 ---------------------------- */

/** 下一次跟进时间相对今天的状态：未设置 / 已逾期 / 今天 / 未来 */
export type FollowUpState = 'none' | 'overdue' | 'today' | 'upcoming';

/**
 * 判断跟进时间相对「本地时区今天 0 点」的状态。
 * 口径与后端 customer.service.buildCustomerFilter 的 today/overdue/upcoming 完全一致，
 * 保证列表筛选结果与前端高亮不会打架。
 */
export function getFollowUpState(value?: string | Date | number | null): FollowUpState {
  const date = toDate(value);
  if (!date) return 'none';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const time = date.getTime();
  if (time < startOfToday.getTime()) return 'overdue';
  if (time < startOfTomorrow.getTime()) return 'today';
  return 'upcoming';
}

/** 是否已逾期（有跟进时间且早于今天 0 点） */
export function isFollowUpOverdue(value?: string | Date | number | null): boolean {
  return getFollowUpState(value) === 'overdue';
}

/** 千分位数字 */
export function formatNumber(value?: number | null, fallback = '0'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return value.toLocaleString('zh-CN');
}

/**
 * 金额四舍五入到分（两位小数），与后端 Quotation.roundMoney 口径一致。
 * 前端即时计算行金额 / 总金额时用它消除浮点误差，后端会再算一次为准。
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * 金额显示：千分位 + 两位小数，可选前缀币种代码（如 `USD 1,234.50`）。
 * 与后端「以币种最小主单位（元）保留两位小数」的存储口径一致。
 */
export function formatMoney(value?: number | null, currency?: string | null, fallback = '0.00'): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return currency ? `${currency} ${fallback}` : fallback;
  }
  const amount = value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${amount}` : amount;
}

/** 百分比（0-1 或 0-100 均可，由 caller 决定 digits） */
export function formatPercent(value?: number | null, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0%';
  return `${(value * 100).toFixed(digits)}%`;
}

/** 姓名首字母，用于头像占位（中文取最后一个字，英文取首字母） */
export function initials(name?: string | null): string {
  const text = (name ?? '').trim();
  if (!text) return '?';
  if (/[\u4e00-\u9fa5]/.test(text)) return text.slice(-2).trim() || text.slice(-1);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/** 截断长文本，超出部分用省略号 */
export function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * HTML → 纯文本。
 * 用于「复制开发信内容」，粘贴到邮件客户端时不带标签噪音。
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 去掉 HTML 标签，用于表格里的正文摘要 */
export function stripHtml(html: string, max = 120): string {
  return truncate(htmlToPlainText(html).replace(/\n+/g, ' '), max);
}

/** 复制到剪贴板，兼容非安全上下文（http://内网 IP） */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走降级方案 */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** 文件大小友好显示 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
