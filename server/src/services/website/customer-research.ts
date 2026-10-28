import {indexActor} from '../knowledge/index.service';
import {createHash} from 'node:crypto';
import {Types} from 'mongoose';
import {WebsiteResearch} from '../../models/WebsiteResearch';
import type {AuthUser} from '../../types/express';
import {requireProjectId} from '../../utils/access';
import {getCustomerByIdOrThrow} from '../customer.service';
import {createWebsiteResearch,processWebsiteResearch,controlWebsiteResearch} from './research.service';
import {websiteUrl,fetchWebsite,WebsiteError,type WebsiteFetcher} from './public-web';
export interface CustomerResearchStatus {state:'ready'|'partial'|'unavailable'|'no_website';message:string;reportId?:string;collectedAt?:string}
export interface CustomerResearchOptions {requestKey?:string;fetcher?:WebsiteFetcher;check?:()=>Promise<unknown>;retry?:boolean}
// Existing customers are authoritative. Research only attaches untrusted public source
// snapshots; it never creates/merges/imports customers or writes their business fields.
export async function ensureCustomerResearch(customerId:string,actor:AuthUser,options:CustomerResearchOptions={}):Promise<CustomerResearchStatus>{
 const authorized=async()=>{await options.check?.();actor=await indexActor(actor);return getCustomerByIdOrThrow(customerId,actor);};
 const customer=await authorized();
 if(!customer.website?.trim())return {state:'no_website',message:'客户档案没有官网，将依据已有档案和授权往来分析；不会猜测官网或采购需求。'};
 let url:string;try{url=websiteUrl(customer.website).href;}catch{return {state:'unavailable',message:'客户官网地址不适合自动读取，将使用已有资料；请核对档案中的官网。'};}
 const filter={projectId:requireProjectId(actor),customerId:new Types.ObjectId(customerId),url};
 const latest=await WebsiteResearch.findOne(filter).sort({createdAt:-1});
 const fresh=latest&&latest.createdAt.getTime()>Date.now()-24*3600000;
 if(fresh&&['ready','partial'].includes(latest.state))return {state:latest.state as 'ready'|'partial',reportId:latest.id,collectedAt:latest.pages[0]?.collectedAt,message:latest.state==='ready'?'已读取客户官网原文，将结合历史往来判断开发切入点。':'部分官网页面未能读取，可用原文已保留；其余依据现有往来分析。'};
 if(latest&&['failed','cancelled'].includes(latest.state)&&latest.updatedAt.getTime()>Date.now()-15*60000&&!options.retry)return {state:'unavailable',reportId:latest.id,message:'官网最近读取未完成，将依据已有资料继续。'+(latest.error??'请人工核对官网。')};
 const key='agent-research:'+createHash('sha256').update(customerId+'|'+url+'|'+(options.requestKey??String(Math.floor(Date.now()/(24*3600000))))).digest('hex');
 let id:string;
 try{
  const pending=latest&&['queued','running'].includes(latest.state)&&String(latest.userId)===actor.id?latest:null;
  const job=pending??await createWebsiteResearch({url,requestKey:key},actor);id=job.id;
  await authorized();
  await WebsiteResearch.updateOne({_id:id,projectId:filter.projectId,userId:actor.id,$or:[{customerId:{$exists:false}},{customerId:filter.customerId}]},{$set:{customerId:filter.customerId}});
  const current=await WebsiteResearch.findById(id);if(!current||String(current.customerId)!==customerId)throw new WebsiteError('link_changed','官网资料关联已变化');
  if(['failed','cancelled'].includes(current.state)&&options.retry)await controlWebsiteResearch(id,'retry',current.version,actor);
  const started=Date.now();const check=async()=>{await authorized();if(Date.now()-started>80000)throw new WebsiteError('timeout','官网读取超过本轮时限，请人工核对');};
  const fetcher:WebsiteFetcher=async(value,kind)=>{await check();const result=await (options.fetcher??fetchWebsite)(value,kind);await check();return result;};
  await processWebsiteResearch(id,fetcher);
  let result=await WebsiteResearch.findById(id);
  while(result&&['queued','running'].includes(result.state)&&Date.now()-started<80000){await check();await new Promise(resolve=>setTimeout(resolve,250));result=await WebsiteResearch.findById(id);}
  const latestCustomer=await authorized();let currentUrl='';try{currentUrl=websiteUrl(latestCustomer.website??'').href;}catch{/* Changed or removed website. */}if(currentUrl!==url)return {state:'unavailable',message:'客户官网在分析期间已变化，旧网址的资料未用于邮件；请按最新资料重新准备。'};
  if(result&&['ready','partial'].includes(result.state))return {state:result.state as 'ready'|'partial',reportId:id,collectedAt:result.pages[0]?.collectedAt,message:result.state==='ready'?'已读取客户官网原文，将结合历史往来判断开发切入点。':'部分官网页面未能读取，已保留可用原文；缺失内容不作推断。'};
  return {state:'unavailable',reportId:id,message:'官网读取未完成，仍可依据客户档案和授权往来分析。'+(result?.error??'请人工核对官网。')};
 }catch(error){await authorized();return {state:'unavailable',message:'本轮未能取得客户官网资料，将只使用已有授权信息；不会推断采购需求。'};}
}
export async function customerResearchTool(customerId:string,actor:AuthUser){
 const result=await ensureCustomerResearch(customerId,actor);
 if(!result.reportId)return result;
 await getCustomerByIdOrThrow(customerId,actor);
 const row=await WebsiteResearch.findOne({_id:result.reportId,projectId:requireProjectId(actor),customerId});
 return {...result,researchPerspective:row?.report?.profileLabel,notice:'研究口径仅用于选择开发方向，我方具体产品能力仍需当前项目已发布知识。客户所售产品不是我方产品。欢迎批发询盘是客户销售渠道，不证明客户正在采购。客户现有产品或配套服务不证明稳定采购量或复购。创始人公开不证明团队规模、采购职责或决策链。网站自述与规则建议未经独立核实。',facts:row?.report?.facts.slice(0,8).map(f=>({...f,quote:f.quote.slice(0,600)})),angles:row?.report?.angles,score:row?.report?.score};
}
