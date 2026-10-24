import {createCustomerSchema} from '../../validators/customer.validator';
import {cleanCompanyName} from '../../utils/company-name';
import type {RawLead} from './lead-source';

type ImportedFields = {grade?:string;priority?:string;notes?:string;leadSource?:string;source?:'serper'|'excel'};

export function prospectCustomerInput(prospect:RawLead&{emails:string[];score:number}&ImportedFields){
 const text=(value:string|undefined,max:number)=>value?.trim().slice(0,max)||undefined;
 // A search result headline ("Top 30 ...") is not a person's or company's name.
 const rawCompany=text(prospect.company,200)||prospect.domain;
 // 官网没给公司名时会退化成 <title>（"Colonial Candle: Dinner Candles, Wax …"），
 // 转客户前先收缩成品牌段，客户名/公司名才不会被一串 SEO 词占满
 const company=cleanCompanyName(rawCompany)||rawCompany;
 const legacyHeadline=rawCompany===prospect.name&&/^(?:top\s+\d+|\d+\s+(?:best|top))\b/i.test(rawCompany);
 const isExcel=prospect.source==='excel';
 const priorityLabel=prospect.priority==='high'?'高':prospect.priority==='low'?'低':prospect.priority==='medium'?'中':'';
 // Excel 线索没有抓取过程，不能套「搜索摘要 / 官网简介」那套说法
 const notes=isExcel
  ?[
    'Excel 导入线索 · 评分 '+prospect.score+'/100'+(prospect.grade?' · 等级 '+prospect.grade:'')+(priorityLabel?' · 优先级 '+priorityLabel:''),
    prospect.leadSource?'业务来源：'+prospect.leadSource:'',
    prospect.notes?.trim()?'备注：'+prospect.notes.trim():'',
   ].filter(Boolean).join('\n').slice(0,5000)
  :[
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
  status:'pending',
  priority:(prospect.priority==='high'||prospect.priority==='medium'||prospect.priority==='low')?prospect.priority:'medium',
  leadSource:text(prospect.leadSource,120)??(prospect.source==='excel'?'Excel 导入':'今日开发'),
  grade:text(prospect.grade,20),
  tags:[prospect.source==='excel'?'Excel 导入':'自动开发'],
  notes,
 });
}
