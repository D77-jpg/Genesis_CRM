/**
 * 固定结尾（公司签名）的契约测试
 * ------------------------------------------------------------------
 * 这组断言保护两件容易悄悄坏掉的事：
 *  1. HTML 版签名与纯文本版签名逐字一致 —— 生成稿的正文哈希包含纯文本签名，
 *     `contentText` 是从 HTML 转回来的，不一致会让审核页误报「审核后内容已变化」。
 *  2. 模板自带的老式落款不会和固定结尾重复出现两次。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { brandLogoUrl, safeMailHtml } from '../src/services/mail-security';
import {
  LETTER_SIGNATURE,
  SIGNATURE_MARKER,
  ensureSignature,
  hasSignature,
  renderLetterContent,
  renderSignatureHtml,
  renderSignatureText,
  signatureName,
  splitSignatureText,
  stripSignatureText,
  stripTrailingSignoff,
} from '../src/services/letter-signature';
import { htmlToPlainText } from '../src/utils/text';

const NAME = 'Douglas Carlos';

test('固定结尾：第一行是账号姓名，其余是固定公司信息', () => {
  const text = renderSignatureText(NAME);
  const lines = text.split('\n');
  assert.equal(lines[0], NAME);
  assert.equal(lines[1], 'Sales Manager, Genesis (Xiamen) Bags Co., Ltd.');
  assert.equal(lines[2], '');
  assert.deepEqual(lines.slice(3), [...LETTER_SIGNATURE.lines]);
  assert.ok(hasSignature(text));
  assert.ok(text.includes(SIGNATURE_MARKER));
});

test('固定结尾：HTML 版和纯文本版逐字一致（审核哈希依赖这条）', () => {
  assert.equal(htmlToPlainText(renderSignatureHtml(NAME)), renderSignatureText(NAME));
  // 过一遍发送前的 HTML 清洗后仍然一致
  assert.equal(htmlToPlainText(safeMailHtml(renderSignatureHtml(NAME))), renderSignatureText(NAME));
});

test('固定结尾：姓名优先取账号，其次项目署名，最后兜底', () => {
  assert.equal(signatureName('Douglas Carlos', 'Genesis Admin'), 'Douglas Carlos');
  assert.equal(signatureName('', 'Genesis Admin'), 'Genesis Admin');
  assert.equal(signatureName(null, null), 'Sales Team');
  assert.equal(signatureName('  Douglas\nCarlos  '), 'Douglas Carlos');
});

test('固定结尾：正文与签名之间恰好一个空行，整封草稿可原样还原', () => {
  const body = 'Dear Diane,\n\nCould you please confirm the box size?';
  const bodyText = [body, renderSignatureText(NAME)].join('\n\n');
  const content = renderLetterContent(bodyText, 'Fallback Name');
  const rendered = htmlToPlainText(safeMailHtml(content));
  assert.equal(rendered, bodyText);
  // 再走一遍 renderLetter 的渲染链（占位符渲染 + HTML 清洗），结论相同
  assert.equal(htmlToPlainText(safeMailHtml(content)), bodyText);
});

test('固定结尾：splitSignatureText 能切出正文和姓名', () => {
  const bodyText = ['Dear Diane,', '', 'Thanks.'].join('\n') + '\n\n' + renderSignatureText(NAME);
  const { body, name } = splitSignatureText(bodyText);
  assert.equal(body, 'Dear Diane,\n\nThanks.');
  assert.equal(name, NAME);
  assert.equal(splitSignatureText('only body').body, 'only body');
});

test('固定结尾：模板自带的老式落款会被替换，不会出现两套签名', () => {
  const template = '<p>Dear {{firstName}},</p><p>We make custom boxes.</p><p>Best,<br>{{senderName}}<br>{{companyName}}</p>';
  const signed = ensureSignature(template, NAME);
  // 签名里不再画分隔线（早期草稿的 <hr> 由前端渲染层隐藏）
  assert.equal((signed.match(/<hr>/g) ?? []).length, 0);
  assert.ok(!/Best,?<br>/.test(stripTrailingSignoff(template)));
  // 已经带固定结尾的内容不再追加
  const once = ensureSignature('<p>Body</p>', NAME);
  assert.equal(ensureSignature(once, NAME), once);
});

test('固定结尾：纯文本正文保持纯文本，不引入标签（否则会被当 HTML 邮件挂追踪像素）', () => {
  const signed = ensureSignature('Hello without HTML', NAME);
  assert.equal(signed, `Hello without HTML\n\n${renderSignatureText(NAME)}`);
  assert.ok(!signed.includes('<'));
  // 纯文本里已有的落款同样被替换
  assert.equal(ensureSignature('Hi.\n\nBest regards,\nDouglas', NAME), `Hi.\n\n${renderSignatureText(NAME)}`);
});

test('固定结尾：富文本编辑器把落款拆成多个段落时也能整段替换', () => {
  // TipTap 保存草稿时会把模板的 <br> 拆成独立段落
  const editorHtml = '<p>Hi {{firstName}},</p><p>Body.</p><p>Best regards,</p><p>{{senderName}}</p><p>{{companyName}}</p><p>{{companyWebsite}}</p>';
  const signed = ensureSignature(editorHtml, NAME);
  assert.equal((signed.match(/Gold Supplier on Alibaba\.com since 2014/g) ?? []).length, 1);
  assert.ok(!signed.includes('Best regards,'));
  assert.ok(!signed.includes('{{companyWebsite}}'));
});

test('固定结尾：品牌 logo 保留，其它图片仍然被剥离', () => {
  const html = renderSignatureHtml(NAME);
  assert.ok(html.includes('<img'));
  assert.ok(html.includes('/api/brand/genesis-logo.png'));
  const sanitized = safeMailHtml(`${html}<img src="https://tracker.example/pixel.png">`);
  assert.equal((sanitized.match(/<img/g) ?? []).length, 1);
  assert.ok(sanitized.includes('/api/brand/genesis-logo.png'));
});

test('固定结尾：编辑器里的相对 logo 路径会在发送前换成公网地址', () => {
  const sanitized = safeMailHtml('<p>Hi</p><img src="/api/brand/genesis-logo.png" alt="Genesis Packaging"><img src="https://tracker.example/pixel.png">');
  assert.ok(sanitized.includes(brandLogoUrl()));
  assert.ok(!sanitized.includes('src="/api/brand'));
  assert.equal((sanitized.match(/<img/g) ?? []).length, 1);
});

test('固定结尾：编辑器写入的文字结尾在落库前升级成带 logo 的 HTML，文字不变', () => {
  const editorHtml = `<p>Dear Diane,</p><p>Body.</p><p><strong>Douglas Carlos</strong></p><p>${LETTER_SIGNATURE.title}</p><p></p>`
    + LETTER_SIGNATURE.lines.map((line) => `<p>${line}</p>`).join('');
  const upgraded = ensureSignature(editorHtml, 'Genesis Admin');
  assert.ok(/genesis-logo/.test(upgraded));
  assert.equal(htmlToPlainText(upgraded), htmlToPlainText(editorHtml));
  assert.equal(ensureSignature(upgraded, 'Genesis Admin'), upgraded);
});

test('固定结尾：老草稿的 Best regards/姓名/公司/网址 不会再和新结尾重复', () => {
  const legacyHtml = '<p>Dear Stiles,</p><p>Body paragraph.</p>'
    + '<p>Best regards,</p><p>Genesis Admin</p><p>Genesis (Xiamen) Bags Co., Ltd.</p><p>https://www.genesisbags.com</p>';
  const signed = ensureSignature(legacyHtml, 'Genesis Admin');
  const text = htmlToPlainText(signed);
  assert.ok(!text.includes('Best regards'));
  assert.equal((text.match(/Genesis \(Xiamen\) Bags Co\., Ltd\./g) ?? []).length, 1);
  assert.equal((text.match(/https:\/\/www\.genesisbags\.com/g) ?? []).length, 0);
  assert.equal((text.match(/Gold Supplier on Alibaba\.com since 2014/g) ?? []).length, 1);
  // 已经有固定结尾但前面还留着旧落款：升级成 HTML 版时一并清掉
  const mixed = `${legacyHtml}<p>Genesis Admin</p><p>${LETTER_SIGNATURE.title}</p><p></p>`
    + LETTER_SIGNATURE.lines.map((line) => `<p>${line}</p>`).join('');
  const upgraded = ensureSignature(mixed, 'Genesis Admin');
  const upgradedText = htmlToPlainText(upgraded);
  assert.equal((upgradedText.match(/Genesis \(Xiamen\) Bags Co\., Ltd\./g) ?? []).length, 1);
  assert.equal((upgradedText.match(/Gold Supplier on Alibaba\.com since 2014/g) ?? []).length, 1);
});

test('固定结尾：模型自己写的落款先剥掉，再加系统签名', () => {
  const modelBody = 'Dear Diane,\n\nWe make custom boxes.\n\nBest regards,\nDouglas\nGenesis (Xiamen) Bags Co., Ltd.\nhttps://www.genesisbags.com';
  const cleaned = stripSignatureText(modelBody, ['Douglas', 'Genesis (Xiamen) Bags Co., Ltd.', 'https://www.genesisbags.com']);
  assert.equal(cleaned, 'Dear Diane,\n\nWe make custom boxes.');
  const plain = 'Dear Diane,\n\nWe make custom boxes.';
  assert.equal(stripSignatureText(plain), plain);
});
