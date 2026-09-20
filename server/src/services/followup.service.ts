/**
 * 客户跟进记录业务逻辑
 * ------------------------------------------------------------------
 * 跟进记录支持新增 / 编辑 / 删除（见 updateFollowUp / deleteFollowUp）。
 * 新增或编辑跟进时若填写了「下一次跟进时间」，会同步写回客户主档的 nextFollowUpAt，
 * 形成「记录沟通 → 设置下一次跟进」的闭环。
 */
import { Types } from 'mongoose';
import { Customer, FollowUp, type FollowUpDocument } from '../models';
import type { FollowUpMethod, FollowUpResult } from '../constants';
import { ApiError } from '../utils/ApiError';
import { createLogger } from '../config/logger';
import type { CreateFollowUpInput, UpdateFollowUpInput } from '../validators/followup.validator';

const logger = createLogger('followup-service');

/** 对外输出的跟进记录 DTO：id / customerId 均为字符串 */
export interface FollowUpDto {
  id: string;
  customerId: string;
  method: FollowUpMethod;
  content: string;
  result: FollowUpResult;
  followUpAt: Date;
  nextFollowUpAt?: Date | null;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

function toFollowUpDto(doc: FollowUpDocument): FollowUpDto {
  return {
    id: doc.id,
    customerId: String(doc.customerId),
    method: doc.method,
    content: doc.content,
    result: doc.result,
    followUpAt: doc.followUpAt,
    nextFollowUpAt: doc.nextFollowUpAt ?? null,
    createdBy: doc.createdBy ? String(doc.createdBy) : undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** 新增一条跟进记录 */
export async function createFollowUp(
  customerId: string,
  input: CreateFollowUpInput,
  userId?: string,
  projectId?: string,
): Promise<FollowUpDto> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  if (!projectId || !Types.ObjectId.isValid(projectId)) throw ApiError.notFound('项目不存在或无权访问');
  const projectOid = new Types.ObjectId(projectId);
  const customer = await Customer.findOne({ _id: customerId, projectId: projectOid }).select('_id');
  if (!customer) {
    throw ApiError.notFound(`客户不存在或已被删除（id=${customerId}）`);
  }

  const followUp = await FollowUp.create({
    projectId: projectOid,
    customerId: customer._id,
    method: input.method,
    content: input.content,
    result: input.result,
    followUpAt: input.followUpAt ?? new Date(),
    nextFollowUpAt: input.nextFollowUpAt,
    createdBy: userId ? new Types.ObjectId(userId) : undefined,
  });

  // 跟进时填了下一次跟进时间，就同步到客户主档（列表 / 详情 / Dashboard 口径一致）
  if (input.nextFollowUpAt) {
    await Customer.updateOne({ _id: customer._id }, { $set: { nextFollowUpAt: input.nextFollowUpAt } });
  }

  logger.info(`新增跟进记录: customer=${customerId} method=${input.method} result=${input.result}`);
  return toFollowUpDto(followUp);
}

/**
 * 编辑一条跟进记录（必须属于该客户）。
 * 只 $set 明确提供的字段；若改动了「下一次跟进时间」，同步写回客户主档。
 */
export async function updateFollowUp(
  customerId: string,
  followUpId: string,
  input: UpdateFollowUpInput,
  projectId?: string,
): Promise<FollowUpDto> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  if (!Types.ObjectId.isValid(followUpId)) {
    throw ApiError.badRequest('跟进记录 ID 格式不正确');
  }
  if (!projectId || !Types.ObjectId.isValid(projectId)) throw ApiError.notFound('项目不存在或无权访问');

  // 只 $set 明确提供的字段；undefined 表示保持原值
  const patch: Record<string, unknown> = {};
  if (input.method !== undefined) patch.method = input.method;
  if (input.content !== undefined) patch.content = input.content;
  if (input.result !== undefined) patch.result = input.result;
  if (input.followUpAt !== undefined) patch.followUpAt = input.followUpAt;

  // nextFollowUpAt：null = 显式清除，Date = 设置；未传（undefined）= 不改动
  const touchNext = input.nextFollowUpAt !== undefined;
  if (touchNext) patch.nextFollowUpAt = input.nextFollowUpAt;

  // 双条件（_id + customerId）防止越权改到别的客户的跟进记录
  const followUp = await FollowUp.findOneAndUpdate(
    { _id: new Types.ObjectId(followUpId), customerId: new Types.ObjectId(customerId), projectId: new Types.ObjectId(projectId) },
    { $set: patch },
    { new: true, runValidators: true },
  );
  if (!followUp) {
    throw ApiError.notFound('跟进记录不存在或无权修改');
  }

  // 编辑了下一次跟进时间 → 同步到客户主档（列表 / 详情 / Dashboard 口径一致）
  if (touchNext) {
    await Customer.updateOne(
      { _id: new Types.ObjectId(customerId), projectId: new Types.ObjectId(projectId) },
      { $set: { nextFollowUpAt: input.nextFollowUpAt ?? null } },
    );
  }

  logger.info(`编辑跟进记录: customer=${customerId} followUp=${followUpId}`);
  return toFollowUpDto(followUp);
}

/** 拉取某客户的全部跟进记录（按跟进时间倒序，最新的在最前） */
export async function listFollowUps(customerId: string, limit = 200, projectId?: string): Promise<FollowUpDto[]> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  if (!projectId || !Types.ObjectId.isValid(projectId)) throw ApiError.notFound('项目不存在或无权访问');
  const docs = await FollowUp.find({ customerId: new Types.ObjectId(customerId), projectId: new Types.ObjectId(projectId) })
    .sort({ followUpAt: -1, createdAt: -1 })
    .limit(limit);
  return docs.map(toFollowUpDto);
}

/** 删除一条跟进记录（必须属于该客户，避免越权删别人的记录） */
export async function deleteFollowUp(
  customerId: string,
  followUpId: string,
  projectId?: string,
): Promise<{ id: string; deleted: number }> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  if (!Types.ObjectId.isValid(followUpId)) {
    throw ApiError.badRequest('跟进记录 ID 格式不正确');
  }
  if (!projectId || !Types.ObjectId.isValid(projectId)) throw ApiError.notFound('项目不存在或无权访问');
  const { deletedCount } = await FollowUp.deleteOne({
    _id: new Types.ObjectId(followUpId),
    customerId: new Types.ObjectId(customerId),
    projectId: new Types.ObjectId(projectId),
  });
  if (!deletedCount) {
    throw ApiError.notFound('跟进记录不存在或已被删除');
  }
  logger.info(`删除跟进记录: customer=${customerId} followUp=${followUpId}`);
  return { id: followUpId, deleted: deletedCount ?? 0 };
}
