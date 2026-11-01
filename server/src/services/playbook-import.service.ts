import {Types} from 'mongoose';
import {z} from 'zod';
import {Project,ProjectPlaybook} from '../models';
import {ApiError} from '../utils/ApiError';
import {requireProjectId} from '../utils/access';
import {resolveProjectSalesProfile,type ProjectLike} from './project-profile';
import {getBuiltinPlaybook} from './agent/outreach-playbook';
import type {AuthUser} from '../types/express';
import type {PlaybookCardData} from './agent/genesis-playbook.data';

const cardSchema=z.object({
  id:z.string().trim().min(1).max(40),
  kind:z.enum(['segment','preference']),
  name:z.string().trim().min(1).max(200),
  signals:z.string().trim().max(2000).default(''),
  products:z.string().trim().max(2000).default(''),
  logic:z.string().trim().max(3000).default(''),
  avoid:z.string().trim().max(3000).default(''),
  cta:z.string().trim().max(1000).default(''),
  prepare:z.string().trim().max(2000).default(''),
  check:z.string().trim().max(3000).default(''),
  subjects:z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  keywords:z.array(z.string().trim().min(2).max(80)).max(50).default([]),
}).strict();

export const playbookImportInput=z.object({
  cards:z.array(cardSchema).min(1,'至少导入一张卡').max(200,'单次最多导入 200 张卡'),
}).strict().superRefine((value,ctx)=>{
  const ids=new Set<string>();
  value.cards.forEach((card,index)=>{
    if(ids.has(card.id))ctx.addIssue({code:'custom',path:['cards',index,'id'],message:'卡片 ID 不能重复'});
    ids.add(card.id);
  });
});

export type PlaybookImportInput=z.input<typeof playbookImportInput>;

function requireAdmin(actor:AuthUser){if(actor.role!=='admin')throw ApiError.forbidden('行业卡由项目管理员导入和维护');}

function toCard(input:z.infer<typeof cardSchema>):PlaybookCardData{
  return {
    id:input.id,name:input.name,signals:input.signals,products:input.products,logic:input.logic,avoid:input.avoid,
    cta:input.cta,prepare:input.prepare,check:input.check,subjects:input.subjects,keywords:input.keywords,
  };
}

export async function getProjectPlaybook(actor:AuthUser){
  requireAdmin(actor);const projectId=requireProjectId(actor);
  const project=await Project.findById(projectId).select('code slug name companyName industry').lean();
  const profile=resolveProjectSalesProfile(project as unknown as ProjectLike);
  const doc=await ProjectPlaybook.findOne({projectId:new Types.ObjectId(projectId)}).lean();
  if(doc)return {
    id:String(doc._id),version:doc.version,segments:doc.segments??[],preferences:doc.preferences??[],
    updatedAt:doc.updatedAt,source:'imported' as const,projectKey:profile.key,projectLabel:profile.label,
  };
  const builtin=getBuiltinPlaybook(profile.key);
  return {
    version:0,segments:builtin?.segments??[],preferences:builtin?.preferences??[],
    updatedAt:null,source:'builtin' as const,projectKey:profile.key,projectLabel:profile.label,
  };
}

export async function importProjectPlaybook(input:PlaybookImportInput,actor:AuthUser){
  requireAdmin(actor);const projectId=requireProjectId(actor);
  const parsed=playbookImportInput.parse(input);
  const segments=parsed.cards.filter(card=>card.kind==='segment').map(toCard);
  const preferences=parsed.cards.filter(card=>card.kind==='preference').map(toCard);
  const existing=await ProjectPlaybook.findOne({projectId:new Types.ObjectId(projectId)});
  const doc=existing??new ProjectPlaybook({projectId:new Types.ObjectId(projectId),version:0});
  doc.version+=1;doc.segments=segments;doc.preferences=preferences;doc.updatedBy=new Types.ObjectId(actor.id);
  await doc.save();
  return {version:doc.version,segments:doc.segments.length,preferences:doc.preferences.length,updatedAt:doc.updatedAt};
}

export async function loadImportedPlaybook(projectId:string|undefined){
  if(!projectId)return undefined;
  const doc=await ProjectPlaybook.findOne({projectId:new Types.ObjectId(projectId)}).lean();
  if(!doc||(!doc.segments?.length&&!doc.preferences?.length))return undefined;
  return {segments:(doc.segments??[]) as PlaybookCardData[],preferences:(doc.preferences??[]) as PlaybookCardData[]};
}

export async function clearProjectPlaybook(actor:AuthUser){
  requireAdmin(actor);const projectId=requireProjectId(actor);
  await ProjectPlaybook.deleteOne({projectId:new Types.ObjectId(projectId)});
  return {cleared:true};
}
