import test from 'node:test';
import assert from 'node:assert/strict';
import { firstOutreachGoal, outreachStepGoal, projectPromptContext, resolveProjectSalesProfile } from '../src/services/project-profile';

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

test('三封开发信序列任务分别使用首封、跟进和结束信规则', () => {
  const profile = resolveProjectSalesProfile({ code: 'GENESIS', slug: 'genesis-bags', name: 'Genesis Bags', industry: '箱包外贸' });
  const first = outreachStepGoal(profile, 1);
  const second = outreachStepGoal(profile, 2);
  const third = outreachStepGoal(profile, 3);
  assert.match(first, /严格三段式/);
  assert.match(first, /不猜客户现状/);
  assert.match(second, /第 2 封|跟进 1/);
  assert.match(second, /Worth a look/);
  assert.match(second, /不要重新自我介绍/);
  assert.match(third, /结束信/);
  assert.match(third, /不想继续占用/);
  assert.doesNotMatch(second, /重新自我介绍。.*重新自我介绍/);
  assert.match(second, /定制包装/);
  assert.match(third, /不新增任何事实/);
  // 目标里不能出现会被知识检索误判为「客户在问商务条款」的词，否则兜底稿会拼出待确认清单。
  for (const goal of [first, second, third]) assert.doesNotMatch(goal, /MOQ|价格|交期|认证|产能/);
  const iron = resolveProjectSalesProfile({ code: 'IRONHUE', slug: 'ironhue', name: 'IRONHUE', industry: '运动器材外贸' });
  assert.doesNotMatch(outreachStepGoal(iron, 1), /包装/);
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
