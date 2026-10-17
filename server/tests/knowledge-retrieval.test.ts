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
 const result=await retrieveKnowledge(sales,'zipper specifications artwork freight', [longId]);const source=result.sources.find(s=>s.knowledgeId===longId);assert.equal(source?.content,long);assert.ok(source.index!.chunks.length>1);
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
