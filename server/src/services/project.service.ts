import { Types } from 'mongoose';
import env from '../config/env';
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

export interface ProjectDto {
  id: string;
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
  status: 'active' | 'archived';
  isDefault: boolean;
  mailChannel?: 'mock' | 'smtp';
}

const dto = (raw: Record<string, unknown>): ProjectDto => ({
  id: String(raw._id), name: String(raw.name), slug: String(raw.slug), code: String(raw.code),
  industry: raw.industry ? String(raw.industry) : undefined,
  companyName: String(raw.companyName), website: raw.website ? String(raw.website) : undefined,
  moq: raw.moq ? String(raw.moq) : undefined, senderName: raw.senderName ? String(raw.senderName) : undefined,
  mailFrom: raw.mailFrom ? String(raw.mailFrom) : undefined, mailProfileKey: String(raw.mailProfileKey),
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
    const project = await Project.create({ ...input, isDefault: false, createdBy: new Types.ObjectId(actor.id) });
    return {
      ...dto(project.toObject() as unknown as Record<string, unknown>),
      mailChannel: await getProjectActiveChannel(String(project._id)),
    };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw ApiError.conflict('项目标识或代码已存在');
    throw error;
  }
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('项目不存在');
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

type ExistingIndex = {
  name?: string;
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

/** 幂等启动迁移：创建两个初始空间，并把 V1-V2.5 历史数据完整归入 Genesis Bags。 */
export async function bootstrapProjects(): Promise<void> {
  const genesis = await Project.findOneAndUpdate(
    { slug: 'genesis-bags' },
    { $setOnInsert: { name: 'Genesis Bags', code: 'GENESIS', industry: '箱包外贸', companyName: env.COMPANY_NAME,
      website: env.COMPANY_WEBSITE, moq: env.COMPANY_MOQ, senderName: env.SENDER_NAME, mailFrom: env.MAIL_FROM,
      mailProfileKey: 'genesis-bags', status: 'active', isDefault: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await Project.findOneAndUpdate(
    { slug: 'ironhue' },
    { $setOnInsert: { name: 'IRONHUE', code: 'IRONHUE', industry: '运动器材外贸', companyName: 'IRONHUE',
      mailProfileKey: 'ironhue', status: 'active', isDefault: false } },
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
