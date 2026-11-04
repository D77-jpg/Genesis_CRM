import mongoose, { Types } from 'mongoose';
import env from '../config/env';
// Side-effect imports: every project-scoped model must be registered before the
// cascade delete enumerates mongoose.models.
import '../models/AgentAutomation';
import '../models/AgentBatch';
import '../models/AgentKnowledge';
import '../models/AgentTask';
import '../models/CustomerAgreement';
import '../models/KnowledgeDocument';
import '../models/KnowledgeIndex';
import '../models/Prospect';
import '../models/ProspectingConfig';
import '../models/ProspectingRun';
import '../models/TemplateSuggestion';
import '../models/WebsiteResearch';
import {
  Customer,
  CustomerAttachment,
  CustomerEvent,
  DevelopmentLetter,
  FollowUp,
  LetterTemplate,
  Project,
  Quotation,
  User,
} from '../models';
import { MailMessage, MailSyncState } from '../models/MailMessage';
import type { AuthUser } from '../types/express';
import { ApiError } from '../utils/ApiError';
import type { CreateProjectInput, UpdateProjectInput } from '../validators/project.validator';
import { getProjectActiveChannel } from './mailer.service';
import { assertOrganizationCapacity, ensureDefaultOrganization } from './organization.service';
import type { ProjectBrandProfile, ProjectMailCompliance } from '../models/Project';

export interface ProjectDto {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  code: string;
  industry?: string;
  companyName: string;
  website?: string;
  moq?: string;
  senderName?: string;
  mailFrom?: string;
  mailProfileKey: string;
  logoImage?: string;
  coverImage?: string;
  brandProfile?: ProjectBrandProfile;
  mailCompliance?: ProjectMailCompliance;
  onboardingCompletedAt?: Date;
  status: 'active' | 'archived';
  isDefault: boolean;
  mailChannel?: 'mock' | 'smtp';
}

const dto = (raw: Record<string, unknown>): ProjectDto => ({
  id: String(raw._id), organizationId: raw.organizationId ? String(raw.organizationId) : undefined, name: String(raw.name), slug: String(raw.slug), code: String(raw.code),
  industry: raw.industry ? String(raw.industry) : undefined,
  companyName: String(raw.companyName), website: raw.website ? String(raw.website) : undefined,
  moq: raw.moq ? String(raw.moq) : undefined, senderName: raw.senderName ? String(raw.senderName) : undefined,
  mailFrom: raw.mailFrom ? String(raw.mailFrom) : undefined, mailProfileKey: String(raw.mailProfileKey),
  logoImage: raw.logoImage ? String(raw.logoImage) : undefined,
  coverImage: raw.coverImage ? String(raw.coverImage) : undefined,
  brandProfile: raw.brandProfile as ProjectBrandProfile | undefined,
  mailCompliance: raw.mailCompliance as ProjectMailCompliance | undefined,
  onboardingCompletedAt: raw.onboardingCompletedAt as Date | undefined,
  status: raw.status as 'active' | 'archived', isDefault: Boolean(raw.isDefault),
});

export async function listProjects(actor: AuthUser): Promise<ProjectDto[]> {
  const user = await User.findById(actor.id).select('role projectIds');
  if (!user) throw ApiError.unauthorized();
  const filter = user.role === 'admin' ? {} : { _id: { $in: user.projectIds }, status: 'active' };
  const projects = await Project.find(filter).sort({ isDefault: -1, name: 1 }).lean();
  return Promise.all(projects.map(async (item) => ({
    ...dto(item as unknown as Record<string, unknown>),
    mailChannel: await getProjectActiveChannel(String(item._id)),
  })));
}

export async function createProject(input: CreateProjectInput, actor: AuthUser): Promise<ProjectDto> {
  try {
    await assertOrganizationCapacity('projects');
    const project = await Project.create({
      ...input,
      ...(actor.organizationId ? { organizationId: new Types.ObjectId(actor.organizationId) } : {}),
      isDefault: false,
      createdBy: new Types.ObjectId(actor.id),
    });
    return {
      ...dto(project.toObject() as unknown as Record<string, unknown>),
      mailChannel: await getProjectActiveChannel(String(project._id)),
    };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw ApiError.conflict('项目标识或代码已存在');
    throw error;
  }
}

export async function updateProject(id: string, input: UpdateProjectInput, actor?: AuthUser): Promise<ProjectDto> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('项目不存在');
  if (actor && actor.role === 'project_admin') {
    const allowed = await User.exists({ _id: actor.id, projectIds: new Types.ObjectId(id) });
    if (!allowed) throw ApiError.notFound('项目不存在或无权修改');
  }
  if (actor && actor.role !== 'admin' && actor.role !== 'project_admin') {
    throw ApiError.forbidden('只有管理员可以修改项目资料');
  }
  if (input.status === 'archived') {
    const existing = await Project.findById(id).select('isDefault');
    if (!existing) throw ApiError.notFound('项目不存在');
    if (existing.isDefault) throw ApiError.badRequest('默认项目不能归档');
  }
  const project = await Project.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
  if (!project) throw ApiError.notFound('项目不存在');
  return {
    ...dto(project.toObject() as unknown as Record<string, unknown>),
    mailChannel: await getProjectActiveChannel(String(project._id)),
  };
}

/**
 * Permanently removes one workspace and every document that carries its
 * projectId. The default project (historical data owner) is never deletable.
 * Registered in app.ts; keep destructive behaviour behind an admin route.
 */
export async function deleteProject(id: string, actor: AuthUser): Promise<{ name: string; deleted: Record<string, number> }> {
  if (actor.role !== 'admin') throw ApiError.forbidden('只有管理员可以删除项目');
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('项目不存在');
  const project = await Project.findById(id).lean();
  if (!project) throw ApiError.notFound('项目不存在');
  if (project.isDefault) throw ApiError.badRequest('默认项目是历史数据归属，不能删除');
  const fallback = await Project.findOne({ isDefault: true, status: 'active' }).select('_id').lean();
  const deleted: Record<string, number> = {};
  for (const model of Object.values(mongoose.models)) {
    if (!model.schema.path('projectId')) continue;
    const result = await model.deleteMany({ projectId: project._id });
    if (result.deletedCount) deleted[model.modelName] = result.deletedCount;
  }
  await User.updateMany({ projectIds: project._id }, { $pull: { projectIds: project._id } });
  if (fallback) await User.updateMany({ defaultProjectId: project._id }, { $set: { defaultProjectId: fallback._id } });
  await Project.deleteOne({ _id: project._id });
  return { name: project.name, deleted };
}

type ExistingIndex = {  name?: string;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

async function dropIndexIfPresent(model: { collection: { indexes(): Promise<ExistingIndex[]>; dropIndex(name: string): Promise<unknown> } }, name: string) {
  try {
    const indexes = await model.collection.indexes();
    if (indexes.some((index) => index.name === name)) await model.collection.dropIndex(name);
  } catch (error) {
    if ((error as { codeName?: string }).codeName !== 'NamespaceNotFound') throw error;
  }
}

/**
 * V2.6 development builds briefly used a sparse compound request-key index.
 * MongoDB cannot replace it with the final partial index while both share the
 * generated name, so remove only that known legacy shape before model init.
 */
async function dropLegacyRequestKeyIndex(): Promise<void> {
  try {
    const indexes = await DevelopmentLetter.collection.indexes() as ExistingIndex[];
    const legacy = indexes.find((index) =>
      index.name === 'projectId_1_requestKey_1'
      && index.sparse === true
      && !index.partialFilterExpression,
    );
    if (legacy?.name) await DevelopmentLetter.collection.dropIndex(legacy.name);
  } catch (error) {
    if ((error as { codeName?: string }).codeName !== 'NamespaceNotFound') throw error;
  }
}

/** 幂等启动迁移：创建三个初始空间，并把 V1-V2.5 历史数据完整归入 Genesis Bags。 */
export async function bootstrapProjects(): Promise<void> {
  const organization = await ensureDefaultOrganization();
  const genesis = await Project.findOneAndUpdate(
    { slug: 'genesis-bags' },
    { $setOnInsert: { organizationId: organization._id, name: 'Genesis Bags', code: 'GENESIS', industry: '箱包外贸', companyName: env.COMPANY_NAME,
      website: env.COMPANY_WEBSITE, moq: env.COMPANY_MOQ, senderName: env.SENDER_NAME, mailFrom: env.MAIL_FROM,
      mailProfileKey: 'genesis-bags', status: 'active', isDefault: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await Project.findOneAndUpdate(
    { slug: 'ironhue' },
    { $setOnInsert: { organizationId: organization._id, name: 'IRONHUE', code: 'IRONHUE', industry: '运动器材外贸', companyName: 'IRONHUE',
      mailProfileKey: 'ironhue', status: 'active', isDefault: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await Project.findOneAndUpdate(
    { slug: 'velaturo' },
    { $setOnInsert: { organizationId: organization._id, name: 'VELATURO', code: 'VELATURO', industry: '手绘艺术与商业空间配画', companyName: 'VELATURO',
      website: 'https://velaturo.com', mailProfileKey: 'velaturo', mailTransport: 'mock', status: 'active', isDefault: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const projectId = genesis._id;
  const scopedModels = [Customer, DevelopmentLetter, FollowUp, CustomerEvent, CustomerAttachment, Quotation, LetterTemplate, MailMessage, MailSyncState];
  for (const model of scopedModels) {
    await model.updateMany({ projectId: { $exists: false } }, { $set: { projectId } });
  }
  await User.updateMany({ $or: [{ projectIds: { $exists: false } }, { projectIds: { $size: 0 } }] }, {
    $set: { defaultProjectId: projectId }, $addToSet: { projectIds: projectId },
  });

  // 旧版全局唯一索引会阻止不同项目使用相同业务编号，迁移后改为项目内唯一。
  await dropIndexIfPresent(Customer, 'email_1');
  await dropIndexIfPresent(Quotation, 'quotationNo_1');
  await dropIndexIfPresent(DevelopmentLetter, 'requestKey_1');
  await dropIndexIfPresent(MailMessage, 'dedupKey_1');
  await dropLegacyRequestKeyIndex();
}
