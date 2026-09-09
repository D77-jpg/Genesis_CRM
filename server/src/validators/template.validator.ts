/**
 * 开发信模板（LetterTemplate）相关请求校验
 * ------------------------------------------------------------------
 * 正文与发送开发信一致：富文本 HTML，去掉标签后仍需有可见内容，
 * 避免存进一个空模板。主题 / 正文同样允许 {{占位符}}。
 */
import { z } from 'zod';
import { TEMPLATE_CATEGORY } from '../constants';
import { idParamsSchema } from './common';

const templateCategorySchema = z.enum(TEMPLATE_CATEGORY, {
  errorMap: () => ({ message: '模板分类取值非法' }),
});

/** 去掉 HTML 标签后是否还有可见内容 */
const hasVisibleText = (html: string): boolean =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;

const nameSchema = z.string().trim().min(1, '模板名称为必填项').max(120, '模板名称不能超过 120 个字符');
const subjectSchema = z.string().trim().min(1, '模板主题为必填项').max(300, '模板主题不能超过 300 个字符');
const contentSchema = z
  .string()
  .min(1, '模板正文不能为空')
  .max(100000, '模板正文过长')
  .refine(hasVisibleText, { message: '模板正文不能为空' });

export const createTemplateSchema = z.object({
  name: nameSchema,
  subject: subjectSchema,
  content: contentSchema,
  category: templateCategorySchema.default('other'),
});

/** 更新：全部字段可选，但至少提供一个；分类若提供则必须合法 */
export const updateTemplateSchema = z
  .object({
    name: nameSchema.optional(),
    subject: subjectSchema.optional(),
    content: contentSchema.optional(),
    category: templateCategorySchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: '请至少提供一个要修改的字段' });

/** 列表查询：可按分类过滤 + 关键词搜索（名称 / 主题） */
export const listTemplatesQuerySchema = z.object({
  category: templateCategorySchema.optional(),
  keyword: z.string().trim().max(120).optional(),
});

export { idParamsSchema, templateCategorySchema };

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
