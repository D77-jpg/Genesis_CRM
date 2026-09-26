/**
 * 客户附件（CustomerAttachment）相关请求校验
 */
import { z } from 'zod';
import { objectIdSchema } from './common';

/** 路径参数：客户 id + 附件 id（下载 / 删除单个附件用） */
export const attachmentIdParamsSchema = z.object({
  id: objectIdSchema,
  attachmentId: objectIdSchema,
});

/**
 * 上传附件：文件内容以 base64 字符串随 JSON 提交（复用现有 express.json 通道，
 * 不引入 multipart 依赖）。dataBase64 允许带 dataURL 前缀，服务端会剥离。
 */
export const createAttachmentSchema = z.object({
  originalName: z.string().trim().min(1, '文件名为必填项').max(255, '文件名不能超过 255 个字符')
    .refine((name) => !/[\\/\x00-\x1f\x7f]/.test(name) && name !== '.' && name !== '..' && !name.endsWith('.'), '文件名不得包含路径或控制字符'),
  mimeType: z.string().trim().max(160).optional(),
  dataBase64: z.string().min(1, '文件内容为空'),
});

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;
