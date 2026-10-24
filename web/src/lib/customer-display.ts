import type { Customer } from '@/types/models';

/** 比较用的归一化：忽略大小写、多余空白与结尾的省略号 */
function key(value?: string | null): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[.…\s]+$/, '')
    .trim()
    .toLowerCase();
}

/**
 * 潜客自动转来的记录常常抓不到联系人，客户名就直接用了公司名。
 * 这类记录展示时不能把同一个字符串重复两遍，也要明确标出「没联系人」，
 * 否则业务员会以为系统把姓名填错了。
 */
type IdentityFields = Pick<Customer, 'name' | 'company'> & { title?: string | null };

export function isCompanyOnlyCustomer(customer: IdentityFields): boolean {
  const name = key(customer.name);
  if (!name || name !== key(customer.company)) return false;
  // 有职位说明抓到的是真人（很多独立设计师的品牌就叫她本人的名字），
  // 只有「同名且没有任何职位信息」才当成没抓到联系人
  return !(customer.title ?? '').trim();
}

/** 副标题/提示里用的公司名：和客户名重复时返回空串，交给调用方省略 */
export function secondaryCompanyLabel(customer: IdentityFields): string {
  return isCompanyOnlyCustomer(customer) ? '' : (customer.company ?? '').trim();
}
