import {Types} from 'mongoose';
import {DevelopmentLetter,FollowUp} from '../../models';
import {MailMessage} from '../../models/MailMessage';
import {WebsiteResearch} from '../../models/WebsiteResearch';
import type {AuthUser} from '../../types/express';
import {getCustomerByIdOrThrow} from '../customer.service';
import {indexActor} from '../knowledge/index.service';
import {requireProjectId} from '../../utils/access';
import {inboundAgentScope} from './mail-access';
import {ensureCustomerResearch} from '../website/customer-research';
import {websiteCustomerEvidence} from '../website/research.service';

export function isCustomerBriefRequest(text:string){return /分析.{0,15}(?:客户|customer|client)|(?:客户|customer|client).{0,15}分析|经营方式|开发角度|客户背景|(?:analy[sz]e|research).{0,20}(?:customer|client)/i.test(text);}
const literal=(value:unknown,max=400)=>String(value??'').replace(/[\\`*_[\]<>]/g,'').replace(/[\r\n]+/g,' ').trim().slice(0,max);
/** A source brief is not a generated email. It contains no model-created seller facts
 * or promises and never enters the email rewrite/fallback path. */
export async function customerBrief(customerId:string,actor:AuthUser){
 actor=await indexActor(actor);await getCustomerByIdOrThrow(customerId,actor);
 const research=await ensureCustomerResearch(customerId,actor);
 const sources=await websiteCustomerEvidence(customerId,actor);
 const report=research.reportId&&sources.length?await WebsiteResearch.findOne({_id:research.reportId,projectId:requireProjectId(actor),customerId}):null;
 const customer=await getCustomerByIdOrThrow(customerId,actor);const scope={projectId:requireProjectId(actor),customerId:new Types.ObjectId(customerId)};
 const [sent,received,followups]=await Promise.all([
  DevelopmentLetter.countDocuments({...scope,status:{$in:['sent','opened']}}),
  MailMessage.countDocuments({...await inboundAgentScope(actor),...scope,deleted:{$ne:true}}),
  FollowUp.countDocuments(scope),
 ]);
 await getCustomerByIdOrThrow(customerId,await indexActor(actor));
 const lines=[`**${literal(customer.company||customer.name)} · 客户分析**`,'','**客户档案与联系阶段**',`- 联系人：${literal(customer.name)}；行业：${literal(customer.industry)||'尚未确认'}；国家/地区：${literal(customer.country)||'尚未确认'}。`,`- 可见往来：已发送 ${sent} 封、收到 ${received} 封、跟进 ${followups} 条。${sent||received?'已有联系，准备邮件时应承接具体往来。':'尚未查到收发邮件，不代表客户已确认采购需求。'}`,'','**档案中的客户需求**',`- 产品：${literal(customer.interestedProducts||customer.productCategory)||'尚未记录'}；预计数量：${literal(customer.expectedQuantity)||'尚未记录'}；目标价：${literal(customer.targetPrice)||'尚未记录'}。以上仅是客户需求，不代表我方承诺。`,'','**官网观察**','以下是客户官网自述，不是我方承诺或独立核实结果。'];
 const facts=report?.report?.facts.filter(f=>['product','current_state','role','person','buying_signal','recent_trigger'].includes(f.kind))??[];
 const seen=new Set<string>();let shown=0;
 for(const fact of facts){if(seen.has(fact.quote)||shown>=6)continue;seen.add(fact.quote);shown++;const label=fact.kind==='role'?'经营/销售渠道线索':fact.kind==='person'?'公开人物信息':fact.kind==='buying_signal'?'待核实需求陈述':'原文线索';lines.push(`- ${label}：${literal(fact.quote,600)}`,`  来源：[查看原文](${fact.url.replace(/\(/g,'%28').replace(/\)/g,'%29')}) · ${fact.collectedAt.slice(0,10)}`);}
 if(!shown)lines.push(research.message);
 lines.push('','**可考虑的开发方向（建议，需向客户确认）**');
 const angles=report?.report?.angles??[];for(const angle of angles.slice(0,2))lines.push(`- ${literal(angle.title)}：${literal(angle.advice,600)}`);
 if(!angles.length)lines.push('- 先核对经营范围与具体需求，再选择本项目有依据的产品介绍；不猜测客户痛点。');
 lines.push('- 只选择一个相关切入点和一个简短下一步；已经有包装，不等于需要更换。','', '**还不知道什么**',`- ${[!customer.expectedQuantity?'采购数量':null,!customer.targetPrice?'预算':null,'采购时间','实际负责人','复购频次','供应商情况'].filter(Boolean).join('、')}尚未在本次简报核实；档案已有的需求见上方，不重复当成缺失。`,'- 批发或经销页面是销售线索，不代表客户正在采购我方产品；公开创始人身份不代表采购职责或团队规模。','- 我方具体产品、价格、MOQ、交期和认证应在准备邮件时，另按当前项目有效已发布资料核对。','','本次仅整理分析，没有新增客户、草稿、跟进或发送邮件。');
 return lines.join('\n');
}
