import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Types, type PipelineStage } from 'mongoose';
import { z } from 'zod';
import env from '../config/env';
import { Product, Project, ProjectPlaybook } from '../models';
import { KnowledgeDocument } from '../models/KnowledgeDocument';
import { IntegrationPublicResource } from '../models/IntegrationPublicResource';
import { getTenantContext } from '../models/tenant-context';
import { ApiError } from '../utils/ApiError';
import type { ReadFeedQuery } from '../validators/integration-read.validator';
import { getObject, signStorageCapability, verifyStorageCapability } from './storage.service';
import { imageMime, type PublicImage } from './integration-publication.service';

type Kind = 'product' | 'company' | 'playbook' | 'knowledge';
interface Context { credentialId: string; projectId: string }
type Row = Record<string, any>; // Mongo aggregate projection, restricted by each serializer below.
const nullable = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
function organization(): string {
  const tenant = getTenantContext();
  if (!tenant?.organizationId || tenant.bypass) throw ApiError.projectMismatch();
  return tenant.organizationId;
}
function scope(ctx: Context) {
  return { projectId: new Types.ObjectId(ctx.projectId), organizationId: new Types.ObjectId(organization()) };
}
const cursorSchema = z.object({
  v: z.literal(1), credential: z.string(), project: z.string(), organization: z.string(), kind: z.string(),
  since: z.string(), until: z.string().datetime(), last: z.string().datetime(), id: z.string().regex(/^[a-f0-9]{24}$/),
  expires: z.number().int(),
}).strict();
function signature(body: string): string {
  return createHmac('sha256', env.JWT_SECRET).update('integration-read-cursor.v1\0').update(body).digest('hex');
}
function decodeCursor(value: string) {
  try {
    const parts = value.split('.');
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) throw Error();
    if (!timingSafeEqual(Buffer.from(signature(parts[0]), 'hex'), Buffer.from(parts[1], 'hex'))) throw Error();
    const data = cursorSchema.parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
    if (data.expires <= Date.now()) throw Error();
    return data;
  } catch { throw ApiError.validation([{ field: 'query.cursor', message: '游标无效或已过期' }]); }
}
function pageWindow(kind: Kind, ctx: Context, query: ReadFeedQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const org = organization();
  if (cursor && (cursor.kind !== kind || cursor.project !== ctx.projectId || cursor.credential !== ctx.credentialId
    || cursor.organization !== org || (query.updatedSince !== undefined && query.updatedSince !== cursor.since))) {
    throw ApiError.validation([{ field: 'query.cursor', message: '游标范围不匹配' }]);
  }
  return { cursor, since: cursor?.since ?? query.updatedSince ?? '', until: cursor?.until ?? new Date().toISOString(), org };
}

function publicJoin(kind: Kind, ctx: Context): PipelineStage[] {
  const s = scope(ctx);
  return [
    { $lookup: { from: IntegrationPublicResource.collection.name, let: { source: '$_id' }, pipeline: [
      { $match: { ...s, kind, $expr: { $eq: ['$sourceId', '$$source'] } } },
    ], as: 'publicRecords' } },
    { $set: { publication: { $arrayElemAt: ['$publicRecords', 0] } } },
    { $set: { updatedAt: { $max: ['$updatedAt', '$publication.updatedAt'] },
      publicPayload: { $cond: ['$publication.enabled', '$publication.payload', {}] } } },
  ];
}
async function rows(kind: Kind, ctx: Context, stages: PipelineStage[]): Promise<Row[]> {
  const s = scope(ctx);
  if (kind === 'product') return Product.aggregate([{ $match: s }, ...publicJoin(kind, ctx), ...stages]).option({ maxTimeMS: 5000 });
  if (kind === 'company') return Project.aggregate([
    { $match: { _id: s.projectId, organizationId: s.organizationId, status: 'active' } }, ...publicJoin(kind, ctx), ...stages,
  ]).option({ maxTimeMS: 5000 });
  const source = kind === 'playbook' ? ProjectPlaybook : KnowledgeDocument;
  return IntegrationPublicResource.aggregate([
    { $match: { ...s, kind, ...(kind === 'playbook' ? { enabled: true } : {}) } },
    { $lookup: { from: source.collection.name, localField: 'sourceId', foreignField: '_id', as: 'source' } },
    // Enforce both project and organization even against malformed cross-tenant references.
    { $match: { source: { $elemMatch: s } } },
    { $set: { _id: '$sourceId', publicPayload: { $cond: ['$enabled', '$payload', {}] } } }, ...stages,
  ]).option({ maxTimeMS: 5000 });
}
function imageIdentity(ctx: Context, productId: string, image: PublicImage): string {
  return JSON.stringify([organization(), ctx.projectId, ctx.credentialId, productId, image.id, image.key, image.sha256]);
}
function publicImages(ctx: Context, productId: string, images: PublicImage[]) {
  const base = new URL(env.publicBaseUrl);
  if (base.protocol !== 'https:' && !(env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) return [];
  return images.map(image => {
    const expires = Math.floor(Date.now() / 1000) + 300;
    const url = new URL(`${base.toString().replace(/\/$/, '')}/api/integrations/v1/products/${productId}/images/${image.id}`);
    url.search = new URLSearchParams({ expires: String(expires), signature: signStorageCapability(imageIdentity(ctx, productId, image), expires) }).toString();
    return { id: image.id, url: url.toString(), expiresAt: new Date(expires * 1000).toISOString(), mime: image.mime, bytes: image.bytes, sha256: image.sha256 };
  });
}
function serialize(kind: Kind, ctx: Context, row: Row) {
  const id = String(row._id), updatedAt = new Date(row.updatedAt).toISOString();
  const p = row.publicPayload ?? {};
  if (kind === 'product') return {
    id, sku: row.sku, name: row.name, category: nullable(row.category), description: nullable(row.description), status: row.status,
    specs: (row.specs ?? []).map((s: Row) => ({ code: s.code, name: s.name, value: s.value, unit: nullable(s.unit) })),
    material: nullable(p.material), application: nullable(p.application), certifications: strings(p.certifications),
    moq: nullable(row.moq), leadTime: nullable(row.leadTime), images: publicImages(ctx, id, p.images ?? []), updatedAt,
  };
  if (kind === 'company') return {
    id, name: row.companyName, website: nullable(row.website), industry: nullable(row.industry),
    address: nullable(p.address), phone: nullable(p.phone), email: nullable(p.email),
    foundedYear: typeof p.foundedYear === 'number' ? p.foundedYear : null, capacity: nullable(p.capacity),
    certifications: strings(p.certifications), updatedAt,
  };
  if (kind === 'playbook') {
    const published = (items: Row[]) => items.filter(i => i.visibility === 'public').map(i => i.value).filter((v: unknown) => typeof v === 'string');
    return { id, brandPositioning: p.brandPositioning?.visibility === 'public' ? nullable(p.brandPositioning.value) : null,
      sellingPoints: published(p.sellingPoints ?? []), targetMarkets: published(p.targetMarkets ?? []), updatedAt };
  }
  return { id, title: row.enabled ? p.title : '', summary: row.enabled ? p.summary : '', updatedAt, deleted: !row.enabled };
}

export async function listIntegrationRead(kind: Kind, ctx: Context, query: ReadFeedQuery) {
  const w = pageWindow(kind, ctx, query);
  const updatedAt = { ...(w.since ? { $gte: new Date(w.since) } : {}), $lte: new Date(w.until) };
  const result = await rows(kind, ctx, [
    { $match: { updatedAt, ...(w.cursor ? { $or: [
      { updatedAt: { $gt: new Date(w.cursor.last) } },
      { updatedAt: new Date(w.cursor.last), _id: { $gt: new Types.ObjectId(w.cursor.id) } },
    ] } : {}) } },
    { $sort: { updatedAt: 1, _id: 1 } }, { $limit: query.limit + 1 },
  ]);
  const hasMore = result.length > query.limit, page = result.slice(0, query.limit), last = page.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last) {
    const body = Buffer.from(JSON.stringify({ v: 1, credential: ctx.credentialId, project: ctx.projectId,
      organization: w.org, kind, since: w.since, until: w.until, last: new Date(last.updatedAt).toISOString(),
      id: String(last._id), expires: Date.now() + 7 * 86400_000 })).toString('base64url');
    nextCursor = `${body}.${signature(body)}`;
  }
  return { items: page.map(row => serialize(kind, ctx, row)), hasMore, nextCursor, syncUntil: w.until };
}

export async function getIntegrationProduct(ctx: Context, id: string) {
  const result = await rows('product', ctx, [{ $match: { _id: new Types.ObjectId(id) } }, { $limit: 1 }]);
  if (!result.length) throw ApiError.notFound();
  return serialize('product', ctx, result[0]);
}

export async function getIntegrationImage(ctx: Context, productId: string, imageId: string, expires: number, signature: string) {
  const result = await rows('product', ctx, [{ $match: { _id: new Types.ObjectId(productId) } }, { $limit: 1 }]);
  const image = (result[0]?.publicPayload?.images as PublicImage[] | undefined)?.find(i => i.id === imageId);
  if (!image || !verifyStorageCapability(imageIdentity(ctx, productId, image), expires, signature)) throw ApiError.notFound();
  const buffer = await getObject(image.key, 10 * 1024 * 1024);
  if (buffer.length !== image.bytes || imageMime(buffer) !== image.mime
    || createHash('sha256').update(buffer).digest('hex') !== image.sha256) throw ApiError.notFound();
  return { buffer, mime: image.mime };
}
