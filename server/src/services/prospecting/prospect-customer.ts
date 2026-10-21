import {createCustomerSchema} from '../../validators/customer.validator';
import type {RawLead} from './lead-source';

export function prospectCustomerInput(prospect:RawLead&{emails:string[];score:number}){
 const text=(value:string|undefined,max:number)=>value?.trim().slice(0,max)||undefined;
 // A search result headline ("Top 30 ...") is not a person's or company's name.
 const company=text(prospect.company,200)||prospect.domain;
 const legacyHeadline=company===prospect.name&&/^(?:top\s+\d+|\d+\s+(?:best|top))\b/i.test(company);
 const notes=[
  '今日开发候选 · 评分 '+prospect.score+'/100 · 邮箱来源 '+(prospect.emailSource==='hunter'?'Hunter':'官网'),
  '搜索来源：'+prospect.sourceUrl,
  prospect.emails.length>1?'其它公开邮箱：'+prospect.emails.slice(1).join('、'):'',
  ...(prospect.contactSources??[]).map(s=>'资料来源（'+(s.source==='hunter'?'Hunter':'官网')+'）：'+s.url+'；字段 '+s.fields.join('、')),
  prospect.snippet?'搜索摘要（待核实）：'+prospect.snippet:'',
  prospect.excerpt?'官网简介（网站自述，待核实；不是采购需求）：'+prospect.excerpt:'',
 ].filter(Boolean).join('\n').slice(0,5000);
 return createCustomerSchema.parse({
  name:text(prospect.contactName,120)||text(legacyHeadline?prospect.domain:company,120),company:legacyHeadline?prospect.domain:company,
  email:prospect.emails[0],website:prospect.website,country:text(prospect.country,120),title:text(prospect.contactTitle,120),
  phone:text(prospect.phone,60),address:text(prospect.address,500),industry:text(prospect.industry,120),
  instagram:text(prospect.instagram,300),linkedin:text(prospect.linkedin,300),facebook:text(prospect.facebook,300),whatsapp:text(prospect.whatsapp,200),
  status:'pending',priority:'medium',leadSource:'今日开发',tags:['自动开发'],notes,
 });
}
