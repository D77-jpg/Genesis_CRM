import { bootstrapProjects } from '../services/project.service';
import type { Migration } from './types';

export const bootstrapProjectsMigration: Migration = {
  id: '20261104-002-bootstrap-projects',
  name: 'Create default project workspaces',
  version: 1,
  async up() {
    await bootstrapProjects();
  },
};
