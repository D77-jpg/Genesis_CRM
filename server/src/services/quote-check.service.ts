import {Types} from 'mongoose';
import {Quotation} from '../models';
import {ApiError} from '../utils/ApiError';
import {getCustomerByIdOrThrow} from './customer.service';
import {activeProducts,tierForQuantity,type ProductDto} from './product.service';
import {getMailThreadAnalysis} from './agent/mail-thread-analysis.service';
import type {AuthUser} from '../types/express';

export type QuoteCheckStatus='matched'|'catalog_missing'|'product_missing'|'quantity_missing'|'price_mismatch'|'below_catalog'|'review_required';

export interface QuoteCheckItem{
  requestedName:string;
  requestedQuantity?:number;
  product?:{id:string;sku:string;name:string;category?:string};
  tier?:{minQuantity:number;maxQuantity?:number;unitPrice:number;currency:string;moq?:string;leadTime?:string};
  quoted?:{quotationId:string;quotationNo:string;productName:string;quantity:number;unitPrice:number;currency:string;createdAt:Date};
  status:QuoteCheckStatus;
  messages:string[];
}

export interface QuoteCheckResult{
  customerId?:string;
  analysisId?:string;
  checkedAt:string;
  items:QuoteCheckItem[];
  summary:{matched:number;warnings:number;blockers:number;message:string};
  sources:{products:{id:string;sku:string;name:string}[];quotations:{id:string;quotationNo:string;createdAt:Date}[]};
}

export interface QuoteCheckInput{
  analysisId?:string;
  customerId?:string;
  items?:{name:string;quantity?:number}[];
}

function parseQuantity(text:string|undefined):number|undefined{
  if(!text)return undefined;
  const m=/(\d[\d,]*)/.exec(text.replace(/\s+/g,' '));
  if(!m)return undefined;
  const value=Number(m[1].replace(/,/g,''));
  return Number.isFinite(value)&&value>0?value:undefined;
}

function normalize(value:string){return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}

type ProductMatch={product:ProductDto;confidence:'exact'|'contains'|'fuzzy'};

function matchProduct(name:string,products:ProductDto[]):ProductMatch|undefined{
  const wanted=normalize(name);
  if(!wanted)return undefined;
  const exact=products.find(product=>wanted===normalize(product.sku)||wanted===normalize(product.name));
  if(exact)return {product:exact,confidence:'exact'};
  const contains=products.filter(product=>{
    const sku=normalize(product.sku);const productName=normalize(product.name);
    return (sku&&wanted.includes(sku))||(productName&&(wanted.includes(productName)||productName.includes(wanted)));
  }).sort((a,b)=>b.name.length-a.name.length);
  if(contains[0])return {product:contains[0],confidence:'contains'};
  const words=new Set(wanted.split(' ').filter(word=>word.length>=3&&!['for','the','and','with','your','our'].includes(word)));
  let best:{product:ProductDto;score:number}|undefined;
  for(const product of products){
    const haystack=normalize([product.name,product.category,product.description,...product.specs.flatMap(spec=>[spec.name,spec.value])].filter(Boolean).join(' '));
    let score=0;for(const word of words)if(haystack.includes(word))score+=1;
    if(score>=(best?.score??0)&&score>0)best={product,score};
  }
  return best?{product:best.product,confidence:'fuzzy'}:undefined;
}

function matchQuotationItem(name:string,quotation:{items:{productName:string;model?:string;quantity:number;unitPrice:number}[]}){
  const wanted=normalize(name);
  return quotation.items.find(item=>{
    const values=[item.productName,item.model].filter(Boolean).map(value=>normalize(String(value)));
    return values.some(value=>value===wanted||value.includes(wanted)||wanted.includes(value));
  });
}

export async function checkQuote(input:QuoteCheckInput,actor:AuthUser):Promise<QuoteCheckResult>{
  let analysisId:string|undefined;let customerId=input.customerId;let targetPrice:number|undefined;
  let requested=input.items??[];
  if(input.analysisId){
    const analysis=await getMailThreadAnalysis(input.analysisId,actor);
    analysisId=analysis.id;customerId=analysis.customerId;
    const quantity=parseQuantity(analysis.extracted.quantity.value);
    targetPrice=parseQuantity(analysis.extracted.price.value);
    requested=analysis.extracted.products.map(item=>({name:item.value,quantity})).filter(item=>item.name.trim());
  }
  if(!customerId)throw ApiError.badRequest('缺少客户，无法核对报价');
  await getCustomerByIdOrThrow(customerId,actor);
  if(!requested.length)throw ApiError.badRequest('未识别到要核对的产品，请先填写产品名称');

  const products=await activeProducts(actor);
  const quotations=await Quotation.find({
    projectId:new Types.ObjectId(requireProjectIdFromActor(actor)),
    customerId:new Types.ObjectId(customerId),
  }).sort({createdAt:-1}).limit(10).lean();
  const items:QuoteCheckItem[]=requested.slice(0,50).map(request=>{
    const match=matchProduct(request.name,products);const product=match?.product;
    if(!product||!match){
      return {
        requestedName:request.name,requestedQuantity:request.quantity,status:'product_missing' as const,
        messages:['产品目录中没有匹配项；请先在产品与价格页维护 SKU/规格。'],
      };
    }
    const tier=tierForQuantity(product,request.quantity);
    if(!request.quantity)return {
      requestedName:request.name,product:{id:product.id,sku:product.sku,name:product.name,category:product.category},
      ...(tier?{tier:{minQuantity:tier.minQuantity,maxQuantity:tier.maxQuantity,unitPrice:tier.unitPrice,currency:tier.currency,moq:tier.moq,leadTime:tier.leadTime}}:{}),
      status:'quantity_missing' as const,messages:['客户未给出明确数量；先确认数量，再锁定价格档。'],
    };
    if(!tier)return {
      requestedName:request.name,requestedQuantity:request.quantity,
      product:{id:product.id,sku:product.sku,name:product.name,category:product.category},
      status:'review_required' as const,messages:['数量超出当前价格档；请人工确认阶梯价或 MOQ。'],
    };
    const matchedQuotation=quotations.find(quotation=>Boolean(matchQuotationItem(request.name,quotation)));
    const quoted=matchedQuotation?matchQuotationItem(request.name,matchedQuotation):undefined;
    const quotedValue=quoted&&matchedQuotation?{
      quotationId:String(matchedQuotation._id),quotationNo:matchedQuotation.quotationNo,productName:quoted.productName,
      quantity:quoted.quantity,unitPrice:quoted.unitPrice,currency:matchedQuotation.currency,createdAt:matchedQuotation.createdAt,
    }:undefined;
    const messages:string[]=[];
    let status:QuoteCheckStatus='matched';
    if(match.confidence==='fuzzy'){messages.push('产品名称是模糊匹配，请确认 SKU 后再引用价格。');status='review_required';}
    if(!quotedValue){messages.push('客户还没有对应报价单；本次只能引用产品目录价，发出前需生成正式报价。');status='catalog_missing';}
    else if(quotedValue.currency!==tier.currency){messages.push(`报价币种 ${quotedValue.currency} 与目录币种 ${tier.currency} 不一致。`);status='price_mismatch';}
    else if(quotedValue.unitPrice<tier.unitPrice){messages.push(`历史报价 ${quotedValue.unitPrice} 低于当前目录价 ${tier.unitPrice}，禁止直接沿用。`);status='below_catalog';}
    else if(quotedValue.unitPrice>tier.unitPrice){messages.push(`历史报价 ${quotedValue.unitPrice} 高于当前目录价 ${tier.unitPrice}，请确认是否含特殊工艺/运费。`);status='price_mismatch';}
    if(quoted&&quoted.quantity!==request.quantity){messages.push(`历史报价数量 ${quoted.quantity} 与本次 ${request.quantity} 不同，价格档需重新确认。`);if(status==='matched')status='review_required';}
    if(targetPrice&&targetPrice<tier.unitPrice){messages.push(`邮件提到的价格 ${targetPrice} 低于当前目录价 ${tier.unitPrice}，不能直接接受。`);if(status==='matched'||status==='review_required')status='below_catalog';}
    const moqText=product.moq||tier.moq;const moq=parseQuantity(moqText);
    if(moq&&request.quantity<moq){messages.push(`本次数量低于目录 MOQ ${moqText}，需先确认是否接受小单。`);if(status==='matched')status='review_required';}
    return {
      requestedName:request.name,requestedQuantity:request.quantity,
      product:{id:product.id,sku:product.sku,name:product.name,category:product.category},
      tier:{minQuantity:tier.minQuantity,maxQuantity:tier.maxQuantity,unitPrice:tier.unitPrice,currency:tier.currency,moq:tier.moq,leadTime:tier.leadTime},
      ...(quotedValue?{quoted:quotedValue}:{}),status,
      messages:messages.length?messages:['目录价、数量档与历史报价一致。'],
    };
  });
  const blockers=items.filter(item=>['product_missing','below_catalog','price_mismatch'].includes(item.status)).length;
  const warnings=items.filter(item=>['catalog_missing','quantity_missing','review_required'].includes(item.status)).length;
  return {
    ...(customerId?{customerId}:{}),...(analysisId?{analysisId}:{}),checkedAt:new Date().toISOString(),items,
    summary:{matched:items.filter(item=>item.status==='matched').length,warnings,blockers,
      message:blockers?'存在报价风险，不能直接按历史价回复。':warnings?'有需要确认的报价信息。':'目录价与历史报价一致。'},
    sources:{
      products:items.flatMap(item=>item.product?[{id:item.product.id,sku:item.product.sku,name:item.product.name}]:[]),
      quotations:[...new Map(items.flatMap(item=>item.quoted?[[item.quoted.quotationId,{id:item.quoted.quotationId,quotationNo:item.quoted.quotationNo,createdAt:item.quoted.createdAt}]]:[])).values()],
    },
  };
}

function requireProjectIdFromActor(actor:AuthUser):string{
  if(!actor.projectId)throw ApiError.badRequest('缺少项目上下文');
  return actor.projectId;
}
