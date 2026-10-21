/**
 * 浏览器兜底抓取（可选）
 * ------------------------------------------------------------------
 * 有些品牌官网的 WAF（Akamai 等）会直接拦掉普通 HTTP 客户端（403），
 * 但真实浏览器能正常打开。这里用 Playwright/Chromium 以无头浏览器读取正文，
 * 只在「实时抓取被拒 + 归档不可用」之后作为最后手段。
 *
 * 默认关闭（WEBSITE_BROWSER_FETCH=true 才启用），因为：
 *  - 需要额外安装 playwright（含 Chromium，体积大）；
 *  - 每次抓取要启动浏览器，比 HTTP 慢一个量级。
 * 部署时按需 `npm i playwright` 并设置环境变量；未安装时这里直接返回空，
 * 调用方继续走原有的失败路径，不影响其他功能。
 *
 * 这里不对 playwright 做静态依赖：用变量说明符动态 import，安装与否都能编译。
 */
import env from '../../config/env';
import type { WebResponse } from './public-web';
import { websiteUrl } from './public-web';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface PlaywrightPage {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>;
  evaluate<T>(expression: string): Promise<T>;
  url(): string;
}
interface PlaywrightBrowser {
  newPage(options: Record<string, unknown>): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightLike {
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
}

async function loadPlaywright(): Promise<PlaywrightLike | undefined> {
  const specifier = 'playwright';
  try {
    const module = (await import(specifier)) as { chromium?: PlaywrightLike };
    return module.chromium;
  } catch {
    return undefined;
  }
}

export async function browserFetch(raw: string): Promise<WebResponse | undefined> {
  if (!env.WEBSITE_BROWSER_FETCH) return undefined;
  let url: URL;
  try {
    url = websiteUrl(raw);
  } catch {
    return undefined;
  }
  const chromium = await loadPlaywright();
  if (!chromium) return undefined;
  let browser: PlaywrightBrowser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: USER_AGENT, locale: 'en-US', viewport: { width: 1366, height: 900 } });
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!response || response.status() >= 400) return undefined;
    const text = await page.evaluate<string>('document.body ? document.body.innerText : ""');
    if (!text?.trim()) return undefined;
    return { url: page.url(), text, status: 200 };
  } catch {
    return undefined;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
