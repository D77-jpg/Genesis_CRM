/**
 * Request-scoped tenant context.
 *
 * Every authenticated request runs inside this AsyncLocalStorage scope. The
 * Mongoose tenant plugin reads it and adds `organizationId` to all business
 * queries, so a forgotten filter in one service cannot leak another tenant's
 * records. Platform administrators run with `bypass: true`; anonymous public
 * endpoints (tracking, unsubscribe) run without a context and must scope by
 * project/document explicitly.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Types } from 'mongoose';

export interface TenantContext {
  organizationId?: string;
  /** Platform operators intentionally cross tenant boundaries. */
  bypass?: boolean;
  /** Diagnostic label used by tests and audit logs. */
  source?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function currentOrganizationId(): Types.ObjectId | undefined {
  const value = storage.getStore()?.organizationId;
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

export function tenantBypass(): boolean {
  return storage.getStore()?.bypass === true;
}
