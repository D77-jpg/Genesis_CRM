import { bootstrapAdminUser } from '../services/auth.service';
import type { Migration } from './types';

export const bootstrapAdminMigration: Migration = {
  id: '20261104-003-bootstrap-admin',
  name: 'Create the bootstrap administrator when absent',
  version: 1,
  async up() {
    await bootstrapAdminUser();
  },
};
