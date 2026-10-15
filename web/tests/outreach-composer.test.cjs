const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const cache = path.resolve(__dirname, '../node_modules/.cache'); fs.mkdirSync(cache, { recursive: true });
const directory = fs.mkdtempSync(path.join(cache, 'outreach-composer-')); const output = path.join(directory, 'composer.cjs');
buildSync({ entryPoints: [path.resolve(__dirname, '../src/lib/outreach-composer.ts')], bundle: true, platform: 'node',
  format: 'cjs', outfile: output, tsconfig: path.resolve(__dirname, '../tsconfig.json') });
const { outreachComposerDraft } = require(output);
after(() => { fs.unlinkSync(output); fs.rmdirSync(directory); });
test('the composer preserves the authoritative subject/body and keeps AI markup inert', () => {
  const draft = outreachComposerDraft({ id: 'analysis', customerId: 'customer', firstOutreach: true,
    emailDraft: { subject: 'First outreach', bodyText: 'Hello\n<script>send()</script>' } }, 'customer');
  assert.equal(draft.analysisId, 'analysis'); assert.equal(draft.subject, 'First outreach');
  assert.match(draft.content, /Hello<br>/); assert.ok(!draft.content.includes('<script>')); assert.match(draft.content, /&lt;script&gt;/);
});
test('the composer rejects a different customer or an ordinary analysis', () => {
  const analysis = { id: 'analysis', customerId: 'customer', firstOutreach: true, emailDraft: { subject: 'S', bodyText: 'B' } };
  assert.throws(() => outreachComposerDraft(analysis, 'different'));
  assert.throws(() => outreachComposerDraft({ ...analysis, firstOutreach: false }, 'customer'));
});

test('email paragraph breaks stay compact instead of expanding repeated editor line breaks', () => {
  const draft = outreachComposerDraft({ id: 'a', customerId: 'c', firstOutreach: true, emailDraft: {subject: 'S', bodyText: 'Hello\n\n\nIntro\nLine\n\nRegards'} }, 'c');
  assert.equal(draft.content, '<p>Hello</p><p>Intro<br>Line</p><p>Regards</p>');
});
