/**
 * Excel 导入的核验契约测试
 * ------------------------------------------------------------------
 * 这组断言保护三件事：
 *  1. 能入库但会变脏的数据（多国、多行业、无邮箱、姓名=公司）必须被体检出来；
 *  2. 国家在写库前一定归一（多国取第一个认得，带城市补充能认出来）；
 *  3. 认不出来的写法原样保留，不吞用户数据。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPatchFromRow, collectWarnings } from '../src/services/customer.service';
import type { ImportRow } from '../src/validators/customer.validator';

function row(patch: Partial<ImportRow> = {}): ImportRow {
  return { name: 'Ella Drake', __row: 2, ...patch } as ImportRow;
}

test('多国写法会提示，并按第一个国家入库', () => {
  const warnings = collectWarnings(row({ country: 'United Kingdom / New Zealand' }), 0);
  const mixed = warnings.find((warning) => warning.reason.includes('国家写了几个'));
  assert.ok(mixed, '应提示国家写了多个');
  assert.equal(mixed?.level, 'warn');
  assert.match(mixed!.reason, /英国/);

  const patch = buildPatchFromRow(row({ country: 'United Kingdom / New Zealand' }), 'pending');
  assert.equal(patch.country, '英国');
});

test('带城市补充的国家能认出来，且只作为 info 提示', () => {
  const warnings = collectWarnings(row({ country: 'Ireland (Dublin)' }), 0);
  const normalized = warnings.find((warning) => warning.reason.includes('已归一'));
  assert.equal(normalized?.level, 'info');
  assert.match(normalized!.reason, /爱尔兰/);

  assert.equal(buildPatchFromRow(row({ country: 'Ireland (Dublin)' }), 'pending').country, '爱尔兰');
  assert.equal(buildPatchFromRow(row({ country: 'Saudi Arabia (Jeddah)' }), 'pending').country, '沙特阿拉伯');
});

test('认不出来的国家原样保留并提示', () => {
  const warnings = collectWarnings(row({ country: 'Atlantis' }), 0);
  const unknown = warnings.find((warning) => warning.reason.includes('不在词库'));
  assert.equal(unknown?.level, 'warn');
  assert.equal(buildPatchFromRow(row({ country: 'Atlantis' }), 'pending').country, 'Atlantis');
});

test('多行业写法会提示，但不擅自改名', () => {
  const warnings = collectWarnings(row({ industry: 'Candles / Skincare / Fragrance' }), 0);
  const industry = warnings.find((warning) => warning.reason.includes('行业写了'));
  assert.equal(industry?.level, 'warn');
  assert.match(industry!.reason, /3 个/);
  // 行业保持原样，留给业务员决定怎么统一
  assert.equal(buildPatchFromRow(row({ industry: 'Candles / Skincare / Fragrance' }), 'pending').industry, 'Candles / Skincare / Fragrance');
});

test('没有邮箱会提示发不了开发信', () => {
  const warnings = collectWarnings(row({ email: '' }), 0);
  assert.ok(warnings.some((warning) => warning.level === 'warn' && warning.reason.includes('没有邮箱')));
  // 有邮箱就不该出现这条
  assert.ok(!collectWarnings(row({ email: 'a@b.com' }), 0).some((warning) => warning.reason.includes('没有邮箱')));
});

test('姓名=公司且没有职位 → 提示可能没抓到联系人；有职位则不算', () => {
  const bare = collectWarnings(row({ name: 'Millie Savage', company: 'Millie Savage' }), 0);
  assert.ok(bare.some((warning) => warning.reason.includes('没抓到联系人')));

  const withTitle = collectWarnings(row({ name: 'Millie Savage', company: 'Millie Savage', title: 'Founder' }), 0);
  assert.ok(!withTitle.some((warning) => warning.reason.includes('没抓到联系人')));
});

test('干净的行不产生需要处理的提醒', () => {
  const english = collectWarnings(
    row({
      name: 'Ella Drake',
      company: 'Monarc Jewellery',
      email: 'ella@monarcjewellery.com',
      country: 'United Kingdom',
      industry: 'Jewellery',
    }),
    0,
  );
  // 英文国名只留一条 info（告知「已归一为 英国」），不该有任何 warn
  assert.equal(
    english.filter((warning) => warning.level === 'warn').length,
    0,
    `不该有需要处理的提醒：${JSON.stringify(english)}`,
  );
  assert.ok(english.length <= 1, `多余的提醒：${JSON.stringify(english)}`);

  // 已经是中文简称时，一条提醒都不该有
  const chinese = collectWarnings(
    row({
      name: 'Ella Drake',
      company: 'Monarc Jewellery',
      email: 'ella@monarcjewellery.com',
      country: '英国',
      industry: 'Jewellery',
    }),
    0,
  );
  assert.equal(chinese.length, 0, `不该有提醒：${JSON.stringify(chinese)}`);
});

test('行号用于回指 Excel，不会被丢掉', () => {
  const warnings = collectWarnings(row({ __row: 42, email: '' }), 0);
  assert.equal(warnings[0]?.row, 42);
});
