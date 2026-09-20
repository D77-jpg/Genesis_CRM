import { Types } from 'mongoose';
import { Scratchpad, type ScratchpadDocument } from '../models';
import type { UpdateScratchpadInput } from '../validators/scratchpad.validator';
import { ApiError } from '../utils/ApiError';

export interface ScratchpadDto {
  content: string;
  version: number;
  updatedAt: Date | null;
}

function scopeFor(userId?: string, projectId?: string): { userId: Types.ObjectId; projectId: Types.ObjectId } {
  if (!userId || !Types.ObjectId.isValid(userId)) throw ApiError.unauthorized();
  if (!projectId || !Types.ObjectId.isValid(projectId)) throw ApiError.notFound('项目不存在或无权访问');
  return { userId: new Types.ObjectId(userId), projectId: new Types.ObjectId(projectId) };
}

function toDto(doc: ScratchpadDocument): ScratchpadDto {
  return { content: doc.content, version: doc.version, updatedAt: doc.updatedAt };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 11000;
}

/** 未创建过随手记时返回空白虚拟版本，避免一次只读请求产生数据库写入。 */
export async function getScratchpad(userId?: string, projectId?: string): Promise<ScratchpadDto> {
  const scope = scopeFor(userId, projectId);
  const doc = await Scratchpad.findOne(scope);
  return doc ? toDto(doc) : { content: '', version: 0, updatedAt: null };
}

/**
 * 乐观并发保存：客户端只有持有当前版本时才能写入。
 * 版本不一致返回 409，前端保留本机内容并让用户决定如何处理。
 */
export async function updateScratchpad(
  input: UpdateScratchpadInput,
  userId?: string,
  projectId?: string,
): Promise<ScratchpadDto> {
  const scope = scopeFor(userId, projectId);

  if (input.expectedVersion === 0) {
    try {
      const created = await Scratchpad.create({ ...scope, content: input.content, version: 1 });
      return toDto(created);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw ApiError.conflict('随手记已在其他页面或设备更新，请重新载入后再保存');
      }
      throw error;
    }
  }

  const updated = await Scratchpad.findOneAndUpdate(
    { ...scope, version: input.expectedVersion },
    { $set: { content: input.content }, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  if (!updated) throw ApiError.conflict('随手记已在其他页面或设备更新，请重新载入后再保存');
  return toDto(updated);
}
