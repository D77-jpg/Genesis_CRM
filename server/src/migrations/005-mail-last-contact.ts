import { migrateMailCustomerLastContact } from '../services/customer.service';
import type { Migration } from './types';

export const mailCustomerLastContactMigration: Migration = {
  id: '20261104-005-mail-last-contact',
  name: 'Backfill customer last-contact dates from mail',
  version: 1,
  async up() {
    await migrateMailCustomerLastContact();
  },
};
