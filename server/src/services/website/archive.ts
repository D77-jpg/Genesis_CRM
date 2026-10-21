/**
 * 客户官网的归档兜底
 * ------------------------------------------------------------------
 * 有些品牌官网会直接 403 / 429（WAF 拦截数据中心 IP），这不是「没有官网」，
 * 而是我们抓不到实时页面。此时退回 Internet Archive 的最近快照：
 * 内容仍是客户官网自己发布的文字，但必须标成历史快照（collectedAt 用快照时间），
 * 让模型知道这是归档内容，不是今天的页面。
 *
 * 隐私边界：只把客户官网 URL 发给 archive.org（该 URL 本来就是公开的），
 * 不发送客户档案、邮箱或任何内部数据。
 */
import { WebsiteError, fetchWebsite, type WebResponse } from './public-web';
import { browserFetch } from './browser-fetch';

const AVAILABLE_API = 'https://archive.org/wayback/available';
const MAX_AGE_DAYS = 365 * 3;

interface WaybackResponse {
  archived_snapshots?: {
    closest?: { available?: boolean; url?: string; timestamp?: string; status?: string };
  };
}

/** 快照时间戳（YYYYMMDDhhmmss）转 ISO；解析失败返回 undefined */
function snapshotTime(timestamp?: string): string | undefined {
  if (!timestamp || !/^\d{14}$/.test(timestamp)) return undefined;
  const iso = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

export async function archivedSnapshot(raw: string): Promise<WebResponse | undefined> {
  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return undefined;
  }
  const query = `${AVAILABLE_API}?url=${encodeURIComponent(target.href)}`;
  let payload: WaybackResponse;
  try {
    const response = await fetchWebsite(query, 'json');
    payload = JSON.parse(response.text) as WaybackResponse;
  } catch {
    return undefined;
  }
  const closest = payload.archived_snapshots?.closest;
  const snapshotUrl = closest?.available && closest.status === '200' ? closest.url : undefined;
  const collectedAt = snapshotTime(closest?.timestamp);
  if (!snapshotUrl || !collectedAt) return undefined;
  if (Date.now() - Date.parse(collectedAt) > MAX_AGE_DAYS * 86_400_000) return undefined;
  try {
    const snapshot = await fetchWebsite(snapshotUrl);
    if (!snapshot.text.trim()) return undefined;
    return { url: target.href, text: snapshot.text, status: 200, archivedAt: collectedAt };
  } catch (error) {
    if (error instanceof WebsiteError) return undefined;
    return undefined;
  }
}

/** 先抓实时页面；被拦/超时/没正文时依次尝试归档快照、无头浏览器 */
export async function fetchWithArchiveFallback(raw: string, kind: 'html' | 'robots' | 'json' = 'html'): Promise<WebResponse> {
  try {
    return await fetchWebsite(raw, kind);
  } catch (error) {
    if (kind !== 'html' || !(error instanceof WebsiteError)) throw error;
    if (!['http_error', 'timeout', 'no_text', 'dns_failed'].includes(error.code)) throw error;
    const snapshot = await archivedSnapshot(raw);
    if (snapshot) return snapshot;
    const rendered = await browserFetch(raw);
    if (rendered) return rendered;
    throw error;
  }
}
