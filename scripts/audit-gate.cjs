'use strict';
// Fail for every high/critical production advisory except the reviewed xlsx
// exception (GHSA-4r6h-8v6p-xvw6 and GHSA-5pgg-2g8v-p4x9); expires 2026-10-26.
const { spawnSync } = require('node:child_process');
const prefix = process.argv[2];
const exception = process.argv[3];
if (!['server', 'web'].includes(prefix) || exception !== 'xlsx') process.exit(2);
if (new Date() >= new Date('2026-10-27T00:00:00Z')) {
  console.error('xlsx audit exception expired; remove xlsx or renew reviewed exception');
  process.exit(1);
}
const result = spawnSync('npm', ['audit', '--prefix', prefix, '--omit=dev', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (result.error || !result.stdout) {
  console.error('npm audit unavailable:', result.error?.message || result.stderr);
  process.exit(1);
}
let report;
try { report = JSON.parse(result.stdout); } catch { console.error('npm audit did not return JSON'); process.exit(1); }
if (report.error) { console.error('npm audit error:', report.error.code || 'unknown'); process.exit(1); }
const blocked = Object.entries(report.vulnerabilities || {}).filter(([name, item]) => {
  if (!['high', 'critical'].includes(item.severity)) return false;
  if (name !== exception) return true;
  const advisories = item.via.filter((v) => typeof v === 'object').map((v) => v.url);
  return !advisories.length || advisories.some((url) => !['https://github.com/advisories/GHSA-4r6h-8v6p-xvw6', 'https://github.com/advisories/GHSA-5pgg-2g8v-p4x9'].includes(url));
});
for (const [name, item] of blocked) console.error(`Blocked ${item.severity} advisory: ${name}`);
if (blocked.length) process.exit(1);
console.log('Production npm audit gate passed (reviewed xlsx exception expires 2026-10-26)');
