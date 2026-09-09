/**
 * Customer 相关请求校验
 */
import { z } from 'zod';
import { CUSTOMER_PRIORITY, CUSTOMER_SOURCE, CUSTOMER_STATUS, MAX_BULK_SIZE, type CustomerPriority } from '../constants';
import {
  idParamsSchema,
  isoDateSchema,
  objectIdSchema,
  optionalEmailSchema,
  optionalText,
  paginationQuerySchema,
} from './common';

const customerStatusSchema = z.enum(CUSTOMER_STATUS, {
  errorMap: () => ({ message: '客户状态取值非法' }),
});

const customerSourceSchema = z.enum(CUSTOMER_SOURCE);

/** 客户跟进优先级：high / medium / low */
const customerPrioritySchema = z.enum(CUSTOMER_PRIORITY, {
  errorMap: () => ({ message: '客户优先级取值非法' }),
});

/**
 * 导入时的优先级：容忍大小写与常见中英文标签（高/中/低、High/Medium/Low），
 * 无法识别的值直接忽略（落库走模型默认 medium），不让整行导入失败。
 */
const priorityImportSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const key = v.toLowerCase();
    if (key === 'high' || key === 'medium' || key === 'low') return key as CustomerPriority;
    const aliasMap: Record<string, CustomerPriority> = {
      高: 'high',
      h: 'high',
      urgent: 'high',
      中: 'medium',
      m: 'medium',
      mid: 'medium',
      normal: 'medium',
      低: 'low',
      l: 'low',
    };
    return aliasMap[key];
  });

/** 状态筛选：全部 + 8 种销售状态 */
const customerStatusFilterSchema = z.enum(['all', ...CUSTOMER_STATUS] as const);

/** 跟进时间筛选：全部 / 今天 / 已逾期 / 未来 */
const followUpFilterSchema = z.enum(['all', 'today', 'overdue', 'upcoming']);

/**
 * 负责人（写入用）：合法 ObjectId 字符串；'' / null 表示清除，不传表示保持原值。
 */
const ownerInputSchema = z
  .union([z.literal(''), z.null(), objectIdSchema])
  .transform((v) => (v === '' ? null : v))
  .optional();

/** 下一次跟进时间（写入用）：ISO → Date；'' / null 表示清除，不传表示保持原值。 */
const nextFollowUpInputSchema = z
  .union([z.literal(''), z.null(), isoDateSchema])
  .transform((v) => (v === '' || v === null ? null : v))
  .optional();

/** 自定义标签：数组本身可为空，但单个标签不允许是空字符串 */
const tagsSchema = z
  .array(z.string().trim().min(1, '标签不能为空').max(40, '单个标签不能超过 40 个字符'))
  .max(30, '标签最多 30 个');

/** 客户可写字段（创建 / 更新共用） */
const customerFields = {
  name: z.string().trim().min(1, '客户姓名为必填项').max(120, '客户姓名不能超过 120 个字符'),
  company: optionalText(200),
  email: optionalEmailSchema,
  phone: optionalText(60),
  title: optionalText(120),
  industry: optionalText(120),
  address: optionalText(500),
  country: optionalText(120),
  website: optionalText(300),
  grade: optionalText(20),
  notes: optionalText(5000),
  // 联系渠道（Email / Phone 之外）
  whatsapp: optionalText(200),
  skype: optionalText(200),
  linkedin: optionalText(300),
  facebook: optionalText(300),
  instagram: optionalText(300),
  // 客户产品 / 需求信息
  interestedProducts: optionalText(500),
  productModel: optionalText(200),
  productCategory: optionalText(200),
  expectedQuantity: optionalText(120),
  targetPrice: optionalText(120),
  moq: optionalText(120),
  requirementNotes: optionalText(5000),
  status: customerStatusSchema,
  // 业务来源：自由字符串（兼容 Excel 导入的历史自定义值），仅做长度约束
  leadSource: optionalText(120),
  // 跟进优先级（更新时可不传表示保持原值）
  priority: customerPrioritySchema,
  // 更新时可以不传，表示保持原值
  tags: tagsSchema.optional(),
  ownerId: ownerInputSchema,
  nextFollowUpAt: nextFollowUpInputSchema,
};

export const createCustomerSchema = z.object({
  ...customerFields,
  // 新建时不传状态默认为待开发
  status: customerStatusSchema.default('pending'),
  // 新建时不传标签默认为空数组（与 Mongoose 模型默认值保持一致）
  tags: tagsSchema.default([]),
  // 新建时不传优先级默认为「中」
  priority: customerPrioritySchema.default('medium'),
  // 手工录入时来源固定为 manual，忽略前端传值
  source: z.literal('manual').optional(),
});

export const updateCustomerSchema = z
  .object({
    ...customerFields,
    source: customerSourceSchema,
    letterCount: z.number().int().min(0),
    lastContactAt: isoDateSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: '请至少提供一个需要修改的字段',
  });

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  /** 关键字：匹配 姓名 / 公司 / 邮箱 / 手机 / 行业 */
  search: z.string().trim().max(200).optional(),
  /** 状态筛选，all 或不传表示全部 */
  status: customerStatusFilterSchema.optional(),
  industry: z.string().trim().max(120).optional(),
  grade: z.string().trim().max(20).optional(),
  source: customerSourceSchema.optional(),
  /** 业务来源筛选（精确匹配自由字符串；'all' / 空 = 不限） */
  leadSource: z.string().trim().max(120).optional(),
  /** 优先级筛选：high / medium / low（'all' = 不限） */
  priority: z.enum(['all', ...CUSTOMER_PRIORITY] as const).optional(),
  /** 只看有邮箱的客户（发开发信的前提） */
  hasEmail: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .optional(),
  createdFrom: isoDateSchema.optional(),
  createdTo: isoDateSchema.optional(),
  /** 标签筛选（精确匹配单个标签） */
  tag: z.string().trim().max(40).optional(),
  /** 负责人筛选：all / unassigned（未分配）/ 具体用户 id */
  ownerId: z
    .union([z.literal(''), z.literal('all'), z.literal('unassigned'), objectIdSchema])
    .optional(),
  /** 跟进时间筛选：today 今天 / overdue 已逾期 / upcoming 未来 */
  followUp: followUpFilterSchema.optional(),
});

export const bulkUpdateStatusSchema = z.object({
  ids: z.array(objectIdSchema).min(1, '请至少选择一个客户').max(MAX_BULK_SIZE, `单次最多处理 ${MAX_BULK_SIZE} 个客户`),
  status: customerStatusSchema,
});

export const bulkDeleteSchema = z.object({
  ids: z.array(objectIdSchema).min(1, '请至少选择一个客户').max(MAX_BULK_SIZE, `单次最多删除 ${MAX_BULK_SIZE} 个客户`),
});

/** 批量操作共用的客户 id 数组（改状态之外的批量动作都用它） */
const bulkIdsSchema = z
  .array(objectIdSchema)
  .min(1, '请至少选择一个客户')
  .max(MAX_BULK_SIZE, `单次最多处理 ${MAX_BULK_SIZE} 个客户`);

/** 批量标签操作的标签数组：至少 1 个，去重后再交给服务层 */
const bulkTagsSchema = z
  .array(z.string().trim().min(1, '标签不能为空').max(40, '单个标签不能超过 40 个字符'))
  .min(1, '请至少提供一个标签')
  .max(30, '单次最多操作 30 个标签')
  .transform((tags) => Array.from(new Set(tags)));

/** 批量添加标签 */
export const bulkAddTagsSchema = z.object({
  ids: bulkIdsSchema,
  tags: bulkTagsSchema,
});

/** 批量删除标签 */
export const bulkRemoveTagsSchema = z.object({
  ids: bulkIdsSchema,
  tags: bulkTagsSchema,
});

/** 批量设置负责人：'' / null 表示清除（未分配） */
export const bulkAssignOwnerSchema = z.object({
  ids: bulkIdsSchema,
  ownerId: z
    .union([z.literal(''), z.null(), objectIdSchema])
    .transform((v) => (v === '' || v === null ? null : v)),
});

/** 批量设置下一次跟进时间：'' / null 表示清除 */
export const bulkSetFollowUpSchema = z.object({
  ids: bulkIdsSchema,
  nextFollowUpAt: z
    .union([z.literal(''), z.null(), isoDateSchema])
    .transform((v) => (v === '' || v === null ? null : v)),
});

/**
 * Excel 导入：单行数据的「严格」校验规则。
 *
 * 注意：它 **不** 在 HTTP 入口生效（入口用的是下方的 looseImportRowSchema），
 * 而是由 customer.service 逐行 safeParse。这样一批数据里混了几行脏数据时，
 * 仍能导入其余合法行，并把问题精确回显到 Excel 行号，而不是整批 400 失败。
 */
const importRowSchema = z.object({
  /** 前端表格中的行号，用于错误定位回显 */
  __row: z.number().int().positive().optional(),
  name: z.string().trim().min(1, '姓名为必填项').max(120, '姓名不能超过 120 个字符'),
  company: optionalText(200),
  email: optionalEmailSchema,
  phone: optionalText(60),
  title: optionalText(120),
  industry: optionalText(120),
  address: optionalText(500),
  country: optionalText(120),
  website: optionalText(300),
  grade: optionalText(20),
  notes: optionalText(5000),
  // 联系渠道
  whatsapp: optionalText(200),
  skype: optionalText(200),
  linkedin: optionalText(300),
  facebook: optionalText(300),
  instagram: optionalText(300),
  // 客户产品 / 需求信息
  interestedProducts: optionalText(500),
  productModel: optionalText(200),
  productCategory: optionalText(200),
  expectedQuantity: optionalText(120),
  targetPrice: optionalText(120),
  moq: optionalText(120),
  requirementNotes: optionalText(5000),
  // 业务来源（自由字符串）+ 优先级（容错映射）
  leadSource: optionalText(120),
  priority: priorityImportSchema,
  status: customerStatusSchema.optional(),
  tags: tagsSchema.optional(),
});

/**
 * 宽松文本：Excel 单元格解析出来可能是数字或布尔值（例如手机号被识别为 number），
 * 统一转成去空格的字符串；null / undefined 视为「未填写」。
 */
const looseText = z
  .union([z.string(), z.number(), z.boolean()])
  .nullish()
  .transform((value) => (value === null || value === undefined ? undefined : String(value).trim()));

/**
 * Excel 导入：HTTP 入口用的「宽松」行结构。
 * 只约束字段大致类型，不做任何业务校验（必填 / 格式 / 长度），
 * 具体的判定统一交给 importRowSchema 在服务层逐行完成。
 */
const looseImportRowSchema = z.object({
  __row: z.number().optional(),
  name: looseText,
  company: looseText,
  email: looseText,
  phone: looseText,
  title: looseText,
  industry: looseText,
  address: looseText,
  country: looseText,
  website: looseText,
  grade: looseText,
  notes: looseText,
  whatsapp: looseText,
  skype: looseText,
  linkedin: looseText,
  facebook: looseText,
  instagram: looseText,
  interestedProducts: looseText,
  productModel: looseText,
  productCategory: looseText,
  expectedQuantity: looseText,
  targetPrice: looseText,
  moq: looseText,
  requirementNotes: looseText,
  leadSource: looseText,
  priority: looseText,
  status: looseText,
  tags: z
    .array(z.union([z.string(), z.number()]).transform((value) => String(value).trim()))
    .nullish()
    .transform((value) => value ?? undefined),
});

export const importCustomersSchema = z.object({
  customers: z
    .array(looseImportRowSchema)
    .min(1, '没有可导入的数据')
    .max(MAX_BULK_SIZE * 5, `单次最多导入 ${MAX_BULK_SIZE * 5} 条数据`),
  /** 邮箱重复时的处理策略：skip 跳过 / update 覆盖更新 */
  onDuplicate: z.enum(['skip', 'update']).default('skip'),
  /** 未指定状态列时的默认状态 */
  defaultStatus: customerStatusSchema.default('pending'),
  /** true 时只做校验不落库，用于导入前预检 */
  dryRun: z.boolean().default(false),
});

/** 入口收到的原始行（尚未逐行校验） */
export type LooseImportRow = z.input<typeof looseImportRowSchema>;

export { idParamsSchema, customerStatusSchema, importRowSchema };

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type ImportCustomersInput = z.infer<typeof importCustomersSchema>;
export type ImportRow = z.infer<typeof importRowSchema>;
export type BulkTagsInput = z.infer<typeof bulkAddTagsSchema>;
export type BulkAssignOwnerInput = z.infer<typeof bulkAssignOwnerSchema>;
export type BulkSetFollowUpInput = z.infer<typeof bulkSetFollowUpSchema>;
