/**
 * Excel 导入线索的契约测试
 * ------------------------------------------------------------------
 *  1. 线索唯一键：官网优先，其次邮箱域名，免费邮箱退化成公司名 slug；
 *  2. 等级/优先级折算成分数，线索池才能按分数排序；
 *  3. 转客户时 Excel 线索的备注不能套「搜索摘要 / 官网简介」的说法，
 *     等级、优先级、业务来源、备注都要带过去。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { domainKeyOf, scoreOf } from '../src/services/prospecting/import-prospects';
import { prospectCustomerInput } from '../src/services/prospecting/prospect-customer';
import type { ImportRow } from '../src/validators/customer.validator';

function row(patch: Partial<ImportRow> = {}): ImportRow {
  return { name: 'Ella Drake', __row: 2, ...patch } as ImportRow;
}

test('线索唯一键优先取官网域名', () => {
  assert.equal(domainKeyOf(row({ website: 'https://www.MonarcJewellery.com/pages/x' })), 'monarcjewellery.com');
  assert.equal(domainKeyOf(row({ website: 'monarcjewellery.com' })), 'monarcjewellery.com');
});

test('没有官网时用邮箱域名，免费邮箱退化成公司名', () => {
  assert.equal(domainKeyOf(row({ email: 'hello@apothaka.com' })), 'apothaka.com');
  // gmail 不能当公司网站，改用公司名 slug
  assert.equal(domainKeyOf(row({ email: 'someone@gmail.com', company: 'Melinda Maria' })), 'melinda-maria');
  // 什么都没有就是空串，调用方会跳过这一行
  assert.equal(domainKeyOf(row({ name: '' })), '');
});

test('等级与优先级折算成分数', () => {
  assert.equal(scoreOf(row({ grade: 'A', priority: 'high' })), 95);
  assert.equal(scoreOf(row({ grade: 'A' })), 85);
  assert.equal(scoreOf(row({ grade: 'B', priority: 'low' })), 60);
  assert.equal(scoreOf(row({ grade: 'C' })), 50);
  assert.equal(scoreOf(row({})), 60);
});

test('Excel 线索转客户：备注按导入口径写，等级/优先级/来源都带过去', () => {
  const customer = prospectCustomerInput({
    domain: 'annilu.dk',
    website: 'https://annilu.dk',
    sourceUrl: 'https://annilu.dk',
    source: 'excel',
    name: 'Helle Vestergaard Poulsen',
    company: 'Anni Lu',
    contactName: 'Helle Vestergaard Poulsen',
    contactTitle: 'Founder',
    emails: ['mtp@annilu.dk'],
    score: 95,
    country: '丹麦',
    industry: 'Jewellery',
    grade: 'A',
    priority: 'high',
    notes: '原始分级：A；匹配度：88',
    leadSource: 'Website',
  });

  assert.equal(customer.name, 'Helle Vestergaard Poulsen');
  assert.equal(customer.company, 'Anni Lu');
  assert.equal(customer.grade, 'A');
  assert.equal(customer.priority, 'high');
  assert.equal(customer.leadSource, 'Website');
  assert.deepEqual(customer.tags, ['Excel 导入']);

  assert.match(customer.notes ?? '', /^Excel 导入线索 · 评分 95\/100 · 等级 A · 优先级 高/);
  assert.match(customer.notes ?? '', /业务来源：Website/);
  assert.match(customer.notes ?? '', /备注：原始分级：A；匹配度：88/);
  // 不能把导入数据说成抓取结果
  assert.ok(!(customer.notes ?? '').includes('搜索摘要'));
  assert.ok(!(customer.notes ?? '').includes('官网简介'));
  assert.ok(!(customer.notes ?? '').includes('搜索来源'));
});

test('搜索来的线索保持原有备注口径（回归保护）', () => {
  const customer = prospectCustomerInput({
    domain: 'buyer.test',
    website: 'https://buyer.test/',
    sourceUrl: 'https://buyer.test/directory',
    source: 'serper',
    company: 'Fictional Buyer Ltd',
    contactName: 'Jane Buyer',
    emails: ['jane@buyer.test'],
    score: 78,
    snippet: 'Fictional Buyer makes widgets',
  });

  assert.match(customer.notes ?? '', /今日开发候选 · 评分 78\/100/);
  assert.match(customer.notes ?? '', /搜索来源：https:\/\/buyer\.test\/directory/);
  assert.deepEqual(customer.tags, ['自动开发']);
  assert.equal(customer.leadSource, '今日开发');
});
