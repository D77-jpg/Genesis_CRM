import { migrateLegacyQuotationVersion } from '../services/quotation.service';
import type { Migration } from './types';

export const legacyQuotationVersionMigration: Migration = {
  id: '20261104-006-quotation-version',
  name: 'Backfill quotation version numbers',
  version: 1,
  async up() {
    await migrateLegacyQuotationVersion();
  },
};
