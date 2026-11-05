import { IntegrationCredential, IntegrationRequestLog, Project } from '../models';
import { runWithTenant } from '../models/tenant-context';

/** Privileged, idempotent operator migration. Never outputs credentials or names. */
export async function migrateCredentialIndexes() {
  return runWithTenant({ bypass: true, source: 'credential-migration' }, async () => {
    let adopted = 0, untouched = 0, logsAdopted = 0;
    for await (const credential of IntegrationCredential.find({ organizationId: { $exists: false } }).select('_id projectIds').cursor()) {
      const projects = await Project.find({ _id: { $in: credential.projectIds } }).select('_id organizationId');
      const orgs = new Set(projects.map(p => p.organizationId ? String(p.organizationId) : ''));
      if (projects.length !== credential.projectIds.length || orgs.size !== 1 || orgs.has('')) { untouched++; continue; }
      const result = await IntegrationCredential.updateOne({ _id: credential._id, organizationId: { $exists: false } },
        { $set: { organizationId: projects[0].organizationId } });
      adopted += result.modifiedCount;
    }
    for await (const project of Project.find({ organizationId: { $exists: true } }).select('_id organizationId').cursor()) {
      if (!project.organizationId) continue;
      const result = await IntegrationRequestLog.updateMany({ projectId: project._id, organizationId: { $exists: false } },
        { $set: { organizationId: project.organizationId } });
      logsAdopted += result.modifiedCount;
    }
    await IntegrationCredential.createIndexes();
    await IntegrationRequestLog.createIndexes();
    return { adopted, untouched, logsAdopted };
  });
}
