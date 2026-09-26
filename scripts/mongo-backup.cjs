#!/usr/bin/env node
'use strict';
// Standalone MongoDB tools orchestrator. No shell interpolation and no destructive live restore.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');
const { Writable } = require('node:stream');

const safeDb = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/;
const prefix = 'genesis-mongo-';
const clock = () => new Date().toISOString();
const fail = (message) => { throw new Error(message); };
const positive = (value, name) => {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(`${name} must be a positive integer`);
  return Number(value);
};
function options(argv) {
  const command = argv.shift();
  if (!['backup', 'rehearse'].includes(command)) fail('command must be backup or rehearse');
  const values = {};
  while (argv.length) {
    const flag = argv.shift();
    if (!/^--[a-z-]+$/.test(flag) || !argv.length || Object.hasOwn(values, flag)) fail('invalid or duplicate option');
    values[flag] = argv.shift();
  }
  const allowed = command === 'backup'
    ? ['--dir', '--db', '--uri', '--keep-days', '--keep-count', '--key-file', '--report']
    : ['--manifest', '--uri', '--target', '--key-file', '--report'];
  for (const key of Object.keys(values)) if (!allowed.includes(key)) fail(`unknown option ${key}`);
  for (const key of command === 'backup' ? ['--dir', '--db', '--uri'] : ['--manifest', '--uri', '--target']) {
    if (!values[key]) fail(`missing ${key}`);
  }
  return { command, values };
}
function database(name) {
  if (!safeDb.test(name)) fail('invalid database name');
  return name;
}
function uri(value, target) {
  if (!/^mongodb(?:\+srv)?:\/\//.test(value)) fail('expected MongoDB URI');
  let parsed;
  try { parsed = new URL(value); } catch { fail('invalid MongoDB URI'); }
  let embedded;
  try { embedded = decodeURIComponent(parsed.pathname.slice(1)); } catch { fail('invalid MongoDB URI database encoding'); }
  if (embedded && embedded !== target) fail('URI database must match selected database (or omit URI database)');
  return value;
}
async function safeDirectory(dir) {
  if (!path.isAbsolute(dir) || path.resolve(dir) === path.parse(path.resolve(dir)).root) fail('backup directory must be an absolute, non-root path');
  const resolved = path.resolve(dir);
  const real = await fsp.realpath(resolved);
  if (path.normalize(real).toLowerCase() !== path.normalize(resolved).toLowerCase()) fail('backup directory must not contain symlinks or unresolved components');
  if (!(await fsp.lstat(resolved)).isDirectory()) fail('backup directory must be a directory');
  return resolved;
}
async function regular(file) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('expected regular file, refusing symlink or directory');
  return stat;
}
async function digest(file) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyGzip(file) {
  await pipeline(fs.createReadStream(file), createGunzip(), new Writable({ write(_chunk, _encoding, done) { done(); } }));
}
async function run(bin, args) {
  return new Promise((resolve, reject) => {
    // Never include CLI stderr or arguments in a report: tools can echo connection credentials.
    const proc = spawn(bin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let errBytes = 0;
    proc.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 2_000_000) proc.kill();
    });
    proc.stderr.on('data', (chunk) => { errBytes += chunk.length; if (errBytes > 2_000_000) proc.kill(); });
    proc.on('error', () => reject(new Error(`${bin} could not start`)));
    proc.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${bin} failed (exit ${code})`)));
  });
}
async function inventory(connection, db) {
  const js = `const d=db.getSiblingDB(${JSON.stringify(db)}); print(JSON.stringify(Object.fromEntries(d.getCollectionNames().map(n=>[n,d.getCollection(n).countDocuments({})]))));`;
  const text = await run('mongosh', ['--quiet', '--uri', connection, '--eval', js]);
  let data;
  try { data = JSON.parse(text.trim()); } catch { fail('mongosh returned invalid inventory'); }
  if (!data || Array.isArray(data) || typeof data !== 'object' || Object.values(data).some(v => !Number.isSafeInteger(v) || v < 0)) fail('mongosh returned invalid collection counts');
  return data;
}
async function key(file) {
  if (!file || !path.isAbsolute(file)) fail('encryption key requires an absolute --key-file outside the repository');
  const real = await fsp.realpath(file);
  const repo = path.resolve(__dirname, '..');
  const relative = path.relative(repo, real);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail('encryption key must be outside the repository');
  await regular(file);
  const data = (await fsp.readFile(file, 'utf8')).trim();
  if (!/^[a-fA-F0-9]{64}$/.test(data)) fail('encryption key must be 32 bytes encoded as 64 hex characters');
  return Buffer.from(data, 'hex');
}
async function encrypt(source, destination, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
  await fsp.writeFile(destination, iv, { flag: 'wx', mode: 0o600 });
  await pipeline(fs.createReadStream(source), cipher, fs.createWriteStream(destination, { flags: 'a' }));
  await fsp.appendFile(destination, cipher.getAuthTag());
}
async function decrypt(source, destination, secret) {
  const stat = await regular(source);
  if (stat.size < 29) fail('encrypted archive is too short');
  const handle = await fsp.open(source, 'r');
  const iv = Buffer.alloc(12); const tag = Buffer.alloc(16);
  try { await handle.read(iv, 0, 12, 0); await handle.read(tag, 0, 16, stat.size - 16); }
  finally { await handle.close(); }
  const decipher = crypto.createDecipheriv('aes-256-gcm', secret, iv);
  decipher.setAuthTag(tag);
  await pipeline(fs.createReadStream(source, { start: 12, end: stat.size - 17 }), decipher,
    fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
}
async function manifestAt(file) {
  if (path.basename(file) !== file.split(/[\\/]/).at(-1) || !/^genesis-mongo-[A-Za-z0-9_-]+-\d{8}T\d{6}Z-[a-f0-9]{12}\.json$/.test(path.basename(file))) fail('invalid manifest filename');
  await regular(file);
  let m;
  try { m = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { fail('invalid manifest JSON'); }
  const archiveName = typeof m.archive === 'string' ? /^(genesis-mongo-[A-Za-z0-9_-]+-\d{8}T\d{6}Z-[a-f0-9]{12})\.archive\.gz(\.enc)?$/.exec(m.archive) : null;
  if (m.version !== 1 || !safeDb.test(m.database) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.createdUtc) || !Number.isFinite(Date.parse(m.createdUtc)) || !/^[a-f0-9]{64}$/.test(m.sha256) || !archiveName || path.basename(file) !== `${archiveName[1]}.json` || !archiveName[1].startsWith(`${prefix}${m.database}-`) || typeof m.encrypted !== 'boolean' || m.encrypted !== m.archive.endsWith('.enc') || !m.collections || Array.isArray(m.collections) || typeof m.collections !== 'object' || Object.values(m.collections).some(v => !Number.isSafeInteger(v) || v < 0)) fail('invalid manifest fields');
  const archive = path.join(path.dirname(file), m.archive);
  const stat = await regular(archive);
  if (stat.size !== m.bytes || stat.size === 0 || await digest(archive) !== m.sha256) fail('archive SHA-256 or size mismatch');
  return { manifest: m, archive };
}
async function retention(dir, days, count) {
  const entries = (await fsp.readdir(dir)).filter(n => /^genesis-mongo-[A-Za-z0-9_-]+-\d{8}T\d{6}Z-[a-f0-9]{12}\.json$/.test(n));
  const items = [];
  for (const name of entries) {
    // Invalid pairs are never deleted automatically; surface the problem to the operator.
    const { manifest, archive } = await manifestAt(path.join(dir, name));
    items.push({ file: path.join(dir, name), archive, manifest });
  }
  items.sort((a, b) => b.manifest.createdUtc.localeCompare(a.manifest.createdUtc) || a.file.localeCompare(b.file));
  const threshold = Date.now() - days * 86400000;
  for (const [i, item] of items.entries()) {
    if (i < count && Date.parse(item.manifest.createdUtc) >= threshold) continue;
    await regular(item.file); await regular(item.archive);
    await fsp.unlink(item.file);
    await fsp.unlink(item.archive);
  }
}
async function backup(v, report) {
  const db = database(v['--db']); const connection = uri(v['--uri'], db);
  const dir = await safeDirectory(v['--dir']);
  const days = positive(v['--keep-days'] ?? '30', '--keep-days');
  const count = positive(v['--keep-count'] ?? '30', '--keep-count');
  const secret = v['--key-file'] ? await key(v['--key-file']) : null;
  const started = clock();
  const id = `${prefix}${db}-${started.replace(/[-:]/g, '').slice(0, 15)}Z-${crypto.randomBytes(6).toString('hex')}`;
  const raw = path.join(dir, `${id}.archive.gz.part`);
  const archive = path.join(dir, `${id}.archive.gz${secret ? '.enc' : ''}`);
  const temp = `${archive}.part`;
  const manifestFile = path.join(dir, `${id}.json`);
  const manifestTemp = `${manifestFile}.part`;
  try {
    // wx reserves the name before invoking mongodump; tools write only to a known unique path.
    await fsp.writeFile(raw, '', { flag: 'wx', mode: 0o600 });
    await run('mongodump', ['--uri', connection, '--db', db, `--archive=${raw}`, '--gzip']);
    if (!(await regular(raw)).size) fail('mongodump produced an empty archive');
    await verifyGzip(raw);
    const collections = await inventory(connection, db);
    if (secret) { await encrypt(raw, temp, secret); await fsp.unlink(raw); }
    else await fsp.rename(raw, temp);
    const bytes = (await regular(temp)).size;
    const sha256 = await digest(temp);
    const manifest = { version: 1, database: db, createdUtc: started, archive: path.basename(archive), bytes, sha256, encrypted: !!secret, collections };
    if (!Object.hasOwn(collections, 'projects')) fail('source lacks Genesis projects collection');
    await fsp.writeFile(manifestTemp, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fsp.rename(temp, archive);
    await fsp.rename(manifestTemp, manifestFile); // publication boundary
    report.database = db; report.manifest = manifestFile; report.sha256 = sha256;
    await manifestAt(manifestFile);
    report.rpoSeconds = Math.ceil((Date.now() - Date.parse(started)) / 1000);
    // A retention failure is reported without invalidating the already published backup.
    await retention(dir, days, count);
  } finally {
    for (const file of [raw, temp, manifestTemp]) await fsp.rm(file, { force: true }).catch(() => {});
  }
}
async function rehearse(v, report) {
  const target = database(v['--target']);
  if (!/(?:rehearsal|restore_test)/i.test(target)) fail('target must contain rehearsal or restore_test');
  const connection = uri(v['--uri'], target);
  if (!path.isAbsolute(v['--manifest'])) fail('manifest path must be absolute');
  const dir = await safeDirectory(path.dirname(v['--manifest']));
  const { manifest, archive } = await manifestAt(path.join(dir, path.basename(v['--manifest'])));
  if (target === manifest.database) fail('source and target must differ');
  const before = await inventory(connection, target);
  if (Object.keys(before).length) fail('target database has collections; refusing to overwrite');
  let source = archive;
  let decrypted;
  try {
    if (manifest.encrypted) {
      const secret = await key(v['--key-file']);
      decrypted = path.join(os.tmpdir(), `genesis-restore-${crypto.randomBytes(12).toString('hex')}.archive.gz`);
      await decrypt(archive, decrypted, secret);
      source = decrypted;
    } else if (v['--key-file']) fail('manifest is not encrypted');
    await run('mongorestore', ['--uri', connection, `--archive=${source}`, '--gzip', `--nsInclude=${manifest.database}.*`, `--nsFrom=${manifest.database}.*`, `--nsTo=${target}.*`, '--stopOnError']);
    const actual = await inventory(connection, target);
    for (const [name, count] of Object.entries(manifest.collections)) if (actual[name] !== count) fail(`collection count mismatch: ${name}`);
    for (const name of Object.keys(actual)) if (!Object.hasOwn(manifest.collections, name)) fail(`unexpected restored collection: ${name}`);
    if (!Object.hasOwn(manifest.collections, 'projects')) fail('backup lacks Genesis projects collection');
    if (actual.projects !== manifest.collections.projects) fail('Genesis project count mismatch');
    report.database = target; report.collections = actual; report.genesisProjectCount = actual.projects;
    report.rtoSeconds = Math.ceil((Date.now() - Date.parse(report.startedUtc)) / 1000);
    report.rpoSeconds = Math.ceil((Date.now() - Date.parse(manifest.createdUtc)) / 1000);
  } finally { if (decrypted) await fsp.rm(decrypted, { force: true }).catch(() => {}); }
}
async function main(argv) {
  const report = { version: 1, operation: null, ok: false, startedUtc: clock(), finishedUtc: null, rtoSeconds: null, rpoSeconds: null, failure: null };
  let reportPath;
  try {
    const { command, values } = options([...argv]); report.operation = command;
    reportPath = values['--report'];
    if (command === 'backup') await backup(values, report);
    else await rehearse(values, report);
    report.ok = true;
  } catch (error) { report.failure = error instanceof Error ? error.message : 'unknown error'; }
  report.finishedUtc = clock();
  const text = JSON.stringify(report);
  if (reportPath) {
    try {
      if (!path.isAbsolute(reportPath)) fail('report path must be absolute');
      const dir = await safeDirectory(path.dirname(reportPath));
      const temp = path.join(dir, `.report-${crypto.randomBytes(12).toString('hex')}.part`);
      try { await fsp.writeFile(temp, text + '\n', { flag: 'wx', mode: 0o600 }); await fsp.rename(temp, reportPath); }
      finally { await fsp.rm(temp, { force: true }).catch(() => {}); }
    } catch { report.ok = false; report.failure = 'could not write report'; }
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  if (!report.ok) process.exitCode = 1;
  return report;
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { main, options, safeDirectory, manifestAt, retention };
