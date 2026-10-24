'use strict';
// Fail CI for every high/critical production advisory.
//
// A dependency may only be exempted through REVIEWED_EXCEPTIONS below. Each entry
// pins the exact GHSA urls that were reviewed plus an expiry date, so a stale
// exception fails loudly instead of silently letting a new advisory through.
// xlsx no longer needs an exception: we install SheetJS 0.20.3 from the official
// CDN tarball, which is outside GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9.
const { spawnSync } = require('node:child_process');

/** 已评审的依赖例外（当前没有）：{ pkg: { advisories: [url], expires: 'YYYY-MM-DD' } } */
const REVIEWED_EXCEPTIONS = {};

const prefix = process.argv[2];
const unexpected = process.argv[3];
if (!['server', 'web'].includes(prefix)) {
  console.error('usage: node scripts/audit-gate.cjs <server|web>');
  process.exit(2);
}
if (unexpected) {
  console.error(
    `audit-gate: 不再接受命令行例外参数（收到 "${unexpected}"）。` +
      '如需放行某个依赖，请在 REVIEWED_EXCEPTIONS 里登记公告编号与到期日。',
  );
  process.exit(2);
}

const result = spawnSync('npm', ['audit', '--prefix', prefix, '--omit=dev', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (result.error || !result.stdout) {
  console.error('npm audit unavailable:', result.error?.message || result.stderr);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('npm audit did not return JSON');
  process.exit(1);
}
if (report.error) {
  console.error('npm audit error:', report.error.code || 'unknown');
  process.exit(1);
}

const blocked = Object.entries(report.vulnerabilities || {}).filter(([name, item]) => {
  if (!['high', 'critical'].includes(item.severity)) return false;
  const exception = REVIEWED_EXCEPTIONS[name];
  if (!exception) return true;
  if (new Date() >= new Date(`${exception.expires}T00:00:00Z`)) {
    console.error(`audit-gate: ${name} 的例外已于 ${exception.expires} 到期，请处理依赖或续期评审`);
    return true;
  }
  const advisories = item.via.filter((entry) => typeof entry === 'object').map((entry) => entry.url);
  return !advisories.length || advisories.some((url) => !exception.advisories.includes(url));
});

for (const [name, item] of blocked) console.error(`Blocked ${item.severity} advisory: ${name}`);
if (blocked.length) process.exit(1);
console.log(`Production npm audit gate passed (${prefix}, no reviewed exceptions outstanding)`);
