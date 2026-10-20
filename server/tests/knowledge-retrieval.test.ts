import {Customer} from '../src/models/Customer';
import {Quotation} from '../src/models/Quotation';
import {buildKnowledgeBundle} from '../src/services/agent/knowledge-grounding';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose,{Types} from 'mongoose';
import {Project} from '../src/models/Project';
import {User} from '../src/models/User';
import {AgentKnowledge} from '../src/models/AgentKnowledge';
import {KnowledgeIndexGeneration as Gen,KnowledgeIndexItem as Item} from '../src/models/KnowledgeIndex';
import {appendKnowledge,archiveKnowledge,retrieveKnowledge,productApplies} from '../src/services/agent/knowledge.service';
import {embeddingIdentity,localEmbedding} from '../src/services/knowledge/embedding';
import {requestIndex,processKnowledgeIndex} from '../src/services/knowledge/index.service';
import type {AuthUser} from '../src/types/express';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.KNOWLEDGE_RETRIEVAL_MODE='semantic';
const project=new Types.ObjectId(),foreign=new Types.ObjectId(),adminId=new Types.ObjectId(),salesId=new Types.ObjectId();
const actor:AuthUser={id:String(adminId),projectId:String(project),username:'s3-admin',displayName:'Fictional admin',role:'admin'};
const sales:AuthUser={...actor,id:String(salesId),role:'user'};
const entry=(title:string,content:string)=>({expectedVersion:0,title,content,category:'product' as const,source:'fixture://s3',approved:true,applicability:'FICTIONAL ONLY; never a real policy',products:[],validFrom:new Date('2020-01-01')});
let memory:MongoMemoryServer,dir:string,target:string,privateId:string,longId:string;
const long=('Fictional technical description for zipper travel pouches. ').repeat(45)+'\nFootnote: price USD 7.31 per piece only for 2000 pcs after artwork approval. Freight excluded.';
async function build(){const t=await requestIndex(actor,crypto.randomUUID());await processKnowledgeIndex(t.id);assert.equal((await Gen.findById(t.id))?.state,'ready',JSON.stringify((await Gen.findById(t.id))?.error));return t.id;}
before(async()=>{
 assert.ok(process.env.KNOWLEDGE_RERANKER_DIR,'Pinned real local reranker is required');assert.ok(process.env.KNOWLEDGE_MODEL_DIR);
 dir=await mkdtemp(join(tmpdir(),'genesis-s3-fictional-'));process.env.KNOWLEDGE_INDEX_DIR=dir;
 memory=await MongoMemoryServer.create();await mongoose.connect(memory.getUri('s3_fictional_only'));
 await Project.insertMany([{_id:project,name:'FICTIONAL S3',slug:'s3-fictional',code:'S3',companyName:'FICTIONAL ONLY',mailProfileKey:'s3'}, {_id:foreign,name:'Other FICTIONAL S3',slug:'s3-foreign',code:'S3B',companyName:'FICTIONAL ONLY',mailProfileKey:'s3b'}]);
 await User.insertMany([{_id:adminId,username:'s3-admin',passwordHash:'not-a-login',displayName:'S3',role:'admin',projectIds:[project,foreign]}, {_id:salesId,username:'s3-sales',passwordHash:'not-a-login',displayName:'S3 sales',role:'user',projectIds:[project]}]);
 target=await appendKnowledge(undefined,entry('Nylon zipper pouch','Nylon zipper pouches for travel accessories.'),actor);
 privateId=await appendKnowledge(undefined,{...entry('Private nylon zipper margin','Private nylon zipper costing canary 94821.'),accessScope:'admins'},actor);
 longId=await appendKnowledge(undefined,entry('Long zipper specifications',long),actor);
 for(let n=0;n<35;n++)await appendKnowledge(undefined,entry('Recovery fixture '+n,'Fictional kraft paper shopping bag number '+n+'. Reinforced handles for retail gifts.'),actor);
 await appendKnowledge(undefined,entry('FOREIGN CANARY ZK-77','ZK-77 MOQ 891 pcs. Foreign project only.'),{...actor,projectId:String(foreign)});
 await build();
});
after(async()=>{await mongoose.disconnect();await memory?.stop();if(dir)await rm(dir,{recursive:true,force:true});});
test('S3 01 Chinese free query finds the S2 missed source among 35 similar recovery records',async()=>{
 const b=await retrieveKnowledge(sales,'尼龙拉链旅行收纳袋');assert.equal(b.status,'ready');assert.equal(b.sources[0]?.knowledgeId,target);assert.ok(b.retrieval?.trace);
 const scores=b.sources[0].index?.scores;assert.ok(scores&&Number.isFinite(scores.rerank));
});
test('S3 02 all four real branches prefilter private/cross-project candidates and expose scores',async()=>{
 for(const mode of ['bm25','vector','hybrid','hybrid_rerank'] as const){
  const b=await retrieveKnowledge(sales,'nylon zipper travel pouch',undefined,mode);assert.equal(b.status,'ready');assert.ok(b.sources.some(s=>s.knowledgeId===target));assert.ok(b.sources.every(s=>s.knowledgeId!==privateId));
  const trace=b.retrieval?.trace as {candidates:{knowledgeId:string}[];degraded?:unknown};assert.ok(trace.candidates.every(c=>c.knowledgeId!==privateId));if(mode==='hybrid_rerank')assert.equal(trace.degraded,null);
 }
});
test('S3 03 lossless tokenizer windows cover every codepoint including a long conditional fact',async()=>{
 const identity=await embeddingIdentity();const text='首饰包装😀 '.repeat(60)+'MOQ 731 pcs only after approved artwork; USD 2.71 per piece; freight excluded.';
 const result=await localEmbedding.run({command:'segment',projectId:String(project),atoms:[{key:'a',text}]},identity);
 assert.ok(result.segments&&result.segments.length>1);const covered=new Set<number>();
 for(const w of result.segments!){assert.ok(w.tokens<=128);assert.equal(w.text,Array.from(text).slice(w.start,w.end).join(''));for(let i=w.start;i<w.end;i++)covered.add(i);}
 assert.equal(covered.size,Array.from(text).length);
});
test('S3 04 recovered parent retains complete price, currency, quantity and final footnote',async()=>{
 // Evidence is the accepted windows of the publication, not the whole document:
 // the long body may be trimmed, but the conditional footnote must never be lost.
 const result=await retrieveKnowledge(sales,'zipper specifications artwork freight', [longId]);const source=result.sources.find(s=>s.knowledgeId===longId);
 assert.ok(source);assert.match(source.content,/Footnote: price USD 7\.31 per piece only for 2000 pcs after artwork approval\. Freight excluded\.$/);
 assert.ok(source.index!.chunks.length>=1);
});
test('S3 05 long multi-question input is handled without silent 128-token truncation',async()=>{
 const q='Please explain nylon zipper travel pouch construction. '.repeat(16)+'What material is used and which closure is available?';
 const b=await retrieveKnowledge(sales,q);assert.equal(b.status,'ready');assert.ok(Number(b.retrieval?.trace?.queryParts)>1);
 const tooLong=await retrieveKnowledge(sales,'长问题和很多不同主题 '.repeat(5000));assert.equal(tooLong.status,'retrieval_failed');assert.ok(tooLong.issues.some(i=>i.code==='query_budget'));
});
test('S3 06 unavailable reranker degrades explicitly using authorized current candidates',async()=>{
 const saved=process.env.KNOWLEDGE_RERANKER_DIR;process.env.KNOWLEDGE_RERANKER_DIR=join(dir,'missing-reranker');
 try{const b=await retrieveKnowledge(sales,'nylon zipper travel pouch');assert.equal(b.status,'ready');assert.ok(b.issues.some(i=>i.code==='rerank_failed'));assert.ok(b.sources.every(s=>s.knowledgeId!==privateId));}
 finally{process.env.KNOWLEDGE_RERANKER_DIR=saved;}
});
test('S3 07 unknown exact model cannot be substituted by another product or project',async()=>{
 const b=await retrieveKnowledge(sales,'What is the ZK-77 minimum quantity?');assert.equal(b.status,'no_match');assert.deepEqual(b.sources,[]);
 assert.ok(productApplies(['nylon zipper travel pouch'],'尼龙拉链旅行袋'));
});
test('S3 08 lexical diagnostics identify disabled/expired/future without publishing their body',async()=>{
 const disabled=await appendKnowledge(undefined,entry('Retired copper finish','Do not reveal retired copper process canary.'),actor);await archiveKnowledge(disabled,1,actor);
 await AgentKnowledge.create({projectId:project,version:1,approvedVersion:1,revisions:[{...entry('Expired cotton certificate CERT-81','EXPIRED BODY CANARY'),version:1,validUntil:new Date('2021-01-01'),createdBy:adminId,createdAt:new Date()}]});
 await build();
 for(const [q,code] of [['retired copper finish','disabled'],['CERT-81 cotton certificate','expired']]){
  const b=await retrieveKnowledge(sales,q);assert.ok(b.issues.some(i=>i.code===code));assert.ok(!JSON.stringify(b.sources).includes('CANARY'));
 }
});
test('S3 09 administrator test endpoint is protected and rejects model-supplied scope',async()=>{
 const {createApp}=await import('../src/app');const {signToken}=await import('../src/services/auth.service');const http=createApp().listen(0,'127.0.0.1');await once(http,'listening');const port=(http.address() as import('node:net').AddressInfo).port;
 const headers=(a:AuthUser)=>({Authorization:'Bearer '+signToken(a).token,'X-Project-Id':a.projectId!,'Content-Type':'application/json'});
 try{
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/knowledge-index/search`,{method:'POST',headers:headers(sales),body:JSON.stringify({query:'nylon'})})).status,403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/knowledge-index/search`,{method:'POST',headers:headers(actor),body:JSON.stringify({query:'nylon',projectId:String(foreign)})})).status,422);
  const r=await fetch(`http://127.0.0.1:${port}/api/knowledge-index/search`,{method:'POST',headers:headers(actor),body:JSON.stringify({query:'尼龙拉链旅行收纳袋'})});assert.equal(r.status,200);assert.ok((await r.json() as {data:unknown}).data);
 }finally{await new Promise<void>((resolve,reject)=>http.close(e=>e?reject(e):resolve()));}
});

test('S3 10 related product text cannot masquerade as an approved price; quote-only evidence retains customer scope',async()=>{
 const buyer=await Customer.create({projectId:project,ownerId:salesId,name:'Fictional quote buyer',email:'buyer@example.test'});
 const stranger=await Customer.create({projectId:project,ownerId:salesId,name:'Fictional second buyer',email:'other@example.test'});
 await Quotation.create({projectId:project,customerId:buyer._id,quotationNo:'S3-QUOTE-ONLY',title:'Fictional exact quote',status:'accepted',version:1,currency:'USD',validityDate:new Date('2030-01-01'),items:[{productName:'KQ-27 velvet pouch',quantity:200,unitPrice:2.35,amount:470}],totalAmount:470});
 const q='KQ-27 velvet pouch price; quantity 200';
 const known=await buildKnowledgeBundle(sales,q,{customerId:buyer.id});assert.equal(known.status,'ready');assert.ok(known.sources.some(s=>s.kind==='quotation'));
 const other=await buildKnowledgeBundle(sales,q,{customerId:stranger.id});assert.equal(other.status,'no_match');assert.ok(other.sources.every(s=>s.kind!=='quotation'));
 const freight=await buildKnowledgeBundle(sales,'nylon zipper pouch freight price to buyer warehouse');assert.equal(freight.status,'no_match');assert.ok(freight.issues.some(i=>i.code==='missing'));
});

test('S3 11 historical-title ACL changes during inference block the whole response before evidence assembly',async()=>{
 const record=await AgentKnowledge.create({projectId:project,version:1,approvedVersion:1,revisions:[{...entry('Race metadata CERT-41','HISTORICAL BODY NOT AUTHORITY'),version:1,accessScope:'project',validUntil:new Date('2021-01-01'),createdBy:adminId,createdAt:new Date()}]});
 const {semanticKnowledge}=await import('../src/services/knowledge/index.service');const {sourceOf}=await import('../src/services/agent/knowledge.service');
 const b=await semanticKnowledge(sales,'CERT-41 current certificate',{topics:[],productApplies,sourceOf},{async run(c,i,signal){const r=await localEmbedding.run(c,i,signal);if(c.command==='query')await AgentKnowledge.updateOne({_id:record._id},{$set:{'revisions.0.accessScope':'admins'}});return r;}});
 assert.equal(b.status,'index_stale');assert.deepEqual(b.sources,[]);assert.ok(!JSON.stringify(b).includes('Race metadata'));
});
test('S3 12 valid partial evidence is not globally classified as expired by a diagnostic title',async()=>{
 const expired=await AgentKnowledge.create({projectId:project,version:1,approvedVersion:1,revisions:[{...entry('Old diagnostic note','NOT CURRENT'),version:1,validUntil:new Date('2021-01-01'),createdBy:adminId,createdAt:new Date()}]});
 const {semanticKnowledge}=await import('../src/services/knowledge/index.service');const {sourceOf}=await import('../src/services/agent/knowledge.service');
 const b=await semanticKnowledge(sales,'nylon zipper travel pouch',{topics:[],productApplies,sourceOf},{async run(c,i,signal){const r=await localEmbedding.run(c,i,signal);if(c.command==='query'&&r.trace)r.trace.diagnostics.push({code:'expired',sourceId:'knowledge:'+expired.id+':v1',title:'Old diagnostic note'});return r;}});
 assert.equal(b.status,'ready');assert.ok(b.sources.some(s=>s.knowledgeId===target));assert.ok(b.issues.some(i=>i.code==='expired'));
});
test('S5 evidence preparation uses real local semantic index and authorized publication provenance',async()=>{
 const {prepareSalesEvidence}=await import('../src/services/agent/sales-evidence');await build();
 const result=await prepareSalesEvidence(sales,{request:'请给客户写第一封开发信',history:'Quantity: 150 pcs',productHint:'nylon zipper travel pouch',kind:'first_outreach'});
 assert.equal(result.bundle.retrieval?.engine,'local_semantic');assert.equal(result.bundle.status,'ready');assert.ok(result.bundle.sources.some(s=>s.index?.dimension===384));assert.ok(result.bundle.sources.every(s=>s.knowledgeId!==privateId));assert.ok(result.bundle.sources.every(s=>s.sourceId.startsWith('knowledge:')));assert.equal(result.requirements.known.quantity,150);
});

test('S7 state discovery distinguishes a process/price question from same-product expired certification',async()=>{
 await AgentKnowledge.create({projectId:project,version:1,approvedVersion:1,archived:false,revisions:[{...entry('ZP-29 Expired optical certificate','Must not be sent to a model as active evidence.'),category:'compliance',version:1,validUntil:new Date('2020-02-01'),createdBy:adminId,createdAt:new Date()}]});
 await AgentKnowledge.create({projectId:project,version:1,approvedVersion:1,archived:true,revisions:[{...entry('Retired optical protective coating','Inactive process text must remain private.'),version:1,createdBy:adminId,createdAt:new Date()}]});
 const price=await retrieveKnowledge(actor,'What is the price for ZP-29 logo setup?');assert.ok(!price.issues.some(i=>i.code==='expired'));
 const process=await retrieveKnowledge(actor,'Can optical protective coating still be used?');assert.ok(process.issues.some(i=>i.code==='disabled'));assert.ok(!process.issues.some(i=>i.code==='expired'));
 const certificate=await retrieveKnowledge(actor,'Is the ZP-29 certificate still valid?');assert.ok(certificate.issues.some(i=>i.code==='expired'));
});

test('S3 13 exceeded historical-state capacity is an explicit failure, never a no-answer or old-policy fallback',async()=>{
 await AgentKnowledge.insertMany(Array.from({length:129},(_,n)=>({projectId:project,version:1,approvedVersion:1,revisions:[{...entry('Historical metadata '+n,'EXPIRED CANARY '+n),version:1,validUntil:new Date('2021-01-01'),createdBy:adminId,createdAt:new Date()}]})));
 const b=await retrieveKnowledge(sales,'nylon zipper travel pouch');assert.equal(b.status,'retrieval_failed');assert.ok(b.issues.some(i=>i.code==='diagnostic_budget'));assert.deepEqual(b.sources,[]);
});
