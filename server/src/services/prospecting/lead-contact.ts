import {Parser} from 'htmlparser2';

export interface LeadContact {
 phone?:string;address?:string;industry?:string;facebook?:string;whatsapp?:string;
 contactSources?:{source:'site'|'hunter';url:string;fields:string[]}[];
}
export const contactText=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max)||undefined:undefined;
export function contactUrl(value:unknown,host:string){
 if(typeof value!=='string')return undefined;
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return undefined;
 const name=url.hostname.toLowerCase().replace(/^www\./,'');
 return (name===host||name.endsWith('.'+host))&&url.pathname!=='/'?url.href.slice(0,300):undefined;
 }catch{return undefined;}
}
export function extractSiteContact(markdown:string,html:string,domain:string){
 const result:{company?:string;country?:string;phone?:string;address?:string;industry?:string;instagram?:string;linkedin?:string;facebook?:string;whatsapp?:string}={};
 const urls=markdown.match(/https?:\/\/[^\s<>"')\]]+/g)??[];
 const social=(host:string)=>urls.map(u=>contactUrl(u,host)).find(Boolean);
 result.instagram=social('instagram.com');result.linkedin=social('linkedin.com');result.facebook=social('facebook.com');result.whatsapp=social('wa.me')??social('api.whatsapp.com');
 const telephone=markdown.match(/tel:([+\d][\d+(). -]{4,55})/i)?.[1];
 const label=(pattern:string,max:number)=>contactText(markdown.match(new RegExp('^(?:\\*{0,2})(?:'+pattern+')(?:\\*{0,2})\\s*[:：]\\s*(.+)$','im'))?.[1],max);
 result.phone=contactText(telephone,60)??label('phone|telephone|电话',60);
 result.address=label('address|地址',500);result.country=label('country|国家',80);result.industry=label('industry|行业',120);
 let script=false,buffer='';const records:unknown[]=[];
 const parser=new Parser({onopentag(name,attrs){if(name==='script'&&attrs.type?.toLowerCase()==='application/ld+json'){script=true;buffer='';}},ontext(value){if(script&&buffer.length<100000)buffer+=value;},onclosetag(name){if(name==='script'&&script){script=false;try{records.push(JSON.parse(buffer));}catch{/* Malformed structured data is not a fact. */}}}});
 parser.write(html.slice(0,500000));parser.end();
 function visit(value:unknown,depth=0){
  if(depth>8||!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.slice(0,40).forEach(v=>visit(v,depth+1));return;}
  const row=value as Record<string,unknown>;if(row['@graph'])visit(row['@graph'],depth+1);
  const types=Array.isArray(row['@type'])?row['@type']:[row['@type']];
  if(!types.some(t=>typeof t==='string'&&/^(?:Organization|Corporation|LocalBusiness|Store|JewelryStore|ClothingStore|HealthAndBeautyBusiness)$/.test(t)))return;
  if(typeof row.url==='string'){try{if(new URL(row.url).hostname.replace(/^www\./,'')!==domain)return;}catch{return;}}
  result.company??=contactText(row.legalName,200)??contactText(row.name,200);
  result.phone??=contactText(row.telephone,60);result.industry??=contactText(row.industry,120);
  if(row.address&&typeof row.address==='object'&&!Array.isArray(row.address)){
   const address=row.address as Record<string,unknown>,country=address.addressCountry;
   result.country??=contactText(typeof country==='object'&&country?(country as {name?:unknown}).name:country,80);
   result.address??=[address.streetAddress,address.addressLocality,address.addressRegion,address.postalCode,result.country].flatMap(v=>contactText(v,200)?[contactText(v,200)!]:[]).join(', ').slice(0,500)||undefined;
  }else result.address??=contactText(row.address,500);
  for(const link of Array.isArray(row.sameAs)?row.sameAs:[]){
   result.instagram??=contactUrl(link,'instagram.com');result.linkedin??=contactUrl(link,'linkedin.com');result.facebook??=contactUrl(link,'facebook.com');
  }
 }
 records.forEach(row=>visit(row));return Object.fromEntries(Object.entries(result).filter(([,v])=>v!==undefined)) as typeof result;
}
