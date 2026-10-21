import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';

export class WebsiteError extends Error {
 constructor(readonly code:string,message:string){super(message);this.name='WebsiteError';}
}
export function websiteUrl(raw:string):URL {
 let url:URL;try{url=new URL(/^https?:\/\//i.test(raw.trim())?raw.trim():'https://'+raw.trim());}catch{throw new WebsiteError('invalid_url','请填写完整的客户官网地址');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||isIP(url.hostname.replace(/^\[|\]$/g,''))||!url.hostname.includes('.')||/\.(?:local|localhost|internal|test|invalid|example|onion)$/i.test(url.hostname))throw new WebsiteError('unsafe_url','仅支持公开网站域名，不支持内网、IP、账号或自定义端口');
 if(url.href.length>1200)throw new WebsiteError('invalid_url','网址过长，请使用客户官网地址');
 url.hash='';url.search='';return url;
}
export function publicIpv4(address:string):boolean {
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(address==='168.63.129.16'||a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88&&c===99))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
export async function publicTarget(raw:string,resolver:(hostname:string,options:{all:true;family:4})=>Promise<{address:string;family:number}[]>=lookup){
 const url=websiteUrl(raw);
 let addresses;try{addresses=await resolver(url.hostname,{all:true,family:4});}catch{throw new WebsiteError('dns_failed','官网域名暂时无法解析，请检查网址或稍后重试');}
 if(!addresses.length||addresses.some(item=>!publicIpv4(item.address)))throw new WebsiteError('private_address','该域名解析到受限地址，已停止采集');
 return {url,address:addresses[0].address};
}
export interface WebResponse {url:string;text:string;status:number;/** 归档快照时间（ISO）；实时抓取为空 */archivedAt?:string}
export type WebsiteFetcher=(url:string,kind?:'html'|'robots'|'json')=>Promise<WebResponse>;
// Resolve and pin every connection, including redirects. No cookies, auth, proxy environment or script execution.
export const fetchWebsite:WebsiteFetcher=async(raw,kind='html')=>{
 const initial=websiteUrl(raw);let current=initial;
 const deadline=Date.now()+12000;
 for(let redirects=0;redirects<=3;redirects++){
  const remaining=deadline-Date.now();if(remaining<=0)throw new WebsiteError('timeout','官网响应超时，请稍后重试');
  const dns=await Promise.race([publicTarget(current.href),new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(new WebsiteError('timeout','域名解析超时')),Math.min(remaining,4000));t.unref();})]);
  const result=await new Promise<{status:number;location?:string;text:string}>((resolve,reject)=>{
   const request=(current.protocol==='https:'?httpsRequest:httpRequest)(current,{
    family:4,agent:false,lookup:(_hostname,_options,done)=>done(null,dns.address,4),
    headers:{'User-Agent':'GenesisCRM-Research/1.0','Accept':kind==='robots'?'text/plain':kind==='json'?'application/json':'text/html, application/xhtml+xml','Accept-Encoding':'identity'},
   },response=>{
    const status=response.statusCode??0;
    if([301,302,303,307,308].includes(status)){response.destroy();resolve({status,location:response.headers.location,text:''});return;}
    if(kind==='robots'&&status===404){response.destroy();resolve({status,text:''});return;}
    if(status<200||status>=300){response.destroy();reject(new WebsiteError('http_error',status===403||status===429?'网站限制访问，请人工核对或稍后重试':'官网返回访问错误（'+status+'）'));return;}
    const mime=response.headers['content-type']??'';
    const mimeOk=kind==='robots'?/^text\/plain/i.test(mime):kind==='json'?/^(?:application\/json|text\/plain)/i.test(mime):/^(?:text\/html|application\/xhtml\+xml)/i.test(mime);
    if(!mimeOk||response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){response.destroy();reject(new WebsiteError('unsupported_content','网页格式或压缩方式不支持，请人工核对'));return;}
    if(/charset\s*=\s*(?!utf-8|utf8|us-ascii)[\w-]+/i.test(mime)){response.destroy();reject(new WebsiteError('unsupported_encoding','网页不是 UTF-8 编码，请人工核对'));return;}
    const chunks:Buffer[]=[];let size=0;const max=kind==='html'?2*1024*1024:128*1024;
    response.on('data',(part:Buffer)=>{size+=part.length;if(size>max){response.destroy(new WebsiteError('page_limit','页面过大，已停止读取'));return;}chunks.push(part);});
    response.once('error',reject);response.once('end',()=>resolve({status,text:Buffer.concat(chunks).toString('utf8')}));
   });
   const timer=setTimeout(()=>request.destroy(new WebsiteError('timeout','官网响应超时，请稍后重试')),Math.max(1,deadline-Date.now()));timer.unref();
   request.once('close',()=>clearTimeout(timer));request.once('error',reject);request.end();
  });
  if(![301,302,303,307,308].includes(result.status))return {url:current.href,text:result.text,status:result.status};
  if(!result.location)throw new WebsiteError('redirect_failed','官网跳转地址缺失');
  const next=websiteUrl(new URL(result.location,current).href);
  if(next.hostname.replace(/^www\./,'')!==initial.hostname.replace(/^www\./,'')||current.protocol==='https:'&&next.protocol!=='https:')throw new WebsiteError('external_redirect','官网跳转到其他网站或不安全连接，请直接填写正确官网');
  current=next;
 }
 throw new WebsiteError('redirect_limit','官网跳转次数过多，请填写最终官网地址');
};

export function robotsAllows(path:string,text:string):boolean {
 const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];let group={agents:[] as string[],rules:[] as {allow:boolean;path:string}[]};
 for(const raw of text.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim();const match=line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);if(!match)continue;
  if(match[1].toLowerCase()==='user-agent'){if(group.rules.length){groups.push(group);group={agents:[],rules:[]};}group.agents.push(match[2].toLowerCase());}
  else if(group.agents.length&&match[2])group.rules.push({allow:match[1].toLowerCase()==='allow',path:match[2]});
 }groups.push(group);
 const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'genesiscrm-research'.includes(a))),selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
 const matching=selected.flatMap(g=>g.rules).filter(r=>new RegExp('^'+r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$')).test(path)).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));
 return !matching.length||matching[0].allow;
}
