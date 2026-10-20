import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead } from '../src/services/prospecting/scoring';
import { dedupeLeads, domainOf, type RawLead } from '../src/services/prospecting/lead-source';
import { dueNow } from '../src/services/prospecting/scheduler';
import { mapHunterResponse } from '../src/services/prospecting/hunter';
import { mergeScores, parseLlmScores } from '../src/services/prospecting/llm-scoring';
import { bounceRisk } from '../src/services/prospecting/prospecting.service';
import { pickProfileText } from '../src/services/prospecting/profile';

test('directory, marketplace and association domains are rejected', () => {
  assert.equal(scoreLead({ domain: 'wholesale-jewelry.com', name: 'Wholesale jewelry', emails: ['a@b.com'] }).status, 'rejected');
  assert.equal(scoreLead({ domain: 'jewelry-directory.net', name: 'Jewelry Directory', emails: ['a@b.com'] }).status, 'rejected');
  assert.equal(scoreLead({ domain: 'gemsociety.org', name: 'Gem Society' }).status, 'rejected');
});

test('a brand with an email and story signals becomes ready', () => {
  const result = scoreLead({
    domain: 'brand.example', name: 'Example Jewelry',
    emails: ['hello@brand.example'], instagram: 'examplejewelry',
    excerpt: 'Our story: handmade jewelry designed in New York, made in USA in small batches. Shop the collection.',
  });
  assert.equal(result.status, 'ready');
  assert.ok(result.score >= 60);
  assert.ok(result.reasons.some((reason) => reason.includes('邮箱')));
});

test('social-only and contactless leads need a contact before approval', () => {
  assert.equal(scoreLead({ domain: 'ig-only.example', name: 'IG Jewelry', instagram: 'igonly', excerpt: 'Our story, jewelry collection.' }).status, 'needs_contact');
  assert.equal(scoreLead({ domain: 'silent.example', name: 'Silent Jewelry' }).status, 'needs_contact');
});

test('an email without category or brand signals stays below the threshold', () => {
  const result = scoreLead({ domain: 'plain.example', name: 'Plain Co', emails: ['hi@plain.example'] }, 60);
  assert.equal(result.status, 'low');
  assert.ok(result.score < 60);
});

test('dedupe keeps the first lead per domain and normalizes www', () => {
  const leads: RawLead[] = [
    { domain: 'a.example', website: 'https://a.example/', sourceUrl: 'https://a.example/1' },
    { domain: 'a.example', website: 'https://a.example/', sourceUrl: 'https://a.example/2' },
    { domain: 'b.example', website: 'https://b.example/', sourceUrl: 'https://b.example/' },
  ];
  assert.equal(dedupeLeads(leads).length, 2);
  assert.equal(dedupeLeads(leads)[0].sourceUrl, 'https://a.example/1');
  assert.equal(domainOf('https://www.Example.com/path'), 'example.com');
});

test('scheduler fires in the runAt window and catches up after a restart', () => {
  const at = (iso: string) => new Date(iso);
  // Asia/Shanghai is UTC+8: 22:35Z = 06:35 local, inside the 06:30 window.
  assert.equal(dueNow(at('2026-10-20T22:35:00Z'), '06:30', 'Asia/Shanghai'), true);
  assert.equal(dueNow(at('2026-10-20T21:00:00Z'), '06:30', 'Asia/Shanghai'), false);
  // 08:00 local is still inside the 180-minute catch-up window.
  assert.equal(dueNow(at('2026-10-21T00:00:00Z'), '06:30', 'Asia/Shanghai'), true);
  // 10:30 local is outside it.
  assert.equal(dueNow(at('2026-10-21T02:30:00Z'), '06:30', 'Asia/Shanghai'), false);
});

test('hunter response prefers a named decision maker and keeps confidence', () => {
  const result = mapHunterResponse({
    data: {
      domain: 'brand.example',
      emails: [
        { value: 'INFO@brand.example', type: 'generic', confidence: 90 },
        { value: 'jane@brand.example', type: 'personal', confidence: 97, first_name: 'Jane', last_name: 'Doe', position: 'Founder' },
      ],
    },
  });
  assert.equal(result.contactName, 'Jane Doe');
  assert.equal(result.contactTitle, 'Founder');
  assert.equal(result.emails[0].value, 'jane@brand.example');
  assert.equal(result.emails[0].confidence, 97);
});

test('a Hunter email makes a brand sendable and explains the source', () => {
  const result = scoreLead({
    domain: 'brand.example', name: 'Brand Jewelry', emails: ['jane@brand.example'],
    emailSource: 'hunter', emailConfidence: 97,
    excerpt: 'Our story: handmade jewelry designed in New York, made in USA in small batches.',
  });
  assert.equal(result.status, 'ready');
  assert.ok(result.reasons.some((reason) => reason.includes('Hunter')));
});

test('the profile rubric prefers a 客户画像 entry and falls back when absent', () => {
  const entries = [
    { title: '公司资料', content: 'Genesis 是一家箱包工厂。' },
    { title: '05-客户画像', content: '目标客户是独立珠宝与香薰品牌。' },
  ];
  assert.equal(pickProfileText(entries), '目标客户是独立珠宝与香薰品牌。');
  assert.equal(pickProfileText([{ title: '公司资料', content: '详见《客户画像》附件。' }]), '详见《客户画像》附件。');
  assert.equal(pickProfileText([{ title: '公司资料', content: '公司简介' }]), null);
});

test('bounce guard trips on five bounces or above 8% of at least ten sends', () => {
  assert.equal(bounceRisk(0, 0).risky, false);
  assert.equal(bounceRisk(20, 2).risky, true);      // 10%
  assert.equal(bounceRisk(9, 5).risky, true);       // absolute threshold
  assert.equal(bounceRisk(100, 7).risky, true);     // five bounces is still a signal
  assert.equal(bounceRisk(100, 3).risky, false);    // 3%
});

test('LLM scores are parsed from plain or fenced JSON and unknown domains are dropped', () => {
  const text = '```json\n{"items":[{"domain":"a.example","score":88,"reasons":["独立珠宝品牌"],"exclude":false,"excludeReason":""},{"domain":"other.example","score":70,"reasons":[],"exclude":false,"excludeReason":""}]}\n```';
  const scores = parseLlmScores(text, ['a.example']);
  assert.equal(scores.size, 1);
  assert.equal(scores.get('a.example')?.score, 88);
});

test('LLM merge rejects bad fits, keeps needs_contact, and weights AI 60/40', () => {
  const rule = scoreLead({ domain: 'brand.example', name: 'Brand Jewelry', emails: ['hi@brand.example'], excerpt: 'handmade jewelry' });
  const excluded = mergeScores(rule, { domain: 'brand.example', score: 90, reasons: ['像是零售商'], exclude: true, excludeReason: '零售商/批发商' }, 60);
  assert.equal(excluded.status, 'rejected');

  const needs = scoreLead({ domain: 'no-mail.example', name: 'Brand Jewelry', instagram: 'brand', excerpt: 'handmade jewelry' });
  const merged = mergeScores(needs, { domain: 'no-mail.example', score: 95, reasons: ['匹配'], exclude: false }, 60);
  assert.equal(merged.status, 'needs_contact');

  const mixed = mergeScores(rule, { domain: 'brand.example', score: 90, reasons: ['匹配'], exclude: false }, 60);
  assert.equal(mixed.score, Math.round(rule.score * 0.4 + 90 * 0.6));
  assert.ok(mixed.reasons[0].includes('AI'));
});
