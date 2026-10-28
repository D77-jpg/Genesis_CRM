import test from 'node:test';
import assert from 'node:assert/strict';
import { firstOutreachGoal, projectPromptContext, resolveProjectSalesProfile } from '../src/services/project-profile';

test('IronHue 首封任务使用健身器材画像，不继承 Genesis 包装话术', () => {
  const profile = resolveProjectSalesProfile({ code: 'IRONHUE', slug: 'ironhue', name: 'IRONHUE', industry: '运动器材外贸' });
  assert.equal(profile.key, 'ironhue');
  const goal = firstOutreachGoal(profile);
  assert.match(goal, /哑铃|自由重量|力量训练/);
  assert.doesNotMatch(goal, /包装|Genesis/);
  assert.equal(profile.signature.title.includes('Genesis'), false);
  assert.equal(profile.signature.lines.some((line) => /genesisbags/i.test(line)), false);
  assert.equal(profile.signature.logoPath, '/api/brand/ironhue-logo.png');
  assert.deepEqual(profile.signature.lines, [
    'Free Weight & Strength Training Equipment',
    'Wholesale · OEM · ODM · Private Label',
    'E: sales@ironhue.com',
    'T / WhatsApp: +86 138 6042 3022',
    'W: ironhue.com',
  ]);
});

test('Genesis 项目仍保留包装画像和签名', () => {
  const profile = resolveProjectSalesProfile({ code: 'GENESIS', slug: 'genesis-bags', name: 'Genesis Bags', industry: '箱包外贸' });
  assert.equal(profile.key, 'genesis');
  assert.match(firstOutreachGoal(profile), /定制包装/);
  assert.match(profile.signature.lines.join('\n'), /Genesis Bags/);
});

test('未来未知项目使用通用画像，不串用 Genesis/IronHue', () => {
  const profile = resolveProjectSalesProfile({ code: 'NEWPROJ', name: '新项目', companyName: 'New Project Co., Ltd.', industry: '工业设备' });
  assert.equal(profile.key, 'general');
  const goal = firstOutreachGoal(profile);
  assert.match(goal, /工业设备/);
  assert.doesNotMatch(goal, /Genesis|IRONHUE|定制包装（礼盒|哑铃/);
  assert.equal(projectPromptContext(profile).offerSummary.includes('工业设备'), true);
  assert.equal('signature' in projectPromptContext(profile), false);
});
