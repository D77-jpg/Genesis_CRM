/**
 * 客户附件业务逻辑
 * ------------------------------------------------------------------
 * 第一版使用「本地 uploads 目录」存储，不引入对象存储 / multipart 依赖：
 *   - 上传：前端把文件读成 base64 随 JSON 提交，服务端解码后以随机名落盘；
 *   - 下载：走带鉴权的接口读取磁盘文件并回传，不做静态托管；
 *   - 权限：严格复用客户数据隔离——controller 先校验客户归属，
 *     service 层再用 { _id, customerId } 双条件兜底，杜绝改 customerId 越权。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import env from '../config/env';
import { CustomerAttachment, type CustomerAttachmentDocument } from '../models';
import { ApiError } from '../utils/ApiError';
import { createLogger } from '../config/logger';
import type { CreateAttachmentInput } from '../validators/attachment.validator';

const logger = createLogger('attachment-service');

/** 对外输出的附件 DTO：只暴露展示所需字段，path / filename 属内部信息不下发 */
export interface AttachmentDto {
  id: string;
  customerId: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy?: string;
  createdAt: Date;
}

/** 下载所需的文件信息 + 内容 */
export interface AttachmentDownload {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

function toAttachmentDto(doc: CustomerAttachmentDocument): AttachmentDto {
  return {
    id: doc.id,
    customerId: String(doc.customerId),
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    uploadedBy: doc.uploadedBy ? String(doc.uploadedBy) : undefined,
    createdAt: doc.createdAt,
  };
}

/** 确保上传目录存在（幂等），返回目录绝对路径 */
function ensureUploadDir(): string {
  const dir = env.UPLOAD_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 从原始文件名里提取安全的扩展名（.xxx）；非法 / 无扩展名返回空串 */
function safeExt(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/** 剥离 dataURL 前缀（data:<mime>;base64,）后解码 base64 */
function decodeBase64(dataBase64: string): Buffer {
  const isDataUrl = dataBase64.startsWith('data:');
  const comma = dataBase64.indexOf(',');
  const raw = isDataUrl && comma > 0 ? dataBase64.slice(comma + 1) : dataBase64;
  return Buffer.from(raw, 'base64');
}

/** 删除磁盘文件（best-effort）：文件本就不存在视为成功，其它错误只记日志不抛出 */
async function unlinkQuietly(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn(`删除附件磁盘文件失败（已忽略）: ${filePath}`, { message: (error as Error).message });
    }
  }
}

/** 拉取某客户的全部附件（按上传时间倒序，最新的在最前） */
export async function listAttachments(customerId: string): Promise<AttachmentDto[]> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  const docs = await CustomerAttachment.find({ customerId: new Types.ObjectId(customerId) }).sort({ createdAt: -1 });
  return docs.map(toAttachmentDto);
}

/** 上传一个附件（base64 → 落盘 → 建记录） */
export async function createAttachment(
  customerId: string,
  input: CreateAttachmentInput,
  userId?: string,
): Promise<AttachmentDto> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }

  const buffer = decodeBase64(input.dataBase64);
  if (buffer.length === 0) {
    throw ApiError.badRequest('文件内容为空或已损坏');
  }
  if (buffer.length > env.MAX_ATTACHMENT_SIZE) {
    const limitMb = Math.round(env.MAX_ATTACHMENT_SIZE / (1024 * 1024));
    throw new ApiError(413, `文件大小超过上限（${limitMb}MB）`, 'PAYLOAD_TOO_LARGE');
  }

  const dir = ensureUploadDir();
  const filename = `${Date.now()}-${randomUUID()}${safeExt(input.originalName)}`;
  const fullPath = path.join(dir, filename);

  try {
    await fsp.writeFile(fullPath, buffer);
  } catch (error) {
    logger.error('写入附件失败', error instanceof Error ? error.message : String(error));
    throw ApiError.internal('附件保存失败，请稍后重试');
  }

  const doc = await CustomerAttachment.create({
    customerId: new Types.ObjectId(customerId),
    originalName: input.originalName,
    filename,
    mimeType: input.mimeType || 'application/octet-stream',
    size: buffer.length,
    path: fullPath,
    uploadedBy: userId ? new Types.ObjectId(userId) : undefined,
  });

  logger.info(`上传客户附件: customer=${customerId} file=${input.originalName} size=${buffer.length}`);
  return toAttachmentDto(doc);
}

/** 读取附件内容用于下载（双条件防越权；文件丢失时给出明确提示） */
export async function getAttachmentForDownload(
  customerId: string,
  attachmentId: string,
): Promise<AttachmentDownload> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  if (!Types.ObjectId.isValid(attachmentId)) {
    throw ApiError.badRequest('附件 ID 格式不正确');
  }
  const doc = await CustomerAttachment.findOne({
    _id: new Types.ObjectId(attachmentId),
    customerId: new Types.ObjectId(customerId),
  });
  if (!doc) {
    throw ApiError.notFound('附件不存在或无权访问');
  }
  let buffer: Buffer;
  try {
    buffer = await fsp.readFile(doc.path);
  } catch {
    throw ApiError.notFound('附件文件已丢失，请重新上传');
  }
  return { originalName: doc.originalName, mimeType: doc.mimeType, size: doc.size, buffer };
}

/** 删除一个附件（双条件防越权；同时清理磁盘文件） */
export async function deleteAttachment(
  customerId: string,
  attachmentId: string,
): Promise<{ id: string; deleted: number }> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  if (!Types.ObjectId.isValid(attachmentId)) {
    throw ApiError.badRequest('附件 ID 格式不正确');
  }
  const doc = await CustomerAttachment.findOneAndDelete({
    _id: new Types.ObjectId(attachmentId),
    customerId: new Types.ObjectId(customerId),
  });
  if (!doc) {
    throw ApiError.notFound('附件不存在或无权删除');
  }
  await unlinkQuietly(doc.path);
  logger.info(`删除客户附件: customer=${customerId} attachment=${attachmentId}`);
  return { id: attachmentId, deleted: 1 };
}

/**
 * 级联清理某些客户的全部附件（DB 记录 + 磁盘文件），供删除客户 / 批量删除时调用。
 * 接受单个 id 或 id 数组；返回删除的记录数。
 */
export async function purgeCustomerAttachments(
  customerIds: Types.ObjectId | Types.ObjectId[],
): Promise<number> {
  const ids = Array.isArray(customerIds) ? customerIds : [customerIds];
  if (ids.length === 0) return 0;
  const filter = Array.isArray(customerIds) ? { customerId: { $in: ids } } : { customerId: customerIds };

  const docs = await CustomerAttachment.find(filter).select('path').lean();
  const { deletedCount } = await CustomerAttachment.deleteMany(filter);
  await Promise.all((docs as unknown as { path: string }[]).map((d) => unlinkQuietly(d.path)));
  return deletedCount ?? 0;
}
