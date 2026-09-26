'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const child = require('node:child_process');
let restored = false;
let restoreCounts = { projects: 3, customers: 2 };
let calls = [];
child.spawn = (bin, args, opts) => {
  calls.push({ bin, args, opts });
  const proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
  proc.kill = () => {};
  setImmediate(() => {
    if (bin === 'mongodump') fs.writeFileSync(args.find(x => x.startsWith('--archive=')).slice(10), zlib.gzipSync('fake BSON archive'));
    if (bin === 'mongorestore') restored = true;
    if (bin === 'mongosh') proc.stdout.end(JSON.stringify(args.at(-1).includes('restore_test') ? (restored ? restoreCounts : {}) : { projects: 3, customers: 2 }));
    else proc.stdout.end();
    proc.stderr.end(); proc.emit('close', 0);
  });
  return proc;
};
const tool = require('./mongo-backup.cjs');
async function invoke(args) {
  let stdout = '';
  const old = process.stdout.write;
  process.stdout.write = function (text) { stdout += text; return true; };
  try { await tool.main(args); } finally { process.stdout.write = old; process.exitCode = 0; }
  return JSON.parse(stdout);
}
async function fixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'genesis-backup-test-'));
  return { dir, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
}
const backupArgs = dir => ['backup', '--dir', dir, '--db', 'cdlm', '--uri', 'mongodb://127.0.0.1:27017/cdlm'];
const restoreArgs = manifest => ['rehearse', '--manifest', manifest, '--uri', 'mongodb://127.0.0.1:27017/cdlm_restore_test', '--target', 'cdlm_restore_test'];
test('archive publication, digest, inventory, safe rehearsal and report', async () => {
  const f = await fixture();
  try {
    calls = []; restored = false;
    const report = await invoke([...backupArgs(f.dir), '--keep-days', '30', '--keep-count', '2', '--report', path.join(f.dir, 'status.json')]);
    assert.equal(report.ok, true, report.failure);
    assert.equal(JSON.parse(await fsp.readFile(path.join(f.dir, 'status.json'))).sha256, report.sha256);
    const { manifest, archive } = await tool.manifestAt(report.manifest);
    assert.deepEqual(manifest.collections, { projects: 3, customers: 2 });
    assert.equal(manifest.sha256, report.sha256);
    assert.equal((await fsp.readdir(f.dir)).some(n => n.endsWith('.part')), false);
    assert.ok(calls.find(x => x.bin === 'mongodump').args.includes('--gzip'));
    assert.equal(calls.every(x => x.opts.shell === false), true);
    assert.ok((await fsp.readFile(archive)).length > 0);
    const rehearsal = await invoke(restoreArgs(report.manifest));
    assert.equal(rehearsal.ok, true, rehearsal.failure);
    assert.equal(rehearsal.genesisProjectCount, 3);
    assert.ok(rehearsal.rtoSeconds >= 0 && rehearsal.rpoSeconds >= 0);
    assert.equal(calls.find(x => x.bin === 'mongorestore').args.includes('--drop'), false);
  } finally { await f.cleanup(); }
});
test('tampering, live target, URI mismatch, populated target and count mismatch fail closed', async () => {
  const f = await fixture();
  try {
    restored = false;
    const b = await invoke(backupArgs(f.dir));
    assert.equal(b.ok, true);
    const original = calls.length;
    assert.equal((await invoke(['rehearse', '--manifest', b.manifest, '--uri', 'mongodb://localhost/cdlm', '--target', 'cdlm'])).ok, false);
    assert.equal((await invoke(['rehearse', '--manifest', b.manifest, '--uri', 'mongodb://localhost/cdlm', '--target', 'cdlm_restore_test'])).ok, false);
    assert.equal(calls.length, original);
    const args = restoreArgs(b.manifest);
    restoreCounts = { projects: 4, customers: 2 };
    assert.match((await invoke(args)).failure, /count mismatch/);
    const m = JSON.parse(await fsp.readFile(b.manifest));
    await fsp.appendFile(path.join(f.dir, m.archive), 'tamper');
    assert.match((await invoke(args)).failure, /SHA-256 or size mismatch/);
    assert.equal((await invoke(['backup', '--dir', path.parse(f.dir).root, '--db', 'cdlm', '--uri', 'mongodb://localhost'])).ok, false);
  } finally { restoreCounts = { projects: 3, customers: 2 }; await f.cleanup(); }
});
test('rejects corrupted manifests and unsafe retention', async () => {
  const f = await fixture();
  try {
    restored = false;
    assert.equal((await invoke([...backupArgs(f.dir), '--keep-count', '0'])).ok, false);
    assert.equal((await invoke([...backupArgs(f.dir), '--db', '../cdlm'])).ok, false);
    const b = await invoke(backupArgs(f.dir));
    assert.equal(b.ok, true);
    const manifest = JSON.parse(await fsp.readFile(b.manifest));
    manifest.archive = '../unrelated.archive.gz';
    await fsp.writeFile(b.manifest, JSON.stringify(manifest));
    await assert.rejects(tool.retention(f.dir, 1, 1), /invalid manifest/);
    assert.equal((await fsp.readdir(f.dir)).filter(n => n.endsWith('.archive.gz')).length, 1);
  } finally { await f.cleanup(); }
});
test('encryption outside repo, authenticated round trip, and retention', async () => {
  const f = await fixture(); const secrets = await fixture();
  try {
    restored = false;
    const file = path.join(secrets.dir, 'key.hex');
    await fsp.writeFile(file, 'ab'.repeat(32));
    const b = await invoke([...backupArgs(f.dir), '--key-file', file, '--keep-count', '1']);
    assert.equal(b.ok, true, b.failure);
    const m = JSON.parse(await fsp.readFile(b.manifest));
    assert.equal(m.encrypted, true);
    assert.ok(m.archive.endsWith('.enc'));
    assert.equal((await invoke(restoreArgs(b.manifest))).ok, false);
    assert.equal((await invoke([...restoreArgs(b.manifest), '--key-file', file])).ok, true);
    const next = await invoke([...backupArgs(f.dir), '--key-file', file, '--keep-count', '1']);
    assert.equal(next.ok, true, next.failure);
    assert.equal(await fsp.stat(b.manifest).then(() => true, () => false), false);
    assert.equal((await fsp.readdir(f.dir)).filter(n => n.endsWith('.json')).length, 1);
  } finally { await f.cleanup(); await secrets.cleanup(); }
});
