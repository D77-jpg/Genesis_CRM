/**
 * Central audit trail writer and query service.
 *
 * Audit failures must never make a business request fail, so writes are
 * best-effort and logged without request content or credentials.
 */
import { Types } from 'mongoose';
import type { Request } from 'express';
import { AuditLog, type AuditAction } from '../models';
import { createLogger } from '../config/logger';
import { buildPaginated, type Paginated } from '../utils/pagination';

const logger = createLogger('audit');

export type AuditActor = {
  id?: string;
  username?: string;
  role?: 'admin' | 'user';
};

export interface AuditEvent {
  actor?: AuditActor | null;
  /** Used for failed logins where no user document can be resolved. */
  actorUsername?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  success?: boolean;
  projectId?: string;
  detail?: Record<string, unknown>;
  request?: Request;
}

export interface AuditLogDto {
  id: string;
  actorId?: string;
  actorUsername?: string;
  actorRole?: 'admin' | 'user';
  projectId?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  success: boolean;
  requestId?: string;
  ip?: string;
  detail: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function objectId(value?: string): Types.ObjectId | undefined {
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

/** Request metadata is limited to routing context; no headers or bodies. */
export function auditRequestContext(req?: Request): { requestId?: string; ip?: string } {
  if (!req) return {};
  const requestId = typeof req.res?.locals?.requestId === 'string' ? req.res.locals.requestId : undefined;
  return {
    requestId,
    ip: req.ip?.slice(0, 64),
  };
}

/**
 * Record one audit event. Returns after the write attempt but never rejects.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    const request = auditRequestContext(event.request);
    const actorId = objectId(event.actor?.id);
    const projectId = objectId(event.projectId ?? event.request?.user?.projectId);
    await AuditLog.create({
      ...(actorId ? { actorId } : {}),
      ...(event.actor?.username || event.actorUsername
        ? { actorUsername: (event.actor?.username ?? event.actorUsername)?.slice(0, 80) }
        : {}),
      ...(event.actor?.role ? { actorRole: event.actor.role } : {}),
      ...(projectId ? { projectId } : {}),
      action: event.action,
      ...(event.targetType ? { targetType: event.targetType.slice(0, 40) } : {}),
      ...(event.targetId ? { targetId: event.targetId.slice(0, 80) } : {}),
      success: event.success ?? true,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...(request.ip ? { ip: request.ip } : {}),
      detail: event.detail && typeof event.detail === 'object' ? event.detail : {},
    });
  } catch (error) {
    logger.warn('audit_write_failed', { code: 'AUDIT_WRITE_FAILED' });
  }
}

export interface AuditLogQuery {
  page: number;
  limit: number;
  action?: AuditAction;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

function toDto(doc: Record<string, unknown>): AuditLogDto {
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: Types.ObjectId };
  return {
    ...rest,
    id: _id.toString(),
    actorId: rest.actorId ? String(rest.actorId) : undefined,
    projectId: rest.projectId ? String(rest.projectId) : undefined,
    detail: (rest.detail as Record<string, unknown>) ?? {},
  } as AuditLogDto;
}

/** Admin-only query with bounded pagination. */
export async function listAuditLogs(query: AuditLogQuery): Promise<Paginated<AuditLogDto>> {
  const filter: Record<string, unknown> = {};
  if (query.action) filter.action = query.action;
  if (query.actorId && Types.ObjectId.isValid(query.actorId)) filter.actorId = new Types.ObjectId(query.actorId);
  if (query.targetType) filter.targetType = query.targetType;
  if (query.targetId) filter.targetId = query.targetId;
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const [docs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return buildPaginated(docs.map((doc) => toDto(doc as unknown as Record<string, unknown>)), total, query.page, query.limit);
}
