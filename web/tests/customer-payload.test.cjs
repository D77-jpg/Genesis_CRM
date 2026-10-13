const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const cache = path.resolve(__dirname, '../node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const directory = fs.mkdtempSync(path.join(cache, 'customer-payload-'));
const output = path.join(directory, 'payload.cjs');
buildSync({ entryPoints: [path.resolve(__dirname, '../src/lib/customer-payload.ts')], bundle: true,
  platform: 'node', format: 'cjs', outfile: output, tsconfig: path.resolve(__dirname, '../tsconfig.json') });
const { toCustomerPayload, customerTextPatch } = require(output);
after(() => { fs.unlinkSync(output); fs.rmdirSync(directory); });

test('inline clearing sends an explicit blank field through JSON transport', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(customerTextPatch('requirementNotes', ' \n '))), { requirementNotes: '' });
  assert.deepEqual(customerTextPatch('notes', 'Updated\nNote'), { notes: 'Updated\nNote' });
});
test('edit form preserves cleared notes and email while retaining other entered fields', () => {
  const result = JSON.parse(JSON.stringify(toCustomerPayload({ name: 'Fixture', company: 'Existing Company',
    email: '', notes: '', requirementNotes: '\n ', country: '德国', status: 'pending', priority: 'medium', tagsText: 'Imported' })));
  assert.equal(result.requirementNotes, ''); assert.equal(result.notes, ''); assert.equal(result.email, '');
  assert.equal(result.company, 'Existing Company'); assert.equal(result.country, '德国');
  assert.deepEqual(result.tags, ['Imported']);
});
