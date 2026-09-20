/**
 * 表单校验 Schema（zod + react-hook-form）
 * ------------------------------------------------------------------
 * 规则与后端 server/src/validators 保持一致，
 * 前端先拦一道，后端仍是最终权威。
 */
import { z } from 'zod';
import {
  CUSTOMER_PRIORITY_VALUES,
  CUSTOMER_STATUS_VALUES,
  EMAIL_PATTERN,
  FOLLOW_UP_METHOD_VALUES,
  FOLLOW_UP_RESULT_VALUES,
  QUOTATION_CURRENCY_VALUES,
  QUOTATION_STATUS_VALUES,
  TEMPLATE_CATEGORY_VALUES,
  USER_ROLE_VALUES,
} from '@/constants';

/* ---------------------------- 登录 ---------------------------- */

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, '请输入用户名')
    .max(60, '用户名过长'),
  password: z.string().min(1, '请输入密码').max(128, '密码过长'),
  /** 在本地记住用户名（不记密码） */
  remember: z.boolean().optional(),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

/* ---------------------------- 客户 ---------------------------- */

/** 可选文本：允许留空，非空时限制长度 */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}不能超过 ${max} 个字符`)
    .optional()
    .or(z.literal(''));

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, '客户姓名为必填项').max(120, '客户姓名不能超过 120 个字符'),
  company: optionalText(200, '公司名称'),
  email: z
    .string()
    .trim()
    .max(200, '邮箱过长')
    .refine((value) => value === '' || EMAIL_PATTERN.test(value), { message: '邮箱格式不正确' })
    .optional()
    .or(z.literal('')),
  phone: optionalText(60, '手机号'),
  title: optionalText(120, '职位'),
  industry: optionalText(120, '行业'),
  address: optionalText(500, '地址'),
  country: optionalText(120, '国家/地区'),
  website: optionalText(300, '官网'),
  grade: optionalText(20, '客户等级'),
  notes: optionalText(5000, '备注'),
  // 联系渠道（Email / Phone 之外）
  whatsapp: optionalText(200, 'WhatsApp'),
  skype: optionalText(200, 'Skype'),
  linkedin: optionalText(300, 'LinkedIn'),
  facebook: optionalText(300, 'Facebook'),
  instagram: optionalText(300, 'Instagram'),
  // 产品 / 需求信息
  interestedProducts: optionalText(500, '感兴趣产品'),
  productModel: optionalText(200, '产品型号'),
  productCategory: optionalText(200, '产品分类'),
  expectedQuantity: optionalText(120, '预计采购数量'),
  targetPrice: optionalText(120, '目标价格'),
  moq: optionalText(120, 'MOQ'),
  requirementNotes: optionalText(5000, '需求备注'),
  // 业务来源（Select，但允许保留自定义值）+ 跟进优先级
  leadSource: optionalText(120, '来源'),
  priority: z.enum(CUSTOMER_PRIORITY_VALUES, {
    errorMap: () => ({ message: '请选择跟进优先级' }),
  }),
  status: z.enum(CUSTOMER_STATUS_VALUES, {
    errorMap: () => ({ message: '请选择客户状态' }),
  }),
  /** 负责人用户 id（'' 表示未分配） */
  ownerId: z.string().trim().max(24).optional().or(z.literal('')),
  /** 下一次跟进时间（date input 的 yyyy-MM-dd，'' 表示未设置） */
  nextFollowUpAt: z.string().trim().max(40).optional().or(z.literal('')),
  /** 以逗号分隔的字符串形式编辑，提交前转数组 */
  tagsText: z.string().trim().max(600, '标签内容过长').optional().or(z.literal('')),
});
export type CustomerFormValues = z.infer<typeof customerFormSchema>;

/** 标签字符串 → 数组（去重、限长） */
export function parseTagsText(text?: string): string[] {
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(/[,，、;；|]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= 40),
    ),
  ).slice(0, 30);
}

export const defaultCustomerFormValues: CustomerFormValues = {
  name: '',
  company: '',
  email: '',
  phone: '',
  title: '',
  industry: '',
  address: '',
  country: '',
  website: '',
  grade: '',
  notes: '',
  whatsapp: '',
  skype: '',
  linkedin: '',
  facebook: '',
  instagram: '',
  interestedProducts: '',
  productModel: '',
  productCategory: '',
  expectedQuantity: '',
  targetPrice: '',
  moq: '',
  requirementNotes: '',
  leadSource: '',
  priority: 'medium',
  status: 'pending',
  ownerId: '',
  nextFollowUpAt: '',
  tagsText: '',
};

/* ---------------------------- 开发信 ---------------------------- */

/** 去掉 HTML 标签后是否还有内容 */
const hasVisibleText = (html: string): boolean =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;

export const sendLetterSchema = z.object({
  subject: z.string().trim().min(1, '邮件主题为必填项').max(300, '邮件主题不能超过 300 个字符'),
  content: z
    .string()
    .min(1, '开发信正文不能为空')
    .max(100000, '开发信正文过长')
    .refine(hasVisibleText, { message: '开发信正文不能为空' }),
  recipientEmail: z
    .string()
    .trim()
    .refine((value) => EMAIL_PATTERN.test(value), { message: '收件人邮箱格式不正确' }),
  markAsDeveloped: z.boolean(),
  saveAsDraft: z.boolean().optional(),
});
export type SendLetterFormValues = z.infer<typeof sendLetterSchema>;

/* ---------------------------- 跟进记录 ---------------------------- */

/**
 * 跟进记录表单：方式 / 内容 / 结果 / 本次跟进时间 / 下一次跟进时间。
 * 时间字段沿用 date input 的 yyyy-MM-dd 字符串，空串表示未设置。
 */
export const followUpFormSchema = z.object({
  method: z.enum(FOLLOW_UP_METHOD_VALUES, { errorMap: () => ({ message: '请选择跟进方式' }) }),
  content: z
    .string()
    .trim()
    .min(1, '跟进内容不能为空')
    .max(5000, '跟进内容不能超过 5000 个字符'),
  result: z.enum(FOLLOW_UP_RESULT_VALUES, { errorMap: () => ({ message: '请选择跟进结果' }) }),
  followUpAt: z.string().trim().max(40).optional().or(z.literal('')),
  nextFollowUpAt: z.string().trim().max(40).optional().or(z.literal('')),
});
export type FollowUpFormValues = z.infer<typeof followUpFormSchema>;

/** 今天（本地时区）的 yyyy-MM-dd，作为跟进时间默认值 */
function todayInputDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export const defaultFollowUpFormValues: FollowUpFormValues = {
  method: 'email',
  content: '',
  result: 'no_reply',
  followUpAt: todayInputDate(),
  nextFollowUpAt: '',
};

/* ---------------------------- 报价单（V2 报价管理） ---------------------------- */

/**
 * 报价明细行表单：只接收 productName / model / quantity / unitPrice。
 * amount 不在表单里 —— 行金额与总金额前端即时算给用户看，提交后由后端再算一次为准。
 * quantity / unitPrice 用 z.coerce.number 兼容 number 输入框回传的字符串。
 */
export const quotationItemFormSchema = z.object({
  productName: z.string().trim().min(1, '产品名称为必填项').max(200, '产品名称不能超过 200 个字符'),
  model: z.string().trim().max(200, '型号不能超过 200 个字符').optional().or(z.literal('')),
  quantity: z.coerce.number().positive('数量必须大于 0').max(1_000_000_000, '数量过大'),
  unitPrice: z.coerce.number().min(0, '单价不能为负数').max(1_000_000_000, '单价过大'),
});

/**
 * 报价单表单：编号 / 标题 / 明细 / 币种 / 状态 / 有效期 / 付款方式 / 交期 / MOQ / 备注。
 * 规则与后端 quotation.validator 保持一致（前端先拦一道，后端仍是最终权威）。
 * 编号留空则由后端按 QT-YYYYMMDD-NNN 生成；正则用 * 允许空串。
 */
export const quotationFormSchema = z.object({
  quotationNo: z
    .string()
    .trim()
    .max(60, '报价单编号不能超过 60 个字符')
    .regex(/^[A-Za-z0-9._-]*$/, '编号只能包含字母、数字、点、下划线和连字符')
    .optional()
    .or(z.literal('')),
  title: z.string().trim().min(1, '报价标题为必填项').max(200, '报价标题不能超过 200 个字符'),
  currency: z.enum(QUOTATION_CURRENCY_VALUES, { errorMap: () => ({ message: '请选择币种' }) }),
  status: z.enum(QUOTATION_STATUS_VALUES, { errorMap: () => ({ message: '请选择状态' }) }),
  validityDate: z.string().trim().max(40).optional().or(z.literal('')),
  paymentTerms: optionalText(300, '付款方式'),
  leadTime: optionalText(200, '交期'),
  moq: optionalText(120, 'MOQ'),
  notes: optionalText(5000, '备注'),
  items: z
    .array(quotationItemFormSchema)
    .min(1, '报价明细至少需要一行产品')
    .max(200, '报价明细最多 200 行'),
  /** 显式联动：保存后把客户推进到「报价中」（仅新增 / 改状态时用，普通编辑不勾选） */
  markCustomerAsQuoting: z.boolean(),
});
export type QuotationFormValues = z.infer<typeof quotationFormSchema>;

export const defaultQuotationFormValues: QuotationFormValues = {
  quotationNo: '',
  title: '',
  currency: 'USD',
  status: 'draft',
  validityDate: '',
  paymentTerms: '',
  leadTime: '',
  moq: '',
  notes: '',
  items: [{ productName: '', model: '', quantity: 1, unitPrice: 0 }],
  markCustomerAsQuoting: false,
};

/* ---------------------------- 开发信模板 ---------------------------- */

/**
 * 模板表单：名称 / 主题 / 正文（富文本 HTML）/ 分类。
 * 正文与发送开发信一致：去掉标签后仍需有可见内容。
 */
export const templateFormSchema = z.object({
  name: z.string().trim().min(1, '模板名称为必填项').max(120, '模板名称不能超过 120 个字符'),
  subject: z.string().trim().min(1, '模板主题为必填项').max(300, '模板主题不能超过 300 个字符'),
  content: z
    .string()
    .min(1, '模板正文不能为空')
    .max(100000, '模板正文过长')
    .refine(hasVisibleText, { message: '模板正文不能为空' }),
  category: z.enum(TEMPLATE_CATEGORY_VALUES, { errorMap: () => ({ message: '请选择模板分类' }) }),
});
export type TemplateFormValues = z.infer<typeof templateFormSchema>;

export const defaultTemplateFormValues: TemplateFormValues = {
  name: '',
  subject: '',
  content: '',
  category: 'first_contact',
};

/* ---------------------------- 导入设置 ---------------------------- */

export const importOptionsSchema = z.object({
  onDuplicate: z.enum(['skip', 'update']),
  defaultStatus: z.enum(CUSTOMER_STATUS_VALUES),
});
export type ImportOptionsValues = z.infer<typeof importOptionsSchema>;

/* ---------------------------- 用户管理 ---------------------------- */

/**
 * 新建用户表单：用户名 / 密码 / 显示名 / 角色。
 * 规则与后端 server/src/validators/user.validator.ts 保持一致（前端先拦一道）。
 */
export const userFormSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, '用户名至少 3 个字符')
    .max(40, '用户名最多 40 个字符')
    .regex(/^[a-zA-Z0-9._-]+$/, '用户名只能包含字母、数字、点、下划线、连字符'),
  password: z.string().min(6, '密码至少 6 位').max(72, '密码最多 72 位'),
  displayName: z.string().trim().max(80, '显示名最多 80 个字符').optional().or(z.literal('')),
  role: z.enum(USER_ROLE_VALUES, { errorMap: () => ({ message: '请选择角色' }) }),
  projectIds: z.array(z.string()).default([]),
}).superRefine((value, ctx) => {
  if (value.role === 'user' && value.projectIds.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['projectIds'], message: '业务员至少需要加入一个项目' });
});
export type UserFormValues = z.infer<typeof userFormSchema>;

export const defaultUserFormValues: UserFormValues = {
  username: '',
  password: '',
  displayName: '',
  role: 'user',
  projectIds: [],
};

/**
 * 编辑用户表单：仅显示名 + 角色（用户名只读、密码走「重置密码」）。
 * 保留 username / password 字段以复用 UserFormValues 类型，但不对其做校验。
 */
export const editUserFormSchema = z.object({
  username: z.string(),
  password: z.string(),
  displayName: z.string().trim().max(80, '显示名最多 80 个字符').optional().or(z.literal('')),
  role: z.enum(USER_ROLE_VALUES, { errorMap: () => ({ message: '请选择角色' }) }),
  projectIds: z.array(z.string()).default([]),
});

/** 重置密码表单：仅一个新密码字段 */
export const resetPasswordFormSchema = z.object({
  password: z.string().min(6, '密码至少 6 位').max(72, '密码最多 72 位'),
});
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export const defaultResetPasswordFormValues: ResetPasswordFormValues = {
  password: '',
};
