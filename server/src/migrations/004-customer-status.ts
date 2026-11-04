import { migrateLegacyCustomerStatus } from '../services/customer.service';
import type { Migration } from './types';

export const legacyCustomerStatusMigration: Migration = {
  id: '20261104-004-customer-status',
  name: 'Normalize legacy customer status values',
  version: 1,
  async up() {
    await migrateLegacyCustomerStatus();
  },
};
