/**
 * 开发信模板业务逻辑
 * ------------------------------------------------------------------
 * 模板是全局可复用资源：新建 / 编辑 / 删除 / 复制 / 列表（按分类 + 关键词）。
 * 「使用模板创建开发信」是前端行为（把 subject/content 带入发送弹窗），后端不参与。
 */
import { Types } from 'mongoose';
import { LetterTemplate, type LetterTemplateDocument } from '../models';
import type { TemplateCategory } from '../constants';
import { ApiError } from '../utils/ApiError';
import { createLogger } from '../config/logger';
import type {
  CreateTemplateInput,
  ListTemplatesQuery,
  UpdateTemplateInput,
} from '../validators/template.validator';

const logger = createLogger('template-service');

/** 对外输出的模板 DTO：id / createdBy 均为字符串 */
export interface TemplateDto {
  id: string;
  name: string;
  subject: string;
  content: string;
  category: TemplateCategory;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

function toTemplateDto(doc: LetterTemplateDocument): TemplateDto {
  return {
    id: doc.id,
    name: doc.name,
    subject: doc.subject,
    content: doc.content,
    category: doc.category,
    createdBy: doc.createdBy ? String(doc.createdBy) : undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** 列表：可按分类过滤，关键词模糊匹配名称 / 主题；按更新时间倒序 */
export async function listTemplates(query: ListTemplatesQuery = {}): Promise<TemplateDto[]> {
  const filter: Record<string, unknown> = {};
  if (query.category) filter.category = query.category;
  if (query.keyword) {
    const keyword = query.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(keyword, 'i');
    filter.$or = [{ name: regex }, { subject: regex }];
  }
  const docs = await LetterTemplate.find(filter).sort({ updatedAt: -1, createdAt: -1 });
  return docs.map(toTemplateDto);
}

/** 单个模板详情 */
export async function getTemplate(id: string): Promise<TemplateDto> {
  if (!Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('模板 ID 格式不正确');
  }
  const doc = await LetterTemplate.findById(id);
  if (!doc) {
    throw ApiError.notFound(`模板不存在或已被删除（id=${id}）`);
  }
  return toTemplateDto(doc);
}

/** 新建模板 */
export async function createTemplate(input: CreateTemplateInput, userId?: string): Promise<TemplateDto> {
  const doc = await LetterTemplate.create({
    name: input.name,
    subject: input.subject,
    content: input.content,
    category: input.category,
    createdBy: userId ? new Types.ObjectId(userId) : undefined,
  });
  logger.info(`新建开发信模板: id=${doc.id} name=${input.name} category=${input.category}`);
  return toTemplateDto(doc);
}

/** 编辑模板（只改传入的字段） */
export async function updateTemplate(id: string, input: UpdateTemplateInput): Promise<TemplateDto> {
  if (!Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('模板 ID 格式不正确');
  }
  const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const doc = await LetterTemplate.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true });
  if (!doc) {
    throw ApiError.notFound(`模板不存在或已被删除（id=${id}）`);
  }
  logger.info(`更新开发信模板: id=${id}`);
  return toTemplateDto(doc);
}

/** 删除模板 */
export async function deleteTemplate(id: string): Promise<{ id: string; deleted: number }> {
  if (!Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('模板 ID 格式不正确');
  }
  const { deletedCount } = await LetterTemplate.deleteOne({ _id: new Types.ObjectId(id) });
  if (!deletedCount) {
    throw ApiError.notFound('模板不存在或已被删除');
  }
  logger.info(`删除开发信模板: id=${id}`);
  return { id, deleted: deletedCount ?? 0 };
}

/**
 * 复制模板：以现有模板为底稿新建一份，名称追加「副本」。
 * 复制出的模板与源模板彼此独立，改一个不影响另一个。
 */
export async function duplicateTemplate(id: string, userId?: string): Promise<TemplateDto> {
  const source = await LetterTemplate.findById(id);
  if (!source) {
    throw ApiError.notFound(`模板不存在或已被删除（id=${id}）`);
  }
  const copy = await LetterTemplate.create({
    name: `${source.name} 副本`.slice(0, 120),
    subject: source.subject,
    content: source.content,
    category: source.category,
    createdBy: userId ? new Types.ObjectId(userId) : source.createdBy,
  });
  logger.info(`复制开发信模板: from=${id} to=${copy.id}`);
  return toTemplateDto(copy);
}
