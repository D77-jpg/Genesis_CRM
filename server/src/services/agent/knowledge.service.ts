import {Types} from 'mongoose';
import {z} from 'zod';
import {AgentKnowledge} from '../../models/AgentKnowledge';
import {requireProjectId} from '../../utils/access';
import type {AuthUser} from '../../types/express';
import {ApiError} from '../../utils/ApiError';
export const knowledgeInput=z.object({expectedVersion:z.number().int().min(0),title:z.string().trim().min(1).max(160),tags:z.array(z.string().trim().min(1).max(80)).max(15),content:z.string().trim().min(1).max(12000),source:z.string().trim().min(1).max(500),approved:z.boolean()}).strict();
export async function appendKnowledge(id:string|undefined,input:z.infer<typeof knowledgeInput>,actor:AuthUser){
 if(actor.role!=='admin')throw ApiError.forbidden('产品知识由项目管理员确认发布');
 const projectId=requireProjectId(actor);const parsed=knowledgeInput.parse(input);const version=parsed.expectedVersion+1;
 if(version>100)throw ApiError.conflict('请归档后建立新的知识条目');
 const revision={version,title:parsed.title,tags:parsed.tags,content:parsed.content,source:parsed.source,approved:parsed.approved,createdBy:new Types.ObjectId(actor.id),createdAt:new Date()};
 if(!id){if(parsed.expectedVersion!==0)throw ApiError.conflict('新知识版本必须从 1 开始');return (await AgentKnowledge.create({projectId,version,approvedVersion:parsed.approved?version:0,revisions:[revision]})).id;}
 if(!Types.ObjectId.isValid(id))throw ApiError.notFound('知识不存在');
 const saved=await AgentKnowledge.findOneAndUpdate({_id:id,projectId,version:parsed.expectedVersion,archived:false},{$set:{version,...(parsed.approved?{approvedVersion:version}:{})},$push:{revisions:revision}},{new:true});
 if(!saved)throw ApiError.conflict('知识已变化或已归档，请重新载入');return saved.id;
}
export async function listKnowledge(actor:AuthUser){
 const rows=await AgentKnowledge.find({projectId:requireProjectId(actor),...(actor.role==='admin'?{}:{archived:false,approvedVersion:{$gt:0}})}).sort({updatedAt:-1}).limit(100);
 return rows.map(k=>({id:k.id,version:k.version,approvedVersion:k.approvedVersion,archived:k.archived,revisions:actor.role==='admin'?k.revisions:k.revisions.filter(v=>v.approved&&v.version===k.approvedVersion)}));
}
export async function archiveKnowledge(id:string,version:number,actor:AuthUser){
 if(actor.role!=='admin')throw ApiError.forbidden();if(!Types.ObjectId.isValid(id))throw ApiError.notFound();
 if(!(await AgentKnowledge.updateOne({_id:id,projectId:requireProjectId(actor),version},{$set:{archived:true},$inc:{version:1}})).matchedCount)throw ApiError.conflict('知识已变化');
}
export async function searchProductKnowledge(actor:AuthUser,query:string,ids?:string[]){
 const rows=await AgentKnowledge.find({projectId:requireProjectId(actor),archived:false,approvedVersion:{$gt:0},...(ids?.length?{_id:{$in:ids}}:{})}).sort({updatedAt:-1}).limit(100);
 const words=query.toLocaleLowerCase().split(/[\s,，、;；/]+/).filter(w=>w.length>1);
 return rows.flatMap(k=>{
  const v=k.revisions.find(x=>x.version===k.approvedVersion&&x.approved);if(!v)return [];
  const title=v.title.toLocaleLowerCase();const tags=v.tags.map(t=>t.toLocaleLowerCase());
  const matches=ids?.includes(k.id)||tags.some(t=>['*','通用','general'].includes(t)||query.toLocaleLowerCase().includes(t))||words.some(w=>title.includes(w));
  return matches?[{knowledgeId:k.id,sourceId:`knowledge:${k.id}:v${v.version}`,version:v.version,title:v.title,content:v.content,source:v.source,approved:true}]:[];
 }).slice(0,5);
}
