import {Types,type FilterQuery} from 'mongoose';
import {Product,type IProduct,type ProductPriceTier,type ProductSpec} from '../models';
import {ApiError} from '../utils/ApiError';
import {buildPaginated,parsePagination,type Paginated} from '../utils/pagination';
import {requireProjectId} from '../utils/access';
import type {AuthUser} from '../types/express';
import type {CreateProductInput,ImportProductsInput,ListProductsQuery,UpdateProductInput} from '../validators/product.validator';

export interface ProductDto{
  id:string;sku:string;name:string;category?:string;description?:string;status:IProduct['status'];
  specs:ProductSpec[];priceTiers:ProductPriceTier[];moq?:string;leadTime?:string;notes?:string;source?:string;
  effectiveFrom?:Date;effectiveUntil?:Date;createdAt:Date;updatedAt:Date;
}

const PRODUCT_SORTS=new Set(['updatedAt','createdAt','name','sku','category']);

function toDto(row:IProduct & {_id:Types.ObjectId}):ProductDto{
  return {
    id:String(row._id),sku:row.sku,name:row.name,category:row.category,description:row.description,status:row.status,
    specs:row.specs??[],priceTiers:row.priceTiers??[],moq:row.moq,leadTime:row.leadTime,notes:row.notes,source:row.source,
    effectiveFrom:row.effectiveFrom,effectiveUntil:row.effectiveUntil,createdAt:row.createdAt,updatedAt:row.updatedAt,
  };
}

function requireAdmin(actor:AuthUser){if(actor.role!=='admin')throw ApiError.forbidden('产品与价格目录由项目管理员维护');}

export async function listProducts(query:ListProductsQuery,actor:AuthUser):Promise<Paginated<ProductDto>>{
  const projectId=requireProjectId(actor);
  const page=parsePagination(query as unknown as Record<string,unknown>,{allowedSortFields:PRODUCT_SORTS,defaultSortBy:'updatedAt'});
  const filter:FilterQuery<IProduct>={projectId:new Types.ObjectId(projectId)};
  if(query.status&&query.status!=='all')filter.status=query.status;
  if(query.category)filter.category=query.category;
  if(query.search?.trim()){
    const rx=new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
    filter.$or=[{sku:rx},{name:rx},{category:rx},{description:rx},{'specs.value':rx}];
  }
  const [rows,total]=await Promise.all([
    Product.find(filter).sort({[page.sortBy]:page.sortOrder}).skip(page.skip).limit(page.limit).lean(),
    Product.countDocuments(filter),
  ]);
  return buildPaginated(rows.map(row=>toDto(row as unknown as IProduct & {_id:Types.ObjectId})),total,page.page,page.limit);
}

export async function getProduct(id:string,actor:AuthUser):Promise<ProductDto>{
  const projectId=requireProjectId(actor);
  if(!Types.ObjectId.isValid(id))throw ApiError.notFound('产品不存在');
  const row=await Product.findOne({_id:new Types.ObjectId(id),projectId:new Types.ObjectId(projectId)}).lean();
  if(!row)throw ApiError.notFound('产品不存在');
  return toDto(row as unknown as IProduct & {_id:Types.ObjectId});
}

export async function createProduct(input:CreateProductInput,actor:AuthUser):Promise<ProductDto>{
  requireAdmin(actor);const projectId=requireProjectId(actor);
  try{
    const row=await Product.create({...input,projectId:new Types.ObjectId(projectId),createdBy:new Types.ObjectId(actor.id)});
    return toDto(row.toObject() as unknown as IProduct & {_id:Types.ObjectId});
  }catch(error){
    if((error as {code?:number}).code===11000)throw ApiError.conflict('同一项目内 SKU 已存在');
    throw error;
  }
}

export async function updateProduct(id:string,input:UpdateProductInput,actor:AuthUser):Promise<ProductDto>{
  requireAdmin(actor);const projectId=requireProjectId(actor);
  if(!Types.ObjectId.isValid(id))throw ApiError.notFound('产品不存在');
  try{
    const row=await Product.findOneAndUpdate(
      {_id:new Types.ObjectId(id),projectId:new Types.ObjectId(projectId)},
      {$set:input},
      {new:true,runValidators:true},
    );
    if(!row)throw ApiError.notFound('产品不存在');
    return toDto(row.toObject() as unknown as IProduct & {_id:Types.ObjectId});
  }catch(error){
    if((error as {code?:number}).code===11000)throw ApiError.conflict('同一项目内 SKU 已存在');
    throw error;
  }
}

export async function archiveProduct(id:string,actor:AuthUser):Promise<ProductDto>{
  return updateProduct(id,{status:'archived'},actor);
}

export async function importProducts(input:ImportProductsInput,actor:AuthUser):Promise<{created:number;updated:number;products:ProductDto[]}>{
  requireAdmin(actor);const projectId=requireProjectId(actor);
  let created=0;let updated=0;const products:ProductDto[]=[];
  for(const item of input.products){
    const existing=await Product.findOne({projectId:new Types.ObjectId(projectId),sku:item.sku});
    if(existing){
      existing.set(item);existing.set('projectId',new Types.ObjectId(projectId));await existing.save();updated+=1;
      products.push(toDto(existing.toObject() as unknown as IProduct & {_id:Types.ObjectId}));
    }else{
      const row=await Product.create({...item,projectId:new Types.ObjectId(projectId),createdBy:new Types.ObjectId(actor.id)});
      created+=1;products.push(toDto(row.toObject() as unknown as IProduct & {_id:Types.ObjectId}));
    }
  }
  return {created,updated,products};
}

/** Active products used by the deterministic quote checker. */
export async function activeProducts(actor:AuthUser):Promise<ProductDto[]>{
  const projectId=requireProjectId(actor);const now=new Date();
  const rows=await Product.find({
    projectId:new Types.ObjectId(projectId),status:'active',
    $and:[
      {$or:[{effectiveFrom:{$exists:false}},{effectiveFrom:null},{effectiveFrom:{$lte:now}}]},
      {$or:[{effectiveUntil:{$exists:false}},{effectiveUntil:null},{effectiveUntil:{$gte:now}}]},
    ],
  }).sort({sku:1}).lean();
  return rows.map(row=>toDto(row as unknown as IProduct & {_id:Types.ObjectId}));
}

export function tierForQuantity(product:ProductDto,quantity?:number):ProductPriceTier|undefined{
  if(!quantity||!Number.isFinite(quantity)||quantity<=0)return product.priceTiers[0];
  return product.priceTiers.find(tier=>quantity>=tier.minQuantity&&(tier.maxQuantity===undefined||quantity<=tier.maxQuantity));
}
