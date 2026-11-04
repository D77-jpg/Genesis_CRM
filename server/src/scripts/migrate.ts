/**
 * Versioned migration CLI.
 *
 *   npm run migrate              apply all pending migrations
 *   npm run migrate:status       inspect state without changing the database
 *   npm run migrate -- --dry-run preview pending migrations
 *   npm run migrate -- --to 20261104-005-mail-last-contact
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { createLogger } from '../config/logger';
import { formatMigrationState, migrationState, runMigrations } from '../migrations';

const logger = createLogger('migrate-cli');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const dryRun = args.includes('--dry-run');
  const toIndex = args.indexOf('--to');
  if (toIndex >= 0 && !args[toIndex + 1]) throw new Error('--to requires a migration id');
  const to = toIndex >= 0 ? args[toIndex + 1] : undefined;

  await connectDatabase();
  try {
    if (statusOnly) {
      const state = await migrationState();
      console.log(formatMigrationState(state));
      if (state.pending.length || state.changed.length || state.unknown.length) process.exitCode = 1;
      return;
    }
    const result = await runMigrations({ dryRun, to });
    if (dryRun) {
      console.log(`Pending migrations: ${result.pending.length ? result.pending.join(', ') : 'none'}`);
      return;
    }
    console.log(result.applied.length ? `Applied: ${result.applied.join(', ')}` : 'Database is already current.');
    const state = await migrationState();
    console.log(formatMigrationState(state));
    if (state.pending.length || state.changed.length || state.unknown.length) process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main().catch((error) => {
  logger.error('Migration failed', error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
