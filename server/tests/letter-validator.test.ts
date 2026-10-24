/**
 * 开发信发送校验器：可选关联 ID 的容错边界。
 *
 * 背景：邮件中心「跟进提醒」生成第 N 封草稿时，前端的 seed 里 analysisId 是空串，
 * 直接把空串发给后端会命中 objectIdSchema → 422「数据校验未通过 / 无效的 ID 格式」，
 * 业务员看到的就是发送失败。这里把「空串 / null = 没传」固化下来，
 * 同时确认真正的非法值依然要拦。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendLetterSchema } from '../src/validators/letter.validator';
import { optionalObjectIdSchema } from '../src/validators/common';

const PROJECT_ID = '6aa2360776ab59e92117bb18';
const base = {
  subject: 'Re: A brief introduction',
  content: '<p>Dear Dave,</p><p>Following up on my email.</p>',
  recipientEmail: 'dave@example.com',
  markAsDeveloped: false,
};

test('跟进草稿没有分析 ID 时传空串：不报错且收敛为 undefined', () => {
  const parsed = sendLetterSchema.safeParse({ ...base, customerId: PROJECT_ID, agentAnalysisId: '' });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.agentAnalysisId, undefined);
    assert.equal(parsed.data.customerId, PROJECT_ID);
  }
});

test('其余可选 ID（templateId / replyToId / agentTaskId）传空串同样放行', () => {
  const parsed = sendLetterSchema.safeParse({
    ...base,
    templateId: '',
    replyToId: '',
    agentTaskId: '',
    customerId: '',
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.templateId, undefined);
    assert.equal(parsed.data.replyToId, undefined);
    assert.equal(parsed.data.agentTaskId, undefined);
    assert.equal(parsed.data.customerId, undefined);
  }
});

test('null 也按未传处理', () => {
  const parsed = optionalObjectIdSchema.safeParse(null);
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data, undefined);
});

test('非法 ID 仍然报错，且提示中文', () => {
  const parsed = sendLetterSchema.safeParse({ ...base, agentAnalysisId: 'not-an-id' });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(JSON.stringify(parsed.error.issues), /无效的 ID 格式/);
  }
});
