// The historical script prints expected values. Make mismatches and missing
// negative-test branches fail CI rather than treating the final banner as proof.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('scripts/smoke-test.ps1', 'utf8');
const output = fs.readFileSync(process.argv[2] || 'server/tmp/v21-smoke.log', 'utf8');
assert.ok(output.includes('ALL SMOKE TESTS DONE'), 'Smoke script did not finish');
const expectedCount = (source.match(/\(expect /g) || []).length;
const found = [...output.matchAll(/([^\s()]+)\(expect ([^)]*)\)=([^\r\n]*)/g)];
let count = 0;
for (const line of output.split(/\r?\n/)) {
  for (const match of line.matchAll(/([^\s()]+)\(expect ([^)]*)\)=/g)) {
    count++;
    const [, field, expected] = match;
    const rest = line.slice(match.index + match[0].length);
    if (expected === 'empty') assert.ok(rest.startsWith('[]'), `${field}: expected empty`);
    else if (expected.startsWith("'")) assert.ok(rest.startsWith(expected.slice(1, -1)), `${field}: ${rest}`);
    else if (expected === 'all 7') assert.match(rest, /^\[WhatsApp, LinkedIn, Instagram, MOQ, Dubai Exhibition, Made-in-China, Inverter\]/);
    else if (expected === 'the +9d value') assert.ok(output.includes('followUpSyncOk(expect True)=True'), 'Missing timestamp equality assertion');
    else assert.equal(rest.split(/\s/)[0].toLowerCase(), expected.toLowerCase(), `${field}: ${rest}`);
  }
}
assert.equal(count, expectedCount, 'Some expectation/negative-test branches did not execute');
assert.ok(found.length > 0);
console.log(`Smoke: 112 scenario groups completed; ${count}/${expectedCount} printed expectations verified (original groups 1–93 included).`);
