/**
 * Forward-only MongoDB migration runner.
 *
 * Migrations are recorded in `schema_migrations`; an advisory lock prevents
 * two API/worker/migrate processes from applying the same batch concurrently.
 * Application startup only verifies that the database is current — it never
 * mutates schema or business data implicitly.
 */
import { createHash, randomUUID } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { createLogger } from '../config/logger';
import type { Migration, MigrationRecord, MigrationResult, MigrationStatusRow } from './types';

const logger = createLogger('migrations');
const RECORDS_COLLECTION = 'schema_migrations';
const LOCKS_COLLECTION = 'migration_locks';
const LOCK_ID = 'global';
const LOCK_TTL_MS = 2 * 60 * 60 * 1000;

interface MigrationLock {
  _id: string;
  owner: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface MigrationRunOptions {
  connection?: Connection;
  registry?: Migration[];
  dryRun?: boolean;
  /** Stop after applying this migration id (inclusive). */
  to?: string;
}

export interface MigrationState {
  status: MigrationStatusRow[];
  pending: string[];
  changed: string[];
  /** Records applied by a newer build but absent from this build's registry. */
  unknown: string[];
}

function checksumOf(migration: Migration): string {
  return createHash('sha256').update(`${migration.id}:${migration.version}:${migration.name}`).digest('hex');
}

function assertRegistry(registry: Migration[]): void {
  const ids = new Set<string>();
  let previous = '';
  for (const migration of registry) {
    if (!migration.id || !migration.name || !Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error('Invalid migration definition: id, name and positive integer version are required');
    }
    if (ids.has(migration.id)) throw new Error(`Duplicate migration id: ${migration.id}`);
    if (previous && migration.id <= previous) throw new Error(`Migration registry must be sorted by id: ${migration.id}`);
    ids.add(migration.id);
    previous = migration.id;
  }
}

async function resolveRegistry(registry?: Migration[]): Promise<Migration[]> {
  if (registry) {
    assertRegistry(registry);
    return registry;
  }
  const module = await import('./registry');
  assertRegistry(module.migrations);
  return module.migrations;
}

function getConnection(connection?: Connection): Connection {
  const resolved = connection ?? mongoose.connection;
  if (!resolved.db) throw new Error('MongoDB is not connected; call connectDatabase() before migrations');
  return resolved;
}

export async function migrationState(options: Pick<MigrationRunOptions, 'connection' | 'registry'> = {}): Promise<MigrationState> {
  const connection = getConnection(options.connection);
  const registry = await resolveRegistry(options.registry);
  const records = await connection.collection<MigrationRecord>(RECORDS_COLLECTION).find().toArray();
  const byId = new Map(records.map((record) => [record._id, record]));
  const status: MigrationStatusRow[] = registry.map((migration) => {
    const record = byId.get(migration.id);
    if (!record) return { id: migration.id, name: migration.name, version: migration.version, state: 'pending' };
    const changed = record.checksum !== checksumOf(migration) || record.version !== migration.version;
    return {
      id: migration.id,
      name: migration.name,
      version: migration.version,
      state: changed ? 'changed' : 'applied',
      appliedAt: record.appliedAt,
      durationMs: record.durationMs,
    };
  });
  const unknown = records.filter((record) => !registry.some((migration) => migration.id === record._id));
  if (unknown.length) {
    logger.warn(`Database contains migration records not present in this build: ${unknown.map((item) => item._id).join(', ')}`);
  }
  return {
    status,
    pending: status.filter((item) => item.state === 'pending').map((item) => item.id),
    changed: status.filter((item) => item.state === 'changed').map((item) => item.id),
    unknown: unknown.map((item) => item._id),
  };
}

async function acquireLock(connection: Connection): Promise<string> {
  const owner = randomUUID();
  const now = new Date();
  const lock = connection.collection<MigrationLock>(LOCKS_COLLECTION);
  try {
    await lock.findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }] },
      { $set: { owner, acquiredAt: now, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new Error('Another migration process holds the database migration lock');
    }
    throw error;
  }
  return owner;
}

async function releaseLock(connection: Connection, owner: string): Promise<void> {
  await connection.collection<MigrationLock>(LOCKS_COLLECTION).deleteOne({ _id: LOCK_ID, owner });
}

/**
 * Apply pending migrations in registry order. Already-applied records are
 * skipped. A changed already-applied migration is a hard failure: create a new
 * migration instead of editing history.
 */
export async function runMigrations(options: MigrationRunOptions = {}): Promise<MigrationResult> {
  const connection = getConnection(options.connection);
  const registry = await resolveRegistry(options.registry);
  const before = await migrationState({ connection, registry });
  if (before.changed.length) {
    throw new Error(`Applied migrations changed without a version bump: ${before.changed.join(', ')}`);
  }
  if (before.unknown.length) {
    throw new Error(`Database has migrations unknown to this build: ${before.unknown.join(', ')}`);
  }
  const pending = before.status.filter((item) => item.state === 'pending').map((item) => item.id);
  if (options.dryRun) return { applied: [], skipped: before.status.filter((item) => item.state === 'applied').map((item) => item.id), pending };
  if (!pending.length) return { applied: [], skipped: before.status.filter((item) => item.state === 'applied').map((item) => item.id), pending: [] };

  const owner = await acquireLock(connection);
  try {
    // Re-read after lock acquisition: another process may have completed the batch.
    const lockedState = await migrationState({ connection, registry });
    const remaining = lockedState.status.filter((item) => item.state === 'pending').map((item) => item.id);
    const applied: string[] = [];
    const records = connection.collection<MigrationRecord>(RECORDS_COLLECTION);
    const lastBatch = await records.find().sort({ batch: -1 }).limit(1).next();
    let batch = (lastBatch?.batch ?? 0) + 1;

    for (const id of remaining) {
      if (options.to && id > options.to) break;
      const migration = registry.find((item) => item.id === id);
      if (!migration) throw new Error(`Migration not found in registry: ${id}`);
      const started = Date.now();
      logger.info(`Applying ${migration.id} — ${migration.name}`);
      await migration.up(connection);
      const durationMs = Date.now() - started;
      await records.insertOne({
        _id: migration.id,
        name: migration.name,
        version: migration.version,
        checksum: checksumOf(migration),
        appliedAt: new Date(),
        durationMs,
        batch,
      });
      applied.push(migration.id);
      logger.info(`Applied ${migration.id} in ${durationMs}ms`);
      if (options.to && id === options.to) break;
    }

    return {
      applied,
      skipped: lockedState.status.filter((item) => item.state === 'applied').map((item) => item.id),
      pending: lockedState.status.filter((item) => item.state === 'pending' && !applied.includes(item.id)).map((item) => item.id),
    };
  } finally {
    await releaseLock(connection, owner);
  }
}

/** Startup guard: fail closed when migrations are pending or history changed. */
export async function assertMigrationsApplied(connection?: Connection): Promise<MigrationState> {
  const state = await migrationState({ connection });
  if (state.pending.length || state.changed.length || state.unknown.length) {
    const detail = [
      state.pending.length ? `pending: ${state.pending.join(', ')}` : '',
      state.changed.length ? `changed: ${state.changed.join(', ')}` : '',
      state.unknown.length ? `unknown: ${state.unknown.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Database migrations are not current (${detail}). Run \`npm run migrate --prefix server\` before starting the service.`);
  }
  return state;
}

export function formatMigrationState(state: MigrationState): string {
  const rows = state.status.map((item) => {
    const marker = item.state === 'applied' ? '✓' : item.state === 'changed' ? '!' : '·';
    const timing = item.durationMs === undefined ? '' : ` ${item.durationMs}ms`;
    return `${marker} ${item.id}  ${item.name}  [${item.state}]${timing}`;
  });
  if (state.unknown.length) {
    rows.push(`? ${state.unknown.join(', ')}  [unknown to this build]`);
  }
  return rows.join('\n');
}
