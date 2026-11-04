import type { Connection } from 'mongoose';

/** A versioned, forward-only database migration. */
export interface Migration {
  /** Stable kebab-case identifier; never reuse or reorder. */
  id: string;
  /** Human-readable summary shown by `migrate:status`. */
  name: string;
  /**
   * Bump when changing an already-applied migration. The checksum is derived
   * from id + version + name so a changed applied migration is rejected.
   */
  version: number;
  up: (connection: Connection) => Promise<void>;
}

export interface MigrationRecord {
  _id: string;
  name: string;
  version: number;
  checksum: string;
  appliedAt: Date;
  durationMs: number;
  batch: number;
}

export interface MigrationStatusRow {
  id: string;
  name: string;
  version: number;
  state: 'applied' | 'pending' | 'changed';
  appliedAt?: Date;
  durationMs?: number;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  pending: string[];
}
