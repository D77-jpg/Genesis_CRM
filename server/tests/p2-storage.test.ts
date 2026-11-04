import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'p2-storage-fixture-jwt-secret-0123456789abcdef';

let tempDir: string;
let storage: typeof import('../src/services/storage.service');

before(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'genesis-storage-'));
  process.env.UPLOAD_DIR = tempDir;
  process.env.STORAGE_PROVIDER = 'local';
  storage = await import('../src/services/storage.service');
});

after(async () => {
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true });
});

test('local storage round-trips binary content', async () => {
  const key = 'attachment-fixture.bin';
  const body = Buffer.from([0, 1, 2, 3, 255]);
  const stored = await storage.putObject(key, body, 'application/octet-stream');
  assert.equal(stored.provider, 'local');
  assert.equal(stored.key, key);
  assert.deepEqual(await storage.getObject(key), body);
  await storage.deleteObject(key);
  await assert.rejects(() => storage.getObject(key), /已丢失/);
});

test('local storage rejects path traversal keys', async () => {
  await assert.rejects(() => storage.putObject('../escape.bin', Buffer.from('x')), /非法存储路径/);
  assert.equal(storage.storageProviderName(), 'local');
});
