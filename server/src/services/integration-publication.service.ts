import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { Product, Project, ProjectPlaybook } from '../models';
import { KnowledgeDocument } from '../models/KnowledgeDocument';
import { IntegrationPublicResource, type IPublicResource } from '../models/IntegrationPublicResource';
import { runWithTenant } from '../models/tenant-context';
import { publicPayloads } from '../validators/integration-read.validator';
import { getObject } from './storage.service';
import { ApiError } from '../utils/ApiError';

export interface PublicImage {
  id: string; key: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number; sha256: string;
}
export function imageMime(bytes: Buffer): PublicImage['mime'] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Operator-only explicit publication; never called by a service-token HTTP route. */
export async function publishIntegrationResource(input: {
  projectId: string; kind: IPublicResource['kind']; sourceId: string; payload: unknown; reviewed: boolean;
}) {
  if (!input.reviewed) throw ApiError.badRequest('必须明确审核公开资料');
  if (!Types.ObjectId.isValid(input.projectId) || !Types.ObjectId.isValid(input.sourceId)) throw ApiError.badRequest('非法 ID');
  const project = await Project.findOne({ _id: input.projectId, status: 'active' });
  if (!project?.organizationId) throw ApiError.notFound('项目或组织不存在');
  return runWithTenant({ organizationId: String(project.organizationId), source: 'integration-publish' }, async () => {
    const scope = { projectId: project._id, organizationId: project.organizationId };
    const id = new Types.ObjectId(input.sourceId);
    const source = input.kind === 'product' ? await Product.findOne({ ...scope, _id: id })
      : input.kind === 'knowledge' ? await KnowledgeDocument.findOne({ ...scope, _id: id })
      : input.kind === 'playbook' ? await ProjectPlaybook.findOne({ ...scope, _id: id })
      : String(id) === String(project._id) ? project : null;
    if (!source) throw ApiError.notFound('源资料不在该项目内');
    const parsed = publicPayloads[input.kind].safeParse(input.payload);
    if (!parsed.success) throw ApiError.validation([{ field: 'payload', message: '公开字段不合法或包含未允许字段' }]);
    const payload: Record<string, unknown> = { ...parsed.data };
    if (input.kind === 'product') {
      const prior = await IntegrationPublicResource.findOne({ ...scope, kind: input.kind, sourceId: id });
      const old = (prior?.payload.images ?? []) as PublicImage[];
      payload.images = await Promise.all(((parsed.data as { images: { key: string }[] }).images).map(async ({ key }) => {
        const buffer = await getObject(key, 10 * 1024 * 1024);
        const mime = imageMime(buffer);
        if (!mime || buffer.length > 10 * 1024 * 1024) throw ApiError.badRequest('图片格式或大小不合法');
        const sha256 = createHash('sha256').update(buffer).digest('hex');
        return { id: old.find(i => i.key === key && i.sha256 === sha256)?.id ?? String(new Types.ObjectId()), key, mime, bytes: buffer.length, sha256 };
      }));
    }
    return IntegrationPublicResource.findOneAndUpdate(
      { ...scope, kind: input.kind, sourceId: id },
      { $set: { payload, enabled: true }, $setOnInsert: { ...scope } }, { upsert: true, new: true, runValidators: true },
    );
  });
}

export async function revokeIntegrationResource(projectId: string, kind: IPublicResource['kind'], sourceId: string) {
  const project = await Project.findById(projectId);
  if (!project?.organizationId) throw ApiError.notFound();
  return runWithTenant({ organizationId: String(project.organizationId), source: 'integration-revoke' }, async () => {
    // Retain only the tombstone, removing the previously published payload immediately.
    return IntegrationPublicResource.updateOne({ projectId, kind, sourceId }, { $set: { enabled: false, payload: {} } });
  });
}
