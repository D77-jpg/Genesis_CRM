import { ensureDefaultOrganization, migrateLegacyTenantData } from '../services/organization.service';
import type { Migration } from './types';

export const defaultOrganizationMigration: Migration = {
  id: '20261104-001-default-organization',
  name: 'Create default organization and backfill legacy tenant keys',
  version: 1,
  async up() {
    await ensureDefaultOrganization();
    await migrateLegacyTenantData();
  },
};
