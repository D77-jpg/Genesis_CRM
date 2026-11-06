import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { chromium, type Browser } from 'playwright';
import { credentialFixture } from './fixtures/integration-management';

test('C2 real browser: one-time token, copy, reload, rotate, revoke, bilingual responsive UI', { timeout: 120_000 }, async () => {
  const f = await credentialFixture();
  let uiServer: Server | undefined;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const ui = express();
    ui.use((req, res, next) => { if (req.path.startsWith('/api/')) f.app(req, res, next); else next(); });
    ui.use(express.static(join(__dirname, '../../web/dist')));
    ui.get('*', (_req, res) => res.sendFile(join(__dirname, '../../web/dist/index.html')));
    uiServer = await new Promise<Server>(resolve => { const s = ui.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${(uiServer.address() as AddressInfo).port}`;
    const { default: env } = await import('../src/config/env');
    env.corsOrigins.push(base);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    // Exercise the copy button without replacing the user's operating-system clipboard.
    await context.addInitScript("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.fixtureClipboard = value; } }, configurable: true });");
    await context.addCookies([
      { name: 'cdlm_access', value: f.actors.manager.token, url: base, httpOnly: true, sameSite: 'Lax' },
      { name: 'cdlm_csrf', value: 'fictional-csrf', url: base, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', () => errors.push('browser-runtime-error'));
    await page.goto(base + '/projects/integrations');
    await page.getByRole('heading', { name: '集成与连接', exact: true }).waitFor();
    const createButton = page.getByRole('button', { name: '新建凭证', exact: true });
    await createButton.click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByRole('checkbox', { name: /逐条询盘归档/ }).isChecked(), true);
    assert.equal(await dialog.getByText('逐条询盘归档尚未开放。', { exact: false }).count(),0);
    await dialog.getByLabel('凭证名称', { exact: true }).fill('FICTIONAL Website');
    await dialog.getByRole('button', { name: '新建凭证', exact: true }).click();
    await page.getByRole('heading', { name: '保存你的连接凭证' }).waitFor();
    const token = (await page.locator('[data-secret]').textContent())!;
    assert.ok(/^gci_[a-f0-9]{48}$/.test(token), 'Token visible only in one-time dialog');
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await page.waitForFunction(value => (window as unknown as { fixtureClipboard: string }).fixtureClipboard === value, token, { timeout: 5000 });
    assert.ok(await page.evaluate(value => (window as unknown as { fixtureClipboard: string }).fixtureClipboard === value, token), 'Copy callback received the token');
    await page.getByRole('button', { name: '我已保存，关闭' }).click();
    await page.locator('[data-secret]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-secret]').count(), 0);
    assert.ok(await page.evaluate(value => !JSON.stringify([localStorage, sessionStorage]).includes(value), token), 'Token never enters browser storage');
    const probe = await fetch(f.base + '/api/integrations/v1/health', { headers: { Authorization: 'Bearer ' + token, 'X-Project-Id': String(f.a._id) } });
    assert.equal(probe.status, 200); await probe.arrayBuffer();
    await page.reload(); await page.getByText('FICTIONAL Website', { exact: true }).first().waitFor();
    await page.getByText('GET /api/integrations/v1/health', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-secret]').count(), 0);
    await page.getByRole('button', { name: '轮换', exact: true }).click();
    await page.getByLabel('旧凭证宽限期').selectOption('3600');
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('heading', { name: '保存你的连接凭证' }).waitFor();
    assert.ok((await page.locator('[data-secret]').textContent()) !== token, 'Rotation generated a different token');
    await page.getByRole('button', { name: '我已保存，关闭' }).click();
    await page.getByRole('button', { name: '吊销', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByText('已吊销', { exact: true }).first().waitFor();
    await page.getByText('凭证已吊销', { exact: true }).waitFor({ state: 'hidden' });
    const output = process.env.C2_UI_SCREENSHOTS || await mkdtemp(join(tmpdir(), 'globalcrm-c2-ui-'));
    await mkdir(output, { recursive: true });
    assert.equal(await page.locator('[data-secret]').count(), 0);
    await page.screenshot({ path: join(output, 'desktop-zh.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No mobile horizontal overflow');
    await page.screenshot({ path: join(output, 'mobile-zh.png'), fullPage: true });
    await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
    await page.getByRole('heading', { name: 'Integrations & connections', exact: true }).waitFor();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.setViewportSize({ width: 812, height: 375 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No landscape horizontal overflow');
    await page.screenshot({ path: join(output, 'landscape-en-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Large text remains within viewport');
    assert.equal(errors.length, 0, 'No browser runtime errors');
    console.log('C2 fictional UI screenshots: ' + output);
    await context.close();
  } finally {
    await browser?.close();
    if (uiServer) await new Promise<void>(resolve => uiServer!.close(() => resolve()));
    await f.cleanup();
  }
});
