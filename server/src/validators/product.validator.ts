import {z} from 'zod';
import {QUOTATION_CURRENCY} from '../constants';
import {idParamsSchema,isoDateSchema,optionalText,paginationQuerySchema} from './common';

const skuSchema=z.string().trim().min(1,'SKU 不能为空').max(80,'SKU 不能超过 80 个字符')
  .regex(/^[A-Za-z0-9._-]+$/,'SKU 只能包含字母、数字、点、下划线和连字符')
  .transform(value=>value.toUpperCase());

const specSchema=z.object({
  code:z.string().trim().min(1,'规格编码不能为空').max(60),
  name:z.string().trim().min(1,'规格名称不能为空').max(120),
  value:z.string().trim().min(1,'规格值不能为空').max(500),
  unit:optionalText(40),
  notes:optionalText(1000),
}).strict();

const tierSchema=z.object({
  minQuantity:z.coerce.number().int().positive('起订数量必须大于 0').max(1_000_000_000),
  maxQuantity:z.coerce.number().int().positive().max(1_000_000_000).optional(),
  unitPrice:z.coerce.number().positive('单价必须大于 0').max(1_000_000_000),
  currency:z.enum(QUOTATION_CURRENCY).default('USD'),
  moq:optionalText(120),
  leadTime:optionalText(120),
  notes:optionalText(1000),
}).strict().superRefine((value,ctx)=>{
  if(value.maxQuantity!==undefined&&value.maxQuantity<value.minQuantity){
    ctx.addIssue({code:'custom',path:['maxQuantity'],message:'价格区间上限不能小于下限'});
  }
});

const productFieldsSchema=z.object({
  sku:skuSchema,
  name:z.string().trim().min(1,'产品名称不能为空').max(200),
  category:optionalText(120),
  description:optionalText(4000),
  status:z.enum(['active','archived']).default('active'),
  specs:z.array(specSchema).max(50).default([]).superRefine((specs,ctx)=>{
    const seen=new Set<string>();
    specs.forEach((spec,index)=>{
      const code=spec.code.toUpperCase();
      if(seen.has(code))ctx.addIssue({code:'custom',path:[index,'code'],message:'规格编码不能重复'});
      seen.add(code);
    });
  }),
  priceTiers:z.array(tierSchema).max(50).default([]).superRefine((tiers,ctx)=>{
    for(let i=1;i<tiers.length;i+=1){
      const previous=tiers[i-1];
      if(previous.maxQuantity===undefined||tiers[i].minQuantity<=previous.maxQuantity){
        ctx.addIssue({code:'custom',path:[i,'minQuantity'],message:'价格区间必须按数量升序且互不重叠'});
      }
    }
  }),
  moq:optionalText(120),
  leadTime:optionalText(120),
  notes:optionalText(4000),
  source:optionalText(500),
  effectiveFrom:isoDateSchema.optional(),
  effectiveUntil:isoDateSchema.optional(),
}).strict();

export const createProductSchema=productFieldsSchema.superRefine((value,ctx)=>{
  if(value.effectiveFrom&&value.effectiveUntil&&value.effectiveUntil<=value.effectiveFrom){
    ctx.addIssue({code:'custom',path:['effectiveUntil'],message:'失效时间必须晚于生效时间'});
  }
});

const updateFieldsSchema=productFieldsSchema.omit({status:true,specs:true,priceTiers:true}).partial().extend({
  status:z.enum(['active','archived']).optional(),
  specs:z.array(specSchema).max(50).optional().superRefine((specs,ctx)=>{
    if(!specs)return;
    const seen=new Set<string>();
    specs.forEach((spec,index)=>{
      const code=spec.code.toUpperCase();
      if(seen.has(code))ctx.addIssue({code:'custom',path:[index,'code'],message:'规格编码不能重复'});
      seen.add(code);
    });
  }),
  priceTiers:z.array(tierSchema).max(50).optional().superRefine((tiers,ctx)=>{
    if(!tiers)return;
    for(let i=1;i<tiers.length;i+=1){
      const previous=tiers[i-1];
      if(previous.maxQuantity===undefined||tiers[i].minQuantity<=previous.maxQuantity){
        ctx.addIssue({code:'custom',path:[i,'minQuantity'],message:'价格区间必须按数量升序且互不重叠'});
      }
    }
  }),
});

export const updateProductSchema=updateFieldsSchema.refine(
  value=>Object.keys(value).length>0,
  {message:'请至少提供一个需要修改的字段'},
).refine(
  value=>!value.effectiveFrom||!value.effectiveUntil||value.effectiveUntil>value.effectiveFrom,
  {path:['effectiveUntil'],message:'失效时间必须晚于生效时间'},
);

export const importProductsSchema=z.object({
  products:z.array(createProductSchema).min(1,'至少导入一个产品').max(500,'单次最多导入 500 个产品'),
}).strict();

export const listProductsQuerySchema=paginationQuerySchema.extend({
  search:z.string().trim().max(200).optional(),
  status:z.enum(['all','active','archived']).optional(),
  category:z.string().trim().max(120).optional(),
});

export {idParamsSchema};

export type CreateProductInput=z.infer<typeof createProductSchema>;
export type UpdateProductInput=z.infer<typeof updateProductSchema>;
export type ImportProductsInput=z.infer<typeof importProductsSchema>;
export type ListProductsQuery=z.infer<typeof listProductsQuerySchema>;
