import './tenant-setup';
import {Schema,model,Types,type HydratedDocument,type Model} from 'mongoose';
import {QUOTATION_CURRENCY,type QuotationCurrency} from '../constants';

export type ProductStatus='active'|'archived';

/** A named, reusable specification value. Keep values atomic so a quote can cite them. */
export interface ProductSpec{
  code:string;
  name:string;
  value:string;
  unit?:string;
  notes?:string;
}

/** Quantity-based price tier. The tier is a catalog reference, not a quotation. */
export interface ProductPriceTier{
  minQuantity:number;
  maxQuantity?:number;
  unitPrice:number;
  currency:QuotationCurrency;
  moq?:string;
  leadTime?:string;
  notes?:string;
}

export interface IProduct{
  projectId:Types.ObjectId;
  sku:string;
  name:string;
  category?:string;
  description?:string;
  status:ProductStatus;
  specs:ProductSpec[];
  priceTiers:ProductPriceTier[];
  moq?:string;
  leadTime?:string;
  notes?:string;
  source?:string;
  effectiveFrom?:Date;
  effectiveUntil?:Date;
  createdBy?:Types.ObjectId;
  createdAt:Date;
  updatedAt:Date;
}

export type ProductDocument=HydratedDocument<IProduct>;
export type ProductModel=Model<IProduct>;

const specSchema=new Schema<ProductSpec>({
  code:{type:String,required:true,trim:true,maxlength:60},
  name:{type:String,required:true,trim:true,maxlength:120},
  value:{type:String,required:true,trim:true,maxlength:500},
  unit:{type:String,trim:true,maxlength:40},
  notes:{type:String,trim:true,maxlength:1000},
},{_id:false});

const tierSchema=new Schema<ProductPriceTier>({
  minQuantity:{type:Number,required:true,min:1},
  maxQuantity:{type:Number,min:1},
  unitPrice:{type:Number,required:true,min:0.000001},
  currency:{type:String,required:true,enum:QUOTATION_CURRENCY,uppercase:true},
  moq:{type:String,trim:true,maxlength:120},
  leadTime:{type:String,trim:true,maxlength:120},
  notes:{type:String,trim:true,maxlength:1000},
},{_id:false});

const ProductSchema=new Schema<IProduct>({
  projectId:{type:Schema.Types.ObjectId,required:true,index:true},
  sku:{type:String,required:true,trim:true,uppercase:true,maxlength:80},
  name:{type:String,required:true,trim:true,maxlength:200},
  category:{type:String,trim:true,maxlength:120},
  description:{type:String,trim:true,maxlength:4000},
  status:{type:String,enum:['active','archived'],default:'active',index:true},
  specs:{type:[specSchema],default:[]},
  priceTiers:{type:[tierSchema],default:[]},
  moq:{type:String,trim:true,maxlength:120},
  leadTime:{type:String,trim:true,maxlength:120},
  notes:{type:String,trim:true,maxlength:4000},
  source:{type:String,trim:true,maxlength:500},
  effectiveFrom:Date,
  effectiveUntil:Date,
  createdBy:{type:Schema.Types.ObjectId,ref:'User'},
},{timestamps:true,versionKey:false});

ProductSchema.pre('validate',function(next){
  const specs=this.specs??[];
  if(new Set(specs.map(s=>s.code.toUpperCase())).size!==specs.length)this.invalidate('specs','规格编码不能重复');
  const tiers=this.priceTiers??[];
  tiers.forEach((tier,index)=>{
    if(tier.maxQuantity!==undefined&&tier.maxQuantity<tier.minQuantity)this.invalidate(`priceTiers.${index}.maxQuantity`,'价格区间上限不能小于下限');
  });
  for(let i=1;i<tiers.length;i+=1){
    const previous=tiers[i-1];
    if(previous.maxQuantity===undefined||tiers[i].minQuantity<=previous.maxQuantity)this.invalidate('priceTiers','价格区间必须按数量升序且互不重叠');
  }
  if(this.effectiveUntil&&this.effectiveFrom&&this.effectiveUntil<=this.effectiveFrom)this.invalidate('effectiveUntil','失效时间必须晚于生效时间');
  next();
});

ProductSchema.index({projectId:1,sku:1},{unique:true});
ProductSchema.index({projectId:1,status:1,updatedAt:-1});
ProductSchema.index({projectId:1,category:1,name:1});

export const Product=model<IProduct,ProductModel>('Product',ProductSchema);
export default Product;
