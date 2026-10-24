/**
 * 公司名清洗的契约测试
 * ------------------------------------------------------------------
 * 用真实抓到的网页标题做样本：清洗后只留品牌段，认不出来的绝不乱改。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanCompanyName, needsManualReview } from '../src/utils/company-name';

test('网页标题形状的公司名只留品牌段', () => {
  const cases: [string, string][] = [
    ['Colonial Candle: Dinner Candles, Scented Candles, Wax …', 'Colonial Candle'],
    ['Voluspa® | Handcrafted Scented Candles, Oil Diffusers & More', 'Voluspa®'],
    ['Brooklyn Candle Studio | Luxury Candles & Home Fragrances', 'Brooklyn Candle Studio'],
    ['Cute Candles | Best Luxury Gift Candles & Home Fragrance', 'Cute Candles'],
    ['FoundRae: Gold Medallions, Chains, Necklaces & Fine Jewelry', 'FoundRae'],
    ['Sofia Jewelry: Premier Online Jewelry Store in USA | Custom ...', 'Sofia Jewelry'],
    ['Scentsational – The world\'s best cotton wicked scented ...', 'Scentsational'],
    ['Beeswax & Custom Candles For Sale | GreenTree Home ...', 'GreenTree Home'],
    ['Handmade Unique Jewelry 2026 | Recommended Gifts', 'Handmade Unique Jewelry 2026'],
    ['CandleStore.com (Made in USA Scented Candles) Pocono ...', 'CandleStore.com'],
    ['Top Jewelry Manufacturers In USA For Custom & Small ...', 'Top Jewelry Manufacturers In USA For Custom & Small'],
  ];
  cases.forEach(([input, expected]) => {
    assert.equal(cleanCompanyName(input), expected, `清洗不符预期：${input}`);
  });
});

test('本来就是正常公司名的原样返回', () => {
  ['Jessica McCormack', 'JENNY BIRD', 'Catbird NYC', 'Melinda Maria', 'Home Grown', 'Julio Designs'].forEach((name) => {
    assert.equal(cleanCompanyName(name), name);
  });
});

test('空值与空白安全返回', () => {
  assert.equal(cleanCompanyName(''), '');
  assert.equal(cleanCompanyName('   '), '');
  assert.equal(cleanCompanyName(null), '');
  assert.equal(cleanCompanyName(undefined), '');
});

test('收得太狠或仍是长句时提示人工核对', () => {
  assert.equal(needsManualReview('Candles, Home Fragrance & Car Air Fresheners | Yankee ...'), true);
  assert.equal(needsManualReview('Top Jewelry Manufacturers In USA For Custom & Small ...'), true);
  assert.equal(needsManualReview('Colonial Candle: Dinner Candles, Scented Candles, Wax ...'), false);
  assert.equal(needsManualReview('Jessica McCormack'), false);
});

test('清洗是幂等的：清洗过的结果再洗一次不变', () => {
  ['Colonial Candle: Dinner Candles, Wax …', 'Beeswax & Custom Candles For Sale | GreenTree Home ...'].forEach((input) => {
    const once = cleanCompanyName(input);
    assert.equal(cleanCompanyName(once), once);
  });
});
