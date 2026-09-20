import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memory: MongoMemoryServer;
let mongoose: typeof import('mongoose');
let service: typeof import('../src/services/scratchpad.service');

const userA = new Types.ObjectId().toString();
const userB = new Types.ObjectId().toString();
const projectA = new Types.ObjectId().toString();
const projectB = new Types.ObjectId().toString();

before(async () => {
  memory = await MongoMemoryServer.create();
  mongoose = await import('mongoose');
  await mongoose.default.connect(memory.getUri(), { dbName: 'scratchpad-tests' });
  const { Scratchpad } = await import('../src/models');
  await Scratchpad.init();
  service = await import('../src/services/scratchpad.service');
});

after(async () => {
  await mongoose.default.disconnect();
  await memory.stop();
});

test('empty scratchpad is returned without creating a record', async () => {
  const { Scratchpad } = await import('../src/models');
  assert.deepEqual(await service.getScratchpad(userA, projectA), { content: '', version: 0, updatedAt: null });
  assert.equal(await Scratchpad.countDocuments(), 0);
});

test('content is isolated by both user and project', async () => {
  const saved = await service.updateScratchpad({ content: 'user A / project A', expectedVersion: 0 }, userA, projectA);
  assert.equal(saved.version, 1);
  assert.equal((await service.getScratchpad(userA, projectA)).content, 'user A / project A');
  assert.equal((await service.getScratchpad(userB, projectA)).content, '');
  assert.equal((await service.getScratchpad(userA, projectB)).content, '');
});

test('stale versions are rejected instead of silently overwriting newer content', async () => {
  const first = await service.getScratchpad(userA, projectA);
  const updated = await service.updateScratchpad({ content: 'newer server content', expectedVersion: first.version }, userA, projectA);
  assert.equal(updated.version, first.version + 1);

  await assert.rejects(
    service.updateScratchpad({ content: 'stale device content', expectedVersion: first.version }, userA, projectA),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error
      && (error as { statusCode: number }).statusCode === 409),
  );
  assert.equal((await service.getScratchpad(userA, projectA)).content, 'newer server content');
});
