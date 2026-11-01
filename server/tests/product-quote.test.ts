import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import type {AuthUser} from '../src/types/express';

let memory:MongoMemoryServer;
let mongoose:typeof import('mongoose');
let Product:typeof import('../src/models/Product').Product;
let Customer:typeof import('../src/models/Customer').Customer;
let createProduct:typeof import('../src/services/product.service').createProduct;
let updateProduct:typeof import('../src/services/product.service').updateProduct;
let checkQuote:typeof import('../src/services/quote-check.service').checkQuote;
let createQuotation:typeof import('../src/services/quotation.service').createQuotation;
let fixtureProduct:Awaited<ReturnType<typeof import('../src/services/product.service').createProduct>>;

const projectId=new Types.ObjectId();
const adminId=new Types.ObjectId();
const customerId=new Types.ObjectId();
const actor:AuthUser={id:adminId.toString(),username:'admin',displayName:'Admin',role:'admin',projectId:projectId.toString()};

before(async()=>{
  memory=await MongoMemoryServer.create();
  mongoose=await import('mongoose');
  await mongoose.default.connect(memory.getUri(),{dbName:'product-quote-tests'});
  ({Product}=await import('../src/models/Product'));
  ({Customer}=await import('../src/models/Customer'));
  await Product.init();
  await Customer.init();
  await Customer.create({_id:customerId,projectId,name:'Fixture Buyer',company:'Fixture Buyer Co',email:'buyer@example.test',ownerId:adminId});
  ({createProduct,updateProduct}=await import('../src/services/product.service'));
  ({checkQuote}=await import('../src/services/quote-check.service'));
  ({createQuotation}=await import('../src/services/quotation.service'));
  fixtureProduct=await makeProduct();
});

after(async()=>{
  await mongoose.default.disconnect();
  await memory.stop();
});

async function makeProduct(){
  return createProduct({
    sku:'POUCH-01',name:'Jewelry Pouch',category:'Jewelry packaging',status:'active',
    specs:[{code:'MAT',name:'Material',value:'Cotton canvas'},{code:'SIZE',name:'Size',value:'8x10',unit:'cm'}],
    priceTiers:[{minQuantity:100,maxQuantity:499,unitPrice:1.2,currency:'USD'},{minQuantity:500,unitPrice:0.98,currency:'USD'}],
    moq:'100 pcs',leadTime:'25 days',
  },actor);
}

test('product catalog stores specs and non-overlapping quantity tiers',async()=>{
  assert.equal(fixtureProduct.sku,'POUCH-01');assert.equal(fixtureProduct.specs.length,2);assert.equal(fixtureProduct.priceTiers.length,2);
  const partial=await updateProduct(fixtureProduct.id,{moq:'50 pcs'},actor);
  assert.equal(partial.moq,'50 pcs');assert.equal(partial.specs.length,2);assert.equal(partial.priceTiers.length,2);
  await assert.rejects(()=>createProduct({sku:'BAD-TIER',name:'Bad',specs:[],priceTiers:[{minQuantity:10,maxQuantity:20,unitPrice:1,currency:'USD'},{minQuantity:15,unitPrice:2,currency:'USD'}]},actor));
  await assert.rejects(()=>createProduct({sku:'BAD-ORDER',name:'Bad order',specs:[],priceTiers:[{minQuantity:500,unitPrice:0.9,currency:'USD'},{minQuantity:100,unitPrice:1.2,currency:'USD'}]},actor));
});

test('quote check matches the right tier and never invents a missing quotation',async()=>{
  const first=await checkQuote({customerId:customerId.toString(),items:[{name:'POUCH-01',quantity:200}]},actor);
  assert.equal(first.items[0]?.status,'catalog_missing');assert.equal(first.items[0]?.tier?.unitPrice,1.2);
  assert.equal(first.summary.blockers,0);
  const bulk=await checkQuote({customerId:customerId.toString(),items:[{name:'Jewelry Pouch',quantity:600}]},actor);
  assert.equal(bulk.items[0]?.tier?.unitPrice,0.98);
  assert.equal(bulk.items[0]?.status,'catalog_missing');
});

test('quote check flags price below catalog and quantity-tier drift',async()=>{
  await createQuotation(customerId.toString(),{
    title:'Fixture quote',currency:'USD',status:'sent',
    items:[{productName:'Jewelry Pouch',model:'POUCH-01',quantity:200,unitPrice:1.0}],
  },actor);
  const result=await checkQuote({customerId:customerId.toString(),items:[{name:'POUCH-01',quantity:200}]},actor);
  assert.equal(result.items[0]?.status,'below_catalog');
  assert.ok(result.items[0]?.messages.some(message=>message.includes('低于当前目录价')));
  assert.equal(result.summary.blockers,1);
  const mismatch=await checkQuote({customerId:customerId.toString(),items:[{name:'POUCH-01',quantity:600}]},actor);
  assert.ok(['price_mismatch','below_catalog','review_required'].includes(mismatch.items[0]?.status ?? ''));
  assert.ok(mismatch.items[0]?.messages.some(message=>message.includes('数量')));
});

test('unknown products are reported instead of fuzzy-priced',async()=>{
  const result=await checkQuote({customerId:customerId.toString(),items:[{name:'Unlisted ceramic mug',quantity:100}]},actor);
  assert.equal(result.items[0]?.status,'product_missing');
  assert.equal(result.summary.blockers,1);
});
