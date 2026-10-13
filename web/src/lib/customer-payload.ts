import type { CustomerInput } from '@/types';
import { parseTagsText, type CustomerFormValues } from './validators';

/** 行内编辑同样必须发送空字符串，不能省略已清空的字段。 */
export function customerTextPatch(field: keyof CustomerInput, raw: string): Partial<CustomerInput> {
  return { [field]: raw.trim() };
}

/** 表单值 → 接口载荷（保留显式空串，允许清空已保存的可选字段） */
export function toCustomerPayload(values: CustomerFormValues): CustomerInput {
  const text = (value?: string): string => value?.trim() ?? '';

  return {
    name: values.name.trim(),
    company: text(values.company),
    email: text(values.email)?.toLowerCase(),
    phone: text(values.phone),
    title: text(values.title),
    industry: text(values.industry),
    address: text(values.address),
    country: text(values.country),
    website: text(values.website),
    grade: text(values.grade),
    notes: text(values.notes),
    whatsapp: text(values.whatsapp),
    skype: text(values.skype),
    linkedin: text(values.linkedin),
    facebook: text(values.facebook),
    instagram: text(values.instagram),
    interestedProducts: text(values.interestedProducts),
    productModel: text(values.productModel),
    productCategory: text(values.productCategory),
    expectedQuantity: text(values.expectedQuantity),
    targetPrice: text(values.targetPrice),
    moq: text(values.moq),
    requirementNotes: text(values.requirementNotes),
    leadSource: text(values.leadSource),
    priority: values.priority,
    status: values.status,
    // 负责人 / 下次跟进：空值统一传 null（编辑时表示清除，后端会保留 null 而不跳过）
    ownerId: values.ownerId?.trim() ? values.ownerId.trim() : null,
    nextFollowUpAt: values.nextFollowUpAt?.trim() ? values.nextFollowUpAt.trim() : null,
    tags: parseTagsText(values.tagsText),
  };
}

