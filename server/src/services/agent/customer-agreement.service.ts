import {Types} from 'mongoose';
import {z} from 'zod';
import {CustomerAgreement} from '../../models/CustomerAgreement';
import {getCustomerByIdOrThrow} from '../customer.service';
import {requireProjectId} from '../../utils/access';
import {ApiError} from '../../utils/ApiError';
import type {AuthUser} from '../../types/express';
import type {KnowledgeSource} from './knowledge-types';
import {termInput} from './knowledge.service';
export const agreementInput=z.object({expectedVersion:z.number().int().min(0),title:z.string().trim().min(1).max(160),source:z.string().trim().min(1).max(500),content:z.string().trim().min(1).max(8000),validFrom:z.coerce.date(),validUntil:z.coerce.date(),approved:z.boolean(),terms:z.array(termInput).min(1).max(25)}).strict().superRefine((v,c)=>{
 if(v.validUntil<=v.validFrom)c.addIssue({code:'custom',message:'失效时间必须晚于生效时间'});
 if(v.approved&&v.terms.some(t=>!t.scope?.reviewed))c.addIssue({code:'custom',message:'确认客户约定前请填写各项结构化适用条件'});
});
export async function saveCustomerAgreement(customerId:string,id:string|undefined,input:z.input<typeof agreementInput>,actor:AuthUser){
 if(actor.role!=='admin')throw ApiError.forbidden('客户约定由项目管理员确认；备注或客户要求不自动成为我方约定');
 await getCustomerByIdOrThrow(customerId,actor);const projectId=requireProjectId(actor);const v=agreementInput.parse(input);
 const version=v.expectedVersion+1;if(version>100)throw ApiError.conflict('版本过多，请另建约定');
 const revision={...v,version,reviewedBy:new Types.ObjectId(actor.id),reviewedAt:new Date()};
 if(!id){if(v.expectedVersion!==0)throw ApiError.conflict('新约定从第一版开始');return (await CustomerAgreement.create({projectId,customerId,version,approvedVersion:v.approved?version:0,revisions:[revision]})).id;}
 if(!Types.ObjectId.isValid(id))throw ApiError.notFound();
 const result=await CustomerAgreement.findOneAndUpdate({_id:id,projectId,customerId,version:v.expectedVersion,disabled:false},{$set:{version,...(v.approved?{approvedVersion:version}:{})},$push:{revisions:revision}},{new:true});
 if(!result)throw ApiError.conflict('约定已变化或停用，请重新载入');return result.id;
}
export async function listCustomerAgreements(customerId:string,actor:AuthUser){
 await getCustomerByIdOrThrow(customerId,actor);const rows=await CustomerAgreement.find({projectId:requireProjectId(actor),customerId,...(actor.role==='admin'?{}:{disabled:false,approvedVersion:{$gt:0}})}).sort({_id:1}).limit(101);
 if(rows.length>100)throw ApiError.conflict('客户约定超过本次审核上限，请先整理');
 return rows.map(row=>({id:row.id,customerId:String(row.customerId),version:row.version,approvedVersion:row.approvedVersion,disabled:row.disabled,revisions:actor.role==='admin'?row.revisions:row.revisions.filter(v=>v.version===row.approvedVersion&&v.validFrom<=new Date()&&v.validUntil>new Date())}));
}
export async function disableCustomerAgreement(customerId:string,id:string,version:number,actor:AuthUser){
 if(actor.role!=='admin')throw ApiError.forbidden();await getCustomerByIdOrThrow(customerId,actor);if(!Types.ObjectId.isValid(id))throw ApiError.notFound();
 const result=await CustomerAgreement.updateOne({_id:id,projectId:requireProjectId(actor),customerId,version,disabled:false},{$set:{disabled:true},$inc:{version:1}});if(!result.matchedCount)throw ApiError.conflict('约定已变化');
}
export async function agreementEvidence(customerId:string,actor:AuthUser):Promise<KnowledgeSource[]>{
 const rows=await listCustomerAgreements(customerId,actor);const now=new Date();return rows.flatMap(row=>{
 const v=row.revisions.find(x=>x.version===row.approvedVersion&&x.approved&&x.validFrom<=now&&x.validUntil>now);if(row.disabled||!v)return [];
 return [{sourceId:'agreement:'+row.id+':v'+v.version,agreementId:row.id,customerId,version:v.version,title:v.title,category:'trade' as const,kind:'agreement' as const,content:v.content,source:v.source,applicability:'仅适用于当前客户；以逐项条件为准',products:[],validFrom:v.validFrom.toISOString(),validUntil:v.validUntil.toISOString(),terms:v.terms}];
 });
}
