import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import type { Server } from 'node:http';
import { inquiryFixture } from './fixtures/integration-inquiry';
test('C3 browser: source, notices, safe draft, bilingual responsive layout', { timeout: 120000 }, async () => {
    const f = await inquiryFixture();
    let ui: Server | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        const r = await f.request('/inquiries', { schemaVersion: '1.0', sourceSystem: 'globalsite', externalInquiryId: 'fictional-ui-inquiry', site: { id: 'fictional-ui-site', name: 'Fictional Website' }, submittedAt: new Date().toISOString(), contact: { name: 'Fictional Browser Buyer', email: 'fictional-ui@example.invalid', phone: '', company: 'Fictional Buyer', country: 'Germany' }, products: [], quantity: null, message: 'Please discuss product options with our purchasing team.', attachments: [], source: { pageUrl: 'https://example.invalid/contact/', referrer: null, utm: { source: 'fixture-ui', medium: null, campaign: null, term: null, content: null }, device: 'mobile', firstVisitAt: null }, spamScore: 0 });
        assert.equal(r.status, 201);
        const host = express();
        host.use((req, res, next) => req.path.startsWith('/api/') ? f.app(req, res, next) : next());
        host.use(express.static(join(__dirname, '../../web/dist')));
        host.get('*', (_req, res) => res.sendFile(join(__dirname, '../../web/dist/index.html')));
        ui = await new Promise<Server>(resolve => { const s = host.listen(0, '127.0.0.1', () => resolve(s)); });
        const base = 'http://127.0.0.1:' + (ui.address() as any).port;
        (await import('../src/config/env')).default.corsOrigins.push(base);
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        await context.addCookies([{ name: 'cdlm_access', value: f.tokenFor(f.manager), url: base, httpOnly: true, sameSite: 'Lax' }, { name: 'cdlm_csrf', value: 'fictional-csrf', url: base, sameSite: 'Lax' }]);
        const page = await context.newPage(), errors: string[] = [];
        page.on('pageerror', () => errors.push('browser-runtime-error'));
        await page.goto(base + '/customers/' + r.body.data.customerId);
        await page.getByRole('heading', { name: 'GlobalSite 询盘记录', exact: true }).waitFor();
        await page.getByText('Please discuss product options with our purchasing team.', { exact: true }).waitFor();
        await page.getByRole('button', { name: '网站询盘提醒', exact: true }).waitFor();
        await page.getByRole('button', { name: '生成回复初稿', exact: true }).click();
        await page.getByText('回复初稿已保存，发送前请审核。', { exact: false }).waitFor();
        const output = await mkdtemp(join(tmpdir(), 'globalcrm-j1-ui-'));
        await page.locator('#globalsite-inquiries').scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, 'desktop-zh.png'), fullPage: false });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#globalsite-inquiries').scrollIntoViewIfNeeded();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: join(output, 'mobile-zh.png'), fullPage: false });
        await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
        await page.getByRole('heading', { name: 'GlobalSite inquiries', exact: true }).waitFor();
        assert.equal(errors.length, 0);
        console.log('J1 fictional UI screenshots: ' + output);
        await context.close();
    }
    finally {
        await browser?.close();
        if (ui)
            await new Promise<void>(r => ui!.close(() => r()));
        await f.cleanup();
    }
});
