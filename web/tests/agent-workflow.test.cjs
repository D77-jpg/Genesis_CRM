const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const cache = path.resolve(__dirname, '../node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const temporaryDirectory = fs.mkdtempSync(path.join(cache, 'agent-workflow-'));
const compiledPath = path.join(temporaryDirectory, 'workflow.cjs');
const build = buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/agent-workflow.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
fs.writeFileSync(compiledPath, build.outputFiles[0].contents);
const { taskCounts, visibleTasks } = require(compiledPath);
after(() => { fs.unlinkSync(compiledPath); fs.rmdirSync(temporaryDirectory); });

const task = (id, status) => ({ id, status });

test('sent and cancelled work never inflates the pending badge', () => {
  const tasks = [task('sent', 'completed'), task('cancelled', 'cancelled'), task('ready', 'awaiting_review')];
  const counts = taskCounts(tasks);
  assert.equal(counts.review + counts.attention, 1);
  assert.deepEqual(visibleTasks(tasks, 'pending').map(row => row.id), ['ready']);
});

test('paused, failed and missing information remain visible as work needing attention', () => {
  const tasks = [task('paused', 'paused'), task('failed', 'failed'), task('missing', 'waiting_input'), task('working', 'running')];
  assert.deepEqual(visibleTasks(tasks, 'attention').map(row => row.id), ['paused', 'failed', 'missing']);
  assert.equal(taskCounts(tasks).active, 1);
});

test('ready drafts appear before background work without mutating server order', () => {
  const tasks = [task('queued', 'queued'), task('failed', 'failed'), task('draft', 'awaiting_review'), task('running', 'running')];
  assert.deepEqual(visibleTasks(tasks, 'pending').map(row => row.id), ['draft', 'failed', 'queued', 'running']);
  assert.deepEqual(tasks.map(row => row.id), ['queued', 'failed', 'draft', 'running']);
});

test('opening an older task from a reminder reveals it even outside the active filter', () => {
  const tasks = [task('draft', 'awaiting_review'), task('older', 'completed'), task('run', 'running')];
  assert.deepEqual(visibleTasks(tasks, 'review', 'older').map(row => row.id), ['older', 'draft']);
  assert.deepEqual(visibleTasks(tasks, 'review').map(row => row.id), ['draft']);
});

test('empty and history-only feeds do not invent drafts or active work', () => {
  assert.deepEqual(taskCounts([]), { review: 0, active: 0, attention: 0, history: 0 });
  assert.deepEqual(visibleTasks([task('old', 'completed')], 'pending'), []);
  assert.deepEqual(visibleTasks([task('old', 'completed')], 'history').map(row => row.id), ['old']);
});
