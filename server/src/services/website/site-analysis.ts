import {createHash} from 'node:crypto';
import {parseDocument} from 'htmlparser2';
import {websiteUrl} from './public-web';

export type ResearchProfile='genesis'|'ironhue'|'velaturo'|'general';
export interface WebsitePage {url:string;title:string;text:string;hash:string;htmlHash:string;collectedAt:string;links:{url:string;text:string}[];name:string}
export interface WebsiteFact {id:string;kind:string;value:string;quote:string;url:string;collectedAt:string}
export interface ResearchReport {profile:ResearchProfile;profileLabel:string;company:string;emails:string[];facts:WebsiteFact[];warnings:string[];unknowns:string[];segments:{label:string;sourceIds:string[]}[];angles:{title:string;advice:string;sourceIds:string[]}[];score:{lower:number;upper:number;grade:string;dimensions:{name:string;max:number;score:number|null;reason:string;sourceIds:string[]}[]};version:'website-rules-v1'}
interface Node {type:string;name?:string;data?:string;attribs?:Record<string,string>;children?:Node[]}
const ignored=new Set(['script','style','noscript','template','svg','iframe','form','nav','footer']);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const clean=(text:string)=>text.replace(/\s+/g,' ').trim();
function words(node:Node,depth=0):string {if(depth>60)return '';if(node.name&&ignored.has(node.name))return '';if(node.type==='text')return node.data??'';return (node.children??[]).map(child=>words(child,depth+1)).join(['p','div','li','section','br','h1','h2','h3'].includes(node.name??'')?'\n':' ');}
export function parseWebsitePage(html:string,url:string,at=new Date().toISOString()):WebsitePage {
 const root=parseDocument(html,{decodeEntities:true});const lines:string[]=[],links:{url:string;text:string}[]=[];let title='',name='';let nodes=0;
 function walk(node:Node,depth:number,noise=false){if(depth>60||++nodes>50000)return;const attrs=node.attribs??{};
  if(node.name==='title')title=clean(words(node)).slice(0,240);
  if(node.name==='meta'&&(attrs.property==='og:site_name'||attrs.name==='application-name'))name=clean(attrs.content??'').slice(0,120);
  if(node.name==='a'&&attrs.href){try{const href=new URL(attrs.href,url);if(['http:','https:','mailto:','tel:'].includes(href.protocol))links.push({url:href.href.slice(0,1200),text:clean(words(node)).slice(0,180)});}catch{/* Untrusted hrefs are ignored. */}}
  if(node.name&&['script','style','noscript','template','svg','iframe'].includes(node.name))return;
  noise=noise||['nav','footer','form'].includes(node.name??'');
  if(!noise&&['h1','h2','h3','p','li','address'].includes(node.name??'')){const text=clean(words(node));if(text&&text.length<=1800)lines.push(text);}
  for(const child of node.children??[])walk(child,depth+1,noise);
 }walk(root,0);
 const text=[...new Set(lines.length?lines:words(root).split('\n').map(clean).filter(Boolean))].join('\n').slice(0,24000);
 return {url,title,text,hash:hash(text),htmlHash:hash(html),collectedAt:at,links:[...new Map(links.map(l=>[l.url,l])).values()].slice(0,150),name:name||title.replace(/\s+[|–—]\s+.*$/,'').slice(0,120)};
}
export function relatedPages(page:WebsitePage):string[]{
 const root=new URL(page.url);const chosen=new Map<string,string>();
 const kinds:[string,RegExp][]=[['about',/about|our-story|founder|team|über-uns|关于/i],['contact',/contact|kontakt|联系/i],['legal',/impressum|imprint|legal|法律/i],['trade',/wholesale|trade-account|trade-program|批发/i],['products',/products|collections|catalog|产品/i],['stockists',/stockist|retailers|stores|门店/i]];
 for(const link of page.links){let u;try{u=websiteUrl(link.url);}catch{continue;}if(u.origin!==root.origin||/login|checkout|cart|logout|delete|\.(?:pdf|zip|docx?|xlsx?|png|jpe?g)$/i.test(u.pathname)||/account/i.test(u.pathname)&&!/trade|wholesale/i.test(u.pathname))continue;
  for(const [kind,pattern] of kinds)if(!chosen.has(kind)&&pattern.test(u.pathname+' '+link.text)&&u.href!==page.url){chosen.set(kind,u.href);break;}}
 return [...new Set(chosen.values())].slice(0,6);
}
export function projectResearchProfile(project:{slug?:string;code?:string;name?:string}):ResearchProfile {
 const text=[project.slug,project.code,project.name].join(' ').toLowerCase();
 return /\bironhue\b/.test(text)?'ironhue':/\bvelaturo\b/.test(text)?'velaturo':/\bgenesis\b/.test(text)?'genesis':'general';
}
const labels:Record<ResearchProfile,string>={genesis:'包装客户开发',ironhue:'健身器材客户开发',velaturo:'墙面艺术客户开发',general:'通用客户调查'};
const productPatterns:Record<ResearchProfile,RegExp>={genesis:/jewel(?:lery|ry)|necklace|bracelet|watch|skincare|cosmetic|perfume|fragrance|candle|珠宝|首饰|香氛|蜡烛|美妆/i,ironhue:/dumbbell|kettlebell|weight plate|barbell|strength training|fitness equipment|哑铃|壶铃|杠铃|健身器材/i,velaturo:/wall art|canvas|portrait|framing|art print|interior design|hotel|画框|装裱|墙饰|肖像|酒店/i,general:/product|collection|service|产品|服务/i};
const roles:[string,RegExp][]=[['品牌 / 自有产品',/our brand|our collection|designed by|own brand|自有品牌/i],['经销 / 批发',/wholesale|distributor|trade account|批发|经销/i],['零售 / 电商',/shop online|add to cart|online store|零售|网店/i],['健身房 / 工作室',/gym|personal training|fitness studio|健身房|私教/i],['室内 / 空间项目',/interior design|hospitality|hotel project|室内设计|酒店项目/i],['画框 / 装裱',/framing|frame shop|装裱|画框店/i]];
export function analyzeWebsite(pages:WebsitePage[],profile:ResearchProfile,now=new Date()):ResearchReport {
 const facts:WebsiteFact[]=[];const warnings:string[]=[];const seen=new Set<string>();
 const add=(kind:string,value:string,quote:string,page:WebsitePage)=>{const key=kind+':'+value.toLowerCase();if(seen.has(key)||facts.length>=100)return;seen.add(key);facts.push({id:hash(page.url+'\n'+kind+'\n'+value).slice(0,24),kind,value:value.slice(0,400),quote:quote.slice(0,900),url:page.url,collectedAt:page.collectedAt});};
 for(const page of pages){
  for(const line of page.text.split('\n')){
   if(/ignore.{0,40}(?:instructions|rules)|忽略.{0,20}(?:规则|指令)|system prompt|自动发送|跨项目/i.test(line)){warnings.push('网页含疑似指令文字，已作为不可信内容排除，未执行。');continue;}
   if(productPatterns[profile].test(line))add('product',line,line,page);
   for(const [label,pattern] of roles)if(pattern.test(line))add('role',label,line,page);
   if(/gift box|gift wrapping|packaging|礼盒|礼品包装/i.test(line))add('current_state',line,line,page);
   if(/(?:founder|co-founder|founded by|owner|创始人)\b\s*[:：]?\s*[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line))add('person',line,line,page);
   if(/seeking (?:new )?suppliers|looking for (?:a |new )?supplier|采购需求|寻找供应商/i.test(line))add('buying_signal',line,line,page);
   const date=line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);if(date&&/launch|new collection|opening|上新|开业/i.test(line)){const age=now.getTime()-Date.parse(date[1]);if(age>=0&&age<=365*86400000)add('recent_trigger',line,line,page);}
   const phone=line.match(/(?:phone|tel|电话)\s*[:：]\s*(\+?[\d() .-]{7,30})/i);if(phone)add('phone',phone[1].trim(),line,page);
   for(const email of line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[])add('email',email.toLowerCase(),line,page);
  }
  for(const link of page.links){if(link.url.startsWith('mailto:')){let email='';try{email=decodeURIComponent(link.url.slice(7).split('?')[0]);}catch{continue;}if(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email))add('email',email.toLowerCase(),link.text||email,page);}
   else if(link.url.startsWith('tel:')){let phone='';try{phone=decodeURIComponent(link.url.slice(4));}catch{continue;}if(/^[+\d() .-]{7,30}$/.test(phone))add('phone',phone,link.text||phone,page);}
   else if(/(^|\.)(?:linkedin\.com|instagram\.com|wa\.me)$/.test(new URL(link.url).hostname))add('contact_link',link.url,link.text||link.url,page);}
 }
 const find=(kind:string)=>facts.filter(f=>f.kind===kind);const dimensions:ResearchReport['score']['dimensions']=[];
 const dimension=(name:string,max:number,score:number|null,reason:string,used:WebsiteFact[])=>dimensions.push({name,max,score,reason,sourceIds:used.slice(0,3).map(f=>f.id)});
 dimension('产品适配',25,find('product').length?12.5:null,find('product').length?'官网出现相关品类，实际采购适配仍需确认':'未找到足够的相关产品证据',find('product'));
 dimension('真实需求证据',20,find('buying_signal').length?10:null,find('buying_signal').length?'发现寻找供应商的公开陈述，需核对时效与对象':'销售某类产品不等于正在采购',find('buying_signal'));
 dimension('复购迹象',15,null,'产品数量和批发渠道不能直接证明复购，待调查',[]);
 dimension('采购角色可达',15,find('email').length?7.5:null,find('email').length?'发现公开邮箱，未确认是否为采购联系人':'缺少经过确认的采购联系人',find('email'));
 dimension('近期触发点',15,find('recent_trigger').length?7.5:null,find('recent_trigger').length?'存在一年内带明确日期的动态，仍需人工核对':'缺少带明确日期的近期动态',find('recent_trigger'));
 dimension('初步经济性',10,null,'缺少采购量、预算或物流条件，不能判断',[]);
 const lower=dimensions.reduce((s,d)=>s+(d.score??0),0),upper=lower+dimensions.filter(d=>d.score===null).reduce((s,d)=>s+d.max,0);
 const angles:ResearchReport['angles']=[];const matched=find('product');
 if(matched.length){const mature=find('current_state');angles.push({title:profile==='genesis'&&mature.length?'从备选供应方案或新系列切入':'从已在售品类切入',advice:profile==='genesis'&&mature.length?'客户官网已有包装陈述。先核对现状，再询问是否需要备选方案，不推断现有包装有缺陷。':'围绕官网出现的具体产品询问采购或合作方向；我方可提供的产品、工艺和承诺须检索当前项目已发布知识。',sourceIds:(mature.length?mature:matched).slice(0,3).map(f=>f.id)});}
 if(find('role').length)angles.push({title:'按客户经营方式调整提问',advice:'先确认采购身份、目标产品和规模，再准备相应的产品资料；不把经销、零售或场馆身份当成已确认采购需求。',sourceIds:find('role').slice(0,3).map(f=>f.id)});
 return {version:'website-rules-v1',profile,profileLabel:labels[profile],company:pages[0]?.name??'',emails:find('email').map(f=>f.value).sort((a,b)=>Number(/^(info|hello|contact)@/.test(a))-Number(/^(info|hello|contact)@/.test(b))),facts,warnings:[...new Set(warnings)],unknowns:['采购数量和预算尚未确认','真实采购负责人及采购时间尚未确认','营收、复购频次和现有供应商尚未确认'],segments:find('role').map(f=>({label:f.value,sourceIds:[f.id]})),angles,score:{lower,upper,grade:matched.length?'待研究':'待确认品类',dimensions}};
}
