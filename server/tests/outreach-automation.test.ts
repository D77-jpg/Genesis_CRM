import assert from 'node:assert/strict';
import test from 'node:test';
import { dayIn, isWithinSendWindow, localClock, nextSendWindow } from '../src/services/outreach-automation.service';

const window = { windowStart: '09:30', windowEnd: '17:30', timezone: 'Asia/Shanghai' };

test('automatic outreach only runs on local weekdays inside the send window', () => {
  // Monday 10:00 in Shanghai.
  assert.equal(isWithinSendWindow(window, new Date('2026-11-02T02:00:00.000Z')), true);
  // Monday 09:00, before the window.
  assert.equal(isWithinSendWindow(window, new Date('2026-11-02T01:00:00.000Z')), false);
  // Monday 17:45, after the window.
  assert.equal(isWithinSendWindow(window, new Date('2026-11-02T09:45:00.000Z')), false);
  // Sunday 10:00, weekend.
  assert.equal(isWithinSendWindow(window, new Date('2026-11-01T02:00:00.000Z')), false);
});

test('automatic outreach computes the local calendar day and clock', () => {
  const now = new Date('2026-11-02T02:00:00.000Z');
  assert.equal(dayIn('Asia/Shanghai', now), '2026-11-02');
  assert.deepEqual(localClock('Asia/Shanghai', now), { minutes: 600, weekday: 1 });
  assert.equal(dayIn('America/New_York', now), '2026-11-01');
});

test('weekend and after-hours work rolls forward to the next weekday window', () => {
  // Sunday 17:46 in Shanghai -> Monday 09:30.
  assert.equal(
    nextSendWindow(window, new Date('2026-11-01T09:46:00.000Z')).toISOString(),
    '2026-11-02T01:30:00.000Z',
  );
  // Sunday follow-up due at 15:25 -> Monday 09:30.
  assert.equal(
    nextSendWindow(window, new Date('2026-11-08T07:25:00.000Z')).toISOString(),
    '2026-11-09T01:30:00.000Z',
  );
});
