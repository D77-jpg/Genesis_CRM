import { z } from 'zod';
import { Customer } from '../../models';
import { customerScope } from '../../utils/access';
import type { AuthUser } from '../../types/express';
export const customerSearchArgs = z.object({query: z.string().trim().min(1).max(120)}).strict();
export async function searchAgentCustomers(input: unknown, actor: AuthUser) {
 const {query} = customerSearchArgs.parse(input);
 const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 const items = await Customer.find({...customerScope(actor), $or: ['name','company','email'].map(key => ({[key]: {$regex: pattern, $options: 'i'}}))})
  .select('_id name company email').sort({name: 1, _id: 1}).limit(11).lean();
 return {exactMatchIds:items.slice(0,10).filter(c=>[c.name,c.company,c.email].some(v=>v?.toLocaleLowerCase()===query.toLocaleLowerCase())).map(c=>String(c._id)),items: items.slice(0,10).map(c => ({id: String(c._id), name: c.name, company: c.company})), truncated: items.length > 10};
}
