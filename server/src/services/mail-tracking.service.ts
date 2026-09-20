import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import env from '../config/env';
import { DevelopmentLetter } from '../models';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_TRACKED_LINKS = 100;

export interface PreparedTrackingLink {
  tokenHash: string;
  originalUrl: string;
  clickCount: number;
}

export interface PreparedTracking {
  deliveryHtml: string;
  tracking?: {
    prepared: true;
    enabled: false;
    openTokenHash: string;
    openCount: 0;
    clickCount: 0;
    links: PreparedTrackingLink[];
  };
}

export interface TrackingSummary {
  enabled: boolean;
  opened: boolean;
  openedAt?: Date;
  openCount: number;
  lastOpenedAt?: Date;
  clicked: boolean;
  clickedAt?: Date;
  clickCount: number;
  lastClickedAt?: Date;
  clickedLinks: {
    url: string;
    clickedAt?: Date;
    clickCount: number;
    lastClickedAt?: Date;
  }[];
  accuracyNotice: string;
}

export function generateTrackingToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function trackingUrl(path: string, token: string): string {
  return new URL(`/api/tracking/${path}/${token}`, env.TRACKING_BASE_URL).toString();
}

/** 跳转 URL 不从请求参数接收，且每次跳转前再做一次协议检查。 */
export function isSafeRedirectUrl(value: string): boolean {
  if (!value || value.length > 4000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function internalHosts(): Set<string> {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '::1']);
  for (const value of [env.TRACKING_BASE_URL, ...env.corsOrigins]) {
    try { hosts.add(new URL(value).hostname.toLowerCase()); } catch { /* wildcard / invalid origin is ignored */ }
  }
  return hosts;
}

export function shouldTrackLink(value: string): boolean {
  const decoded = value.replace(/&amp;/gi, '&');
  if (!isSafeRedirectUrl(decoded)) return false;
  const url = new URL(decoded);
  const searchable = `${url.pathname}${url.search}${url.hash}`.toLowerCase();
  if (/(^|[\/_?&=#.-])(unsubscribe|unsub|opt[-_]?out)([\/_?&=#.-]|$)/i.test(searchable)) return false;
  if (internalHosts().has(url.hostname.toLowerCase())) return false;
  return true;
}

/**
 * 对已清洗 HTML 做发送副本。原文 content 不改，因此 CRM 预览不会请求 pixel。
 * 纯文本、无标签内容直接返回，追踪失败也由上层降级为原始 HTML。
 */
export function prepareTrackedHtml(html: string): PreparedTracking {
  if (!/<[a-z][\s\S]*>/i.test(html)) return { deliveryHtml: html };

  const links: PreparedTrackingLink[] = [];
  const delivery = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (anchor, attributes: string, innerHtml: string) => {
    if (links.length >= MAX_TRACKED_LINKS) return anchor;
    if (/\bdata-no-track(?:\s*=|\s|$)/i.test(attributes) || /\brel\s*=\s*(["'])[^"']*unsubscribe[^"']*\1/i.test(attributes)) return anchor;
    const visibleText = innerHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim();
    if (/\b(unsubscribe|opt[- ]?out)\b|\u9000\u8ba2|\u53d6\u6d88\u8ba2\u9605/i.test(visibleText)) return anchor;
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!href || !shouldTrackLink(href[2])) return anchor;
    const originalUrl = href[2].replace(/&amp;/gi, '&');
    const token = generateTrackingToken();
    links.push({ tokenHash: hashTrackingToken(token), originalUrl, clickCount: 0 });
    return anchor.replace(href[0], `href="${trackingUrl('c', token)}"`);
  });

  const openToken = generateTrackingToken();
  const pixel = `<img src="${trackingUrl('o', openToken)}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden" />`;
  const deliveryHtml = /<\/body\s*>/i.test(delivery)
    ? delivery.replace(/<\/body\s*>/i, `${pixel}</body>`)
    : `${delivery}${pixel}`;

  return {
    deliveryHtml,
    tracking: {
      prepared: true,
      enabled: false,
      openTokenHash: hashTrackingToken(openToken),
      openCount: 0,
      clickCount: 0,
      links,
    },
  };
}

export function trackingSummary(value: unknown): TrackingSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const tracking = value as {
    enabled?: boolean; openedAt?: Date; openCount?: number; lastOpenedAt?: Date;
    clickedAt?: Date; clickCount?: number; lastClickedAt?: Date;
    links?: { originalUrl: string; clickedAt?: Date; clickCount?: number; lastClickedAt?: Date }[];
  };
  if (!tracking.enabled) return undefined;
  const openCount = tracking.openCount ?? 0;
  const clickCount = tracking.clickCount ?? 0;
  return {
    enabled: true,
    opened: openCount > 0,
    openedAt: tracking.openedAt,
    openCount,
    lastOpenedAt: tracking.lastOpenedAt,
    clicked: clickCount > 0,
    clickedAt: tracking.clickedAt,
    clickCount,
    lastClickedAt: tracking.lastClickedAt,
    clickedLinks: (tracking.links ?? []).filter((link) => (link.clickCount ?? 0) > 0).map((link) => ({
      url: link.originalUrl,
      clickedAt: link.clickedAt,
      clickCount: link.clickCount ?? 0,
      lastClickedAt: link.lastClickedAt,
    })),
    accuracyNotice: '邮件客户端、图片代理或隐私保护可能影响统计，数据仅作互动参考。',
  };
}

export async function recordOpen(token: string, _req?: Request): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const now = new Date();
  const result = await DevelopmentLetter.updateOne({
    'tracking.openTokenHash': hashTrackingToken(token),
    'tracking.enabled': true,
    status: { $in: ['sent', 'opened'] },
  }, {
    $set: { status: 'opened' },
    $min: { 'tracking.openedAt': now },
    $max: { 'tracking.lastOpenedAt': now },
    $inc: { 'tracking.openCount': 1 },
  });
  return result.modifiedCount === 1;
}

export async function recordClick(token: string, _req?: Request): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const tokenHash = hashTrackingToken(token);
  const doc = await DevelopmentLetter.findOne({
    'tracking.links.tokenHash': tokenHash,
    'tracking.enabled': true,
    status: { $in: ['sent', 'opened'] },
  }).select('+tracking.links.tokenHash');
  const link = doc?.tracking?.links.find((item) => item.tokenHash === tokenHash);
  if (!doc || !link || !isSafeRedirectUrl(link.originalUrl)) return null;

  const now = new Date();
  const result = await DevelopmentLetter.updateOne({
    _id: doc._id,
    'tracking.links.tokenHash': tokenHash,
    'tracking.enabled': true,
    status: { $in: ['sent', 'opened'] },
  }, {
    $min: { 'tracking.clickedAt': now, 'tracking.links.$.clickedAt': now },
    $max: { 'tracking.lastClickedAt': now, 'tracking.links.$.lastClickedAt': now },
    $inc: { 'tracking.clickCount': 1, 'tracking.links.$.clickCount': 1 },
  });
  return result.modifiedCount === 1 ? link.originalUrl : null;
}
