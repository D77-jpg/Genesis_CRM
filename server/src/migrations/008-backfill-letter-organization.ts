import { Types } from 'mongoose';
import type { Migration } from './types';

/**
 * Automatic outreach promoted letters with an upsert from the background
 * worker. Those writes predated the tenant-aware upsert hook and therefore
 * have no organizationId, which makes them invisible to tenant-scoped mail
 * queries. Backfill them from their project (the tenant invariant is already
 * enforced by project scoping).
 */
export const backfillLetterOrganizationMigration: Migration = {
  id: '20261104-008-backfill-letter-organization',
  version: 1,
  name: 'Backfill organizationId on automatic outreach letters',
  async up(connection) {
    const projects = await connection.collection('projects')
      .find({}, { projection: { organizationId: 1 } })
      .toArray();
    const organizations = new Map(
      projects
        .filter((project) => project.organizationId)
        .map((project) => [String(project._id), new Types.ObjectId(String(project.organizationId))]),
    );
    if (!organizations.size) return;

    const missing = await connection.collection('developmentletters')
      .find({ $or: [{ organizationId: { $exists: false } }, { organizationId: null }] })
      .project({ _id: 1, projectId: 1 })
      .toArray();
    const unresolved: string[] = [];
    for (const letter of missing) {
      const organizationId = organizations.get(String(letter.projectId));
      if (!organizationId) {
        unresolved.push(String(letter._id));
        continue;
      }
      await connection.collection('developmentletters').updateOne(
        { _id: letter._id },
        { $set: { organizationId } },
      );
    }
    if (unresolved.length) {
      throw new Error(`Cannot backfill organizationId for ${unresolved.length} development letter(s): ${unresolved.slice(0, 5).join(', ')}`);
    }
  },
};
