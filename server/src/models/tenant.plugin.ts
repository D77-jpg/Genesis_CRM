/**
 * Mongoose tenant plugin.
 *
 * Adds an indexed `organizationId` path to every business schema and enforces
 * tenant isolation at the query layer while a tenant context exists. This is
 * deliberately a defense-in-depth layer: explicit project/user filters remain
 * in services, and public endpoints keep their own project-derived scoping.
 */
import mongoose, { Schema, Types, type Aggregate, type Query } from 'mongoose';
import { currentOrganizationId, tenantBypass } from './tenant-context';

type MiddlewareNext = (error?: Error) => void;
type TenantQuery = Query<unknown, unknown> & {
  getFilter(): Record<string, unknown>;
  getUpdate(): Record<string, unknown> | undefined;
  getOptions(): Record<string, unknown>;
};

function scopedOrganizationId(): Types.ObjectId | undefined {
  return tenantBypass() ? undefined : currentOrganizationId();
}

function applyQueryFilter(query: TenantQuery): void {
  const organizationId = scopedOrganizationId();
  if (!organizationId) return;
  const filter = query.getFilter() ?? {};
  // Do not overwrite an explicit organization filter; append an AND condition
  // so conflicting scopes fail closed instead of silently widening access.
  if (filter.organizationId && String(filter.organizationId) === String(organizationId)) return;
  query.and([{ organizationId }]);
}

/**
 * Background workers deliberately run with tenant filtering bypassed. New
 * project-scoped documents still need a tenant key, so derive it from the
 * project for saves performed outside an HTTP/worker organization context.
 */
async function projectOrganizationId(projectId: unknown): Promise<Types.ObjectId | undefined> {
  if (!projectId || !Types.ObjectId.isValid(String(projectId))) return undefined;
  const ProjectModel = mongoose.models.Project;
  if (!ProjectModel) return undefined;
  const project = await ProjectModel.findById(projectId).select('organizationId').lean() as { organizationId?: Types.ObjectId } | null;
  return project?.organizationId;
}

async function deriveProjectOrganization(doc: { organizationId?: Types.ObjectId; projectId?: unknown }): Promise<void> {
  if (doc.organizationId) return;
  const organizationId = await projectOrganizationId(doc.projectId);
  if (organizationId) doc.organizationId = organizationId;
}

/**
 * Upserts do not run the document save hook, so a background worker's
 * findOneAndUpdate(..., { upsert: true }) would otherwise create a
 * project-scoped row without its tenant key. Prefer the request tenant when
 * available and otherwise derive it from the project's organization.
 */
function applyUpsertOrganization(query: TenantQuery): Promise<void> | void {
  if (query.getOptions().upsert !== true) return;
  const update = query.getUpdate();
  if (!update || Array.isArray(update)) return;
  const setOnInsert = (update.$setOnInsert ?? {}) as Record<string, unknown>;
  if (setOnInsert.organizationId) return;
  const organizationId = scopedOrganizationId();
  if (organizationId) {
    setOnInsert.organizationId = organizationId;
    update.$setOnInsert = setOnInsert;
    return;
  }
  const filter = query.getFilter() ?? {};
  const projectId = setOnInsert.projectId
    ?? (update.$set as Record<string, unknown> | undefined)?.projectId
    ?? filter.projectId;
  return projectOrganizationId(projectId).then((derived) => {
    if (!derived) return;
    setOnInsert.organizationId = derived;
    update.$setOnInsert = setOnInsert;
  });
}

const QUERY_METHODS = [
  'find',
  'findOne',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
] as const;

export function tenantPlugin(schema: Schema): void {
  if ((schema.options as Record<string, unknown>).skipTenant === true) return;
  if (!schema.path('organizationId')) {
    schema.add({
      organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    });
  }

  for (const method of QUERY_METHODS) {
    schema.pre(method, function tenantFilter(this: TenantQuery, next: MiddlewareNext) {
      try {
        applyQueryFilter(this);
        const pending = applyUpsertOrganization(this);
        if (pending) void pending.then(() => next(), next);
        else next();
      } catch (error) {
        next(error as Error);
      }
    });
  }

  schema.pre('aggregate', function tenantAggregate(this: Aggregate<unknown[]>, next: MiddlewareNext) {
    try {
      const organizationId = scopedOrganizationId();
      if (organizationId) this.pipeline().unshift({ $match: { organizationId } });
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  schema.pre('validate', function tenantValidate(this: { organizationId?: Types.ObjectId }, next: MiddlewareNext) {
    const organizationId = scopedOrganizationId();
    if (organizationId && !this.organizationId) this.organizationId = organizationId;
    next();
  });

  schema.pre('save', async function tenantSave(this: { organizationId?: Types.ObjectId; projectId?: unknown }, next: MiddlewareNext) {
    const organizationId = scopedOrganizationId();
    if (organizationId && !this.organizationId) this.organizationId = organizationId;
    if (!this.organizationId) {
      try {
        await deriveProjectOrganization(this);
      } catch {
        // Never block an otherwise valid write because the optional project
        // lookup failed; legacy migration and explicit filters remain in place.
      }
    }
    next();
  });

  schema.pre('insertMany', async function tenantInsertMany(
    this: unknown,
    next: MiddlewareNext,
    docs: Array<{ organizationId?: Types.ObjectId; projectId?: unknown }>,
  ) {
    const organizationId = scopedOrganizationId();
    if (organizationId) {
      for (const doc of docs) if (doc && !doc.organizationId) doc.organizationId = organizationId;
    } else {
      for (const doc of docs) {
        if (doc && !doc.organizationId) {
          try {
            await deriveProjectOrganization(doc);
          } catch {
            // best effort; see save hook
          }
        }
      }
    }
    next();
  });
}

export default tenantPlugin;
