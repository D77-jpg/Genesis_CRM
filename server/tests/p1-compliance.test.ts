import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendUnsubscribeFooter,
  createUnsubscribeToken,
  effectiveDailyLimit,
  parseUnsubscribeToken,
  unsubscribeHeaders,
} from '../src/services/mail-compliance.service';
import { hasProjectWideScope, isAdmin, isProjectManager, isReadOnly } from '../src/utils/access';
import type { AuthUser } from '../src/types/express';

function actor(role: AuthUser['role']): AuthUser {
  return { id: '507f1f77bcf86cd799439012', username: role, displayName: role, role, projectId: '507f1f77bcf86cd799439011' };
}

test('role semantics separate system, project, sales and read-only scope', () => {
  assert.equal(isAdmin(actor('admin')), true);
  assert.equal(isProjectManager(actor('project_admin')), true);
  assert.equal(isProjectManager(actor('user')), false);
  assert.equal(hasProjectWideScope(actor('viewer')), true);
  assert.equal(hasProjectWideScope(actor('user')), false);
  assert.equal(isReadOnly(actor('viewer')), true);
  assert.equal(isReadOnly(actor('admin')), false);
});

test('unsubscribe token round-trips and rejects tampering', () => {
  const projectId = '507f1f77bcf86cd799439011';
  const token = createUnsubscribeToken(projectId, 'Buyer@Example.com');
  const parsed = parseUnsubscribeToken(token);
  assert.equal(parsed?.projectId, projectId);
  assert.equal(parsed?.email, 'buyer@example.com');
  assert.equal(parseUnsubscribeToken(`${token}x`), null);

  const tampered = token.replace(/.$/, (char) => (char === 'A' ? 'B' : 'A'));
  assert.equal(parseUnsubscribeToken(tampered), null);
});

test('outbound mail gets a visible unsubscribe link and RFC 8058 headers', () => {
  const projectId = '507f1f77bcf86cd799439011';
  const output = appendUnsubscribeFooter('<p>Hello</p>', 'Hello', projectId, 'buyer@example.com');
  assert.match(output.html, /rel="unsubscribe"/);
  assert.match(output.html, /\/api\/unsubscribe\//);
  assert.match(output.text, /Unsubscribe:/);
  assert.equal(appendUnsubscribeFooter(output.html, output.text, projectId, 'buyer@example.com').html, output.html);

  const headers = unsubscribeHeaders(projectId, 'buyer@example.com');
  assert.match(headers['List-Unsubscribe'], /^<http.*\/api\/unsubscribe\/.+>$/);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('warm-up cap is the minimum of account, project and ramp limits', () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  const result = effectiveDailyLimit({
    mailCompliance: {
      warmupEnabled: true,
      warmupStartedAt: twoDaysAgo,
      warmupStartLimit: 20,
      warmupDailyIncrement: 10,
      warmupMaxLimit: 200,
      dailySendLimit: 300,
    },
  }, 100);
  assert.equal(result.limit, 40);
  assert.equal(result.warmup, true);

  const capped = effectiveDailyLimit({
    mailCompliance: {
      warmupEnabled: true,
      warmupStartedAt: new Date(Date.now() - 100 * 86_400_000),
      warmupStartLimit: 20,
      warmupDailyIncrement: 10,
      warmupMaxLimit: 50,
      dailySendLimit: 30,
    },
  }, 500);
  assert.equal(capped.limit, 30);
  assert.equal(effectiveDailyLimit(null, 70).limit, 70);
});
