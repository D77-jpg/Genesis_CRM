import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { assertMigrationsApplied, formatMigrationState, migrationState, runMigrations } from '../src/migrations/runner';
import { backfillLetterOrganizationMigration } from '../src/migrations/008-backfill-letter-organization';
import type { Migration } from '../src/migrations/types';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'p3-migration-fixture-secret-0123456789abcdef';

let memory: MongoMemoryServer;

const registry: Migration[] = [
  {
    id: '20260101-001-create-marker',
    name: 'Create marker',
    version: 1,
    async up(connection) {
      await connection.collection('p3_markers').insertOne({ _id: 'one', value: 1 });
    },
  },
  {
    id: '20260101-002-add-second-marker',
    name: 'Add second marker',
    version: 1,
    async up(connection) {
      await connection.collection('p3_markers').insertOne({ _id: 'two', value: 2 });
    },
  },
];

before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('p3_migrations_fixture'));
});

after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

beforeEach(async () => {
  const db = mongoose.connection.db;
  assert.ok(db);
  await Promise.all(['schema_migrations', 'migration_locks', 'p3_markers', 'projects', 'developmentletters'].map((name) => db.collection(name).drop().catch(() => undefined)));
});

test('migration runner applies pending migrations once and records status', async () => {
  const initial = await migrationState({ registry });
  assert.deepEqual(initial.pending, registry.map((item) => item.id));
  assert.equal(initial.status.every((item) => item.state === 'pending'), true);

  const dry = await runMigrations({ registry, dryRun: true });
  assert.equal(dry.applied.length, 0);
  assert.deepEqual(dry.pending, registry.map((item) => item.id));
  assert.equal(await mongoose.connection.collection('p3_markers').countDocuments(), 0);

  const first = await runMigrations({ registry });
  assert.deepEqual(first.applied, registry.map((item) => item.id));
  assert.equal(await mongoose.connection.collection('p3_markers').countDocuments(), 2);

  const second = await runMigrations({ registry });
  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.equal(await mongoose.connection.collection('schema_migrations').countDocuments(), 2);

  const state = await migrationState({ registry });
  assert.equal(state.pending.length, 0);
  assert.equal(state.status.every((item) => item.state === 'applied'), true);
  assert.match(formatMigrationState(state), /20260101-001-create-marker/);
});

test('migration runner refuses changed applied migrations', async () => {
  await runMigrations({ registry });
  const changed: Migration[] = [
    { ...registry[0], version: 2, name: 'Create marker safely' },
    registry[1],
  ];
  const state = await migrationState({ registry: changed });
  assert.deepEqual(state.changed, ['20260101-001-create-marker']);
  await assert.rejects(() => runMigrations({ registry: changed }), /version bump/i);
});

test('startup guard rejects records from a newer build', async () => {
  await runMigrations({ registry });
  const db = mongoose.connection.db;
  assert.ok(db);
  await db.collection('schema_migrations').insertOne({
    _id: '20990101-999-from-newer-build',
    name: 'Newer build only',
    version: 1,
    checksum: 'future',
    appliedAt: new Date(),
    durationMs: 1,
    batch: 99,
  });
  const state = await migrationState({ registry });
  assert.deepEqual(state.unknown, ['20990101-999-from-newer-build']);
  await assert.rejects(() => assertMigrationsApplied(), /unknown to this build|unknown/i);
});

test('letter organization backfill derives tenant from the project', async () => {
  const db = mongoose.connection.db;
  assert.ok(db);
  const projectId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const letterId = new mongoose.Types.ObjectId();
  await db.collection('projects').insertOne({ _id: projectId, organizationId });
  await db.collection('developmentletters').insertOne({ _id: letterId, projectId });
  await backfillLetterOrganizationMigration.up(mongoose.connection);
  const letter = await db.collection('developmentletters').findOne({ _id: letterId });
  assert.equal(String(letter?.organizationId), String(organizationId));
});

test('migration lock blocks a concurrent runner', async () => {
  const db = mongoose.connection.db;
  assert.ok(db);
  await db.collection('migration_locks').insertOne({
    _id: 'global', owner: 'another-process', acquiredAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
  });
  await assert.rejects(() => runMigrations({ registry }), /lock/i);
});
