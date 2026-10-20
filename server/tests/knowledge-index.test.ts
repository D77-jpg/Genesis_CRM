import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,rename,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose,{Types} from 'mongoose';
import type {AuthUser} from '../src/types/express';
import {AgentKnowledge} from '../src/models/AgentKnowledge';
import {KnowledgeIndexGeneration as Gen,KnowledgeIndexState as State,KnowledgeIndexItem as Item} from '../src/models/KnowledgeIndex';
import {Project} from '../src/models/Project';
import {User} from '../src/models/User';
import {appendKnowledge,archiveKnowledge,retrieveKnowledge} from '../src/services/agent/knowledge.service';
import {requestIndex,processKnowledgeIndex,indexStatus,controlIndex,cleanupIndexes,semanticKnowledge} from '../src/services/knowledge/index.service';
import {embeddingIdentity,localEmbedding,IndexError,type SemanticAdapter} from '../src/services/knowledge/embedding';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.KNOWLEDGE_RETRIEVAL_MODE='semantic';process.env.KNOWLEDGE_EMBEDDING_PYTHON='';
const a=new Types.ObjectId(),b=new Types.ObjectId(),u=new Types.ObjectId(),salesId=new Types.ObjectId();
const actor:AuthUser={id:String(u),projectId:String(a),username:'s2-fixture',displayName:'Fictional admin',role:'admin'};
const sales:AuthUser={...actor,id:String(salesId),role:'user'};
const other:AuthUser={...actor,projectId:String(b)};
let memory:MongoMemoryServer,dir:string;let mainId:string;const samples:{command:string;elapsedMs:number;rssMiB:number;embedded?:number;reused?:number}[]=[];
const real:SemanticAdapter={async run(command,identity,signal){const result=await localEmbedding.run(command,identity,signal);samples.push({command:String(command.command),elapsedMs:result.elapsedMs,rssMiB:result.rssMiB,embedded:result.embedded,reused:result.reused});return result;}};
const policy=(title:string,content:string)=>({expectedVersion:0,title,content,source:'FICTIONAL S2 approval only',category:'product' as const,approved:true,applicability:'Fictional test product only',tags:[],products:[],validFrom:new Date('2020-01-01')});
async function build(who=actor){const task=await requestIndex(who,randomUUID());await processKnowledgeIndex(task.id,real);const g=await Gen.findById(task.id);assert.equal(g?.state,'ready',JSON.stringify(g?.error));return task.id;}
async function query(text:string,who=actor){return retrieveKnowledge(who,text);}
before(async()=>{
 assert.ok(process.env.KNOWLEDGE_MODEL_DIR,'Real pinned model is REQUIRED, no mock fallback');
 assert.ok(process.env.KNOWLEDGE_PYTHON||process.env.KNOWLEDGE_EMBEDDING_PYTHON);
 dir=await mkdtemp(join(tmpdir(),'genesis-s2-fictional-'));process.env.KNOWLEDGE_INDEX_DIR=dir;
 memory=await MongoMemoryServer.create({instance:{dbName:'s2_isolated_fictional'}});await mongoose.connect(memory.getUri('s2_isolated_fictional'));
 await Project.insertMany([{_id:a,name:'FICTIONAL S2 packaging',slug:'s2-pack',code:'S2A',companyName:'Fictional only',mailProfileKey:'s2-a'},
 {_id:b,name:'FICTIONAL S2 fitness',slug:'s2-gym',code:'S2B',companyName:'Fictional only',mailProfileKey:'s2-b'}]);
 await User.insertMany([{_id:u,username:'s2-fixture',passwordHash:'not-a-login',displayName:'Fictional admin',role:'admin',projectIds:[a,b]},
 {_id:salesId,username:'s2-sales',passwordHash:'not-a-login',displayName:'Fictional sales',role:'user',projectIds:[a]}]);
 await Promise.all([State.init(),Gen.init(),Item.init(),AgentKnowledge.init()]);
 mainId=await appendKnowledge(undefined,policy('Velvet jewelry pouches','Soft velvet pouches protect jewelry, rings and necklaces. Drawstring closure. Custom logo printing.'),actor);
 await appendKnowledge(undefined,policy('Paper gift boxes','Rigid cardboard gift boxes with magnetic closure. Designed for gift packaging.'),actor);
 await appendKnowledge(undefined,policy('Steel squat rack','Steel squat rack with adjustable bar hooks for weightlifting exercise.'),actor);
});
after(async()=>{
 if(process.env.S2_RESULTS)await writeFile(process.env.S2_RESULTS,JSON.stringify({schemaVersion:1,fictional:true,realEmbedding:true,mockedLLM:true,
  model:await embeddingIdentity(),samples,maxRssMiB:Math.max(...samples.map(s=>s.rssMiB)),generatedAt:new Date().toISOString(),limitations:['Small independent engineering fixtures; not the S3 holdout quality gate','Dimension migration simulates an incompatible old manifest, not a second real model']},null,2));
 await mongoose.disconnect();await memory?.stop();if(dir)await rm(dir,{recursive:true,force:true});
});
test('01 not-ready is explicit; keyword contents are never silently returned',async()=>{
 const result=await query('velvet jewelry pouch');assert.equal(result.status,'index_not_ready');assert.deepEqual(result.sources,[]);
});
test('02 real 384-dimension ONNX vectors persist in sqlite-vec and cross languages',async()=>{
 const id=await build();const result=await query('用于保护戒指和项链的柔软绒布抽绳袋');
 assert.equal(result.status,'ready');assert.equal(result.retrieval?.engine,'local_semantic');assert.equal(result.sources[0]?.knowledgeId,mainId);
 assert.equal(result.sources[0].index?.dimension,384);assert.ok(result.sources[0].index?.chunks[0].contentHash);
 const second=await query('soft fabric bags for necklaces');assert.equal(second.sources[0]?.knowledgeId,mainId);
 const g=await Gen.findById(id);assert.ok(g?.embedded);assert.ok((await readFile(join(dir,'semantic.sqlite3'))).length>4096);
});
test('03 rebuild reuses real vectors only inside the same project AND visibility scope',async()=>{
 const first=await build();const g=await Gen.findById(first);assert.equal(g?.embedded,0);assert.ok(g?.reused);
 const foreign=await appendKnowledge(undefined,policy('Velvet jewelry pouches','Soft velvet pouches protect jewelry, rings and necklaces. Drawstring closure. Custom logo printing.'),other);
 const foreignGen=await build(other);assert.ok((await Gen.findById(foreignGen))!.embedded>0);
 const result=await query('velvet jewelry pouch');assert.ok(result.sources.every(s=>s.knowledgeId!==foreign));
});
test('04 private admin publication is filtered BEFORE local candidate evaluation',async()=>{
 const secret=await appendKnowledge(undefined,{...policy('Private margin memo','Private margin review for velvet pouches.'),accessScope:'admins'},actor);await build();
 const seen:string[][]=[];const guard:SemanticAdapter={async run(command,identity,signal){if(command.command==='query')seen.push(command.allowed as string[]);return real.run(command,identity,signal);}};
 const service=await import('../src/services/agent/knowledge.service');
 const result=await semanticKnowledge(sales,'margin velvet',{topics:[],productApplies:service.productApplies,sourceOf:service.sourceOf},guard);
 const privateItems=await Item.find({knowledgeId:secret});assert.ok(privateItems.length);assert.ok(seen.flat().every(id=>!privateItems.some(i=>i.itemId===id)));
 assert.ok(result.sources.every(s=>s.knowledgeId!==secret));
});
test('05 unreviewed / expired / disabled source atoms do not enter generations',async()=>{
 const draft=await appendKnowledge(undefined,{...policy('Draft-only canary','DRAFT CANARY 987654'),approved:false},actor);
 const expired=await AgentKnowledge.create({projectId:a,version:1,approvedVersion:1,revisions:[{...policy('Expired policy','EXPIRED CANARY'),version:1,validUntil:new Date('2021-01-01'),createdBy:u,createdAt:new Date()}]});
 const disabled=await appendKnowledge(undefined,policy('Disabled policy','DISABLED CANARY'),actor);await archiveKnowledge(disabled,1,actor);
 const id=await build();assert.equal(await Item.countDocuments({generation:id,knowledgeId:{$in:[draft,expired._id,disabled]}}),0);
});
test('06 publication update invalidates immediately; draft edit retains last published version',async()=>{
 await appendKnowledge(mainId,{...policy('Velvet jewelry pouches','Reviewed new velvet pouch facts.'),expectedVersion:1,approved:false},actor);
 assert.equal((await query('velvet jewelry pouch')).status,'ready');
 await appendKnowledge(mainId,{...policy('Velvet jewelry pouches','Reviewed new velvet pouch facts. Soft drawstring bags for jewelry.'),expectedVersion:2},actor);
 assert.equal((await query('velvet jewelry pouch')).status,'index_stale');await build();
 const result=await query('velvet pouch');assert.equal(result.sources.find(s=>s.knowledgeId===mainId)?.version,3);
});
test('07 disable/delete/expiry bypassing CRUD cannot leak stale evidence',async()=>{
 await AgentKnowledge.updateOne({_id:mainId},{$set:{archived:true}});assert.equal((await query('velvet pouch')).status,'index_stale');await build();
 assert.ok((await query('velvet pouch')).sources.every(s=>s.knowledgeId!==mainId));
 const temp=await appendKnowledge(undefined,policy('Fictional deletion','Cotton shopping bags with handles.'),actor);await build();await AgentKnowledge.deleteOne({_id:temp});
 assert.equal((await query('cotton tote')).status,'index_stale');await build();
 const exp=await appendKnowledge(undefined,policy('Fictional expiry','Linen travel bags with zipper.'),actor);await build();
 await AgentKnowledge.updateOne({_id:exp},{$set:{'revisions.0.validUntil':new Date('2021-01-01')}});
 assert.equal((await query('linen bag')).status,'index_stale');await build();
});
test('08 current project membership and actor role are rechecked on query and management',async()=>{
 await assert.rejects(()=>requestIndex(sales),/管理员/);
 await User.updateOne({_id:salesId},{$set:{projectIds:[]}});assert.equal((await query('paper box',sales)).status,'retrieval_failed');
 await User.updateOne({_id:salesId},{$set:{projectIds:[a]}});assert.equal((await query('paper box',sales)).status,'ready');
 const active=String((await State.findOne({projectId:a}))!.activeGeneration);await assert.rejects(()=>controlIndex(other,active,'retry'));
});
test('09 evidence assembly repeats Mongo checks after local inference',async()=>{
 const target=await appendKnowledge(undefined,policy('Concurrent policy','Cotton drawstring bags for gifts.'),actor);await build();
 const changing:SemanticAdapter={async run(c,i,s){const result=await real.run(c,i,s);if(c.command==='query')await AgentKnowledge.updateOne({_id:target},{$set:{archived:true}});return result;}};
 const service=await import('../src/services/agent/knowledge.service');
 const result=await semanticKnowledge(actor,'cotton gift bag',{topics:[],productApplies:service.productApplies,sourceOf:service.sourceOf},changing);
 assert.equal(result.status,'index_stale');assert.deepEqual(result.sources,[]);await build();
});
test('10 duplicate tasks and concurrent claims are idempotent',async()=>{
 const key=randomUUID();const results=await Promise.all([requestIndex(actor,key),requestIndex(actor,key)]);
 assert.equal(results[0].id,results[1].id);await Promise.all([processKnowledgeIndex(results[0].id,real),processKnowledgeIndex(results[0].id,real)]);
 assert.equal((await Gen.findById(results[0].id))?.attempts,1);
});
test('11 real worker process dies after a committed batch; replacement resumes checkpoints',async()=>{
 for(let n=0;n<35;n++)await appendKnowledge(undefined,policy('Recovery fixture '+n,'Fictional kraft paper shopping bag number '+n+'. Reinforced handles for retail gifts.'),actor);
 const task=await requestIndex(actor,randomUUID());
 const child=spawn(process.execPath,['--require','./tests/os-user-info.cjs','--import','tsx','./tests/fixtures/knowledge-s2/worker.ts',task.id],{cwd:resolve(__dirname,'..'),windowsHide:true,
  env:Object.fromEntries(Object.entries({...process.env,MONGODB_URI:memory.getUri('s2_isolated_fictional')}).filter(([key])=>['SystemRoot','WINDIR','PATH','TEMP','TMP','MONGODB_URI','KNOWLEDGE_PYTHON','KNOWLEDGE_EMBEDDING_PYTHON','KNOWLEDGE_MODEL_DIR','KNOWLEDGE_INDEX_DIR'].includes(key))),stdio:'ignore'});
 const deadline=Date.now()+60000;let done=0;
 while(Date.now()<deadline){const g=await Gen.findById(task.id);done=g?.done??0;if(done>=16&&g?.state==='running')break;if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,50));}
 const closed=child.exitCode===null?once(child,'close'):Promise.resolve();child.kill();await closed;assert.ok(done>=16,'real worker committed a checkpoint');
 const before=await Gen.findById(task.id);assert.equal(before?.state,'running');
 // Fast-forward the durable lease rather than waiting 30 seconds; the process really was killed.
 await Gen.updateOne({_id:task.id},{$set:{leaseUntil:new Date(0)}});await processKnowledgeIndex(task.id,real);
 const final=await Gen.findById(task.id);assert.equal(final?.state,'ready',JSON.stringify(final?.error));assert.equal(final?.attempts,2);assert.equal(final?.done,final?.total);
});
test('12 incompatible legacy dimension/identity is rejected; fresh real-model generation migrates',async()=>{
 const old=String((await State.findOne({projectId:a}))!.activeGeneration);await Gen.updateOne({_id:old},{$set:{'identity.dimension':768,'identity.id':'incompatible-old-model-fixture'}});
 assert.equal((await query('paper gift bag')).status,'index_stale');await assert.rejects(()=>controlIndex(actor,old,'rollback'),/模型已变化/);
 const fresh=await build();assert.notEqual(fresh,old);assert.equal((await query('paper gift bag')).sources[0]?.index?.dimension,384);
});
test('13 failed generation never replaces active pointer; retry and cancellation retain checkpoints',async()=>{
 const old=String((await State.findOne({projectId:a}))!.activeGeneration),task=await requestIndex(actor,randomUUID());
 const unavailable:SemanticAdapter={async run(){throw new IndexError('runtime_unavailable','Fictional local runtime unavailable');}};
 await processKnowledgeIndex(task.id,unavailable);assert.equal((await Gen.findById(task.id))?.state,'failed');assert.equal(String((await State.findOne({projectId:a}))!.activeGeneration),old);
 await controlIndex(actor,task.id,'retry');await processKnowledgeIndex(task.id,real);assert.equal((await Gen.findById(task.id))?.state,'ready');
 const cancel=await requestIndex(actor,randomUUID());await controlIndex(actor,cancel.id,'cancel');await processKnowledgeIndex(cancel.id,real);assert.equal((await Gen.findById(cancel.id))?.state,'failed');
});
test('14 validated generation switch and cleanup protect active/current publications',async()=>{
 const first=await build(),second=await build();await controlIndex(actor,first,'rollback',real);assert.equal(String((await State.findOne({projectId:a}))!.activeGeneration),first);
 await Gen.updateOne({_id:second},{$set:{updatedAt:new Date(0)}},{timestamps:false});const cleaned=await cleanupIndexes(actor,real);assert.ok(cleaned.removed>=1);
 assert.equal((await Gen.findById(first))?.state,'ready');assert.equal((await Gen.findById(second))?.state,'deleted');assert.equal(await Item.countDocuments({generation:second}),0);
 await assert.rejects(()=>controlIndex(actor,second,'rollback'));assert.equal((await query('paper bag')).status,'ready');
});
test('15 missing local index fails explicitly; rebuild restores from Mongo without policy changes',async()=>{
 const file=join(dir,'semantic.sqlite3'),backup=join(dir,'semantic.backup');await rename(file,backup);
 const result=await query('paper bag');assert.equal(result.status,'retrieval_failed','empty new SQLite must not look like a valid no-match');
 await build();assert.equal((await query('paper bag')).status,'ready');
});
test('16 long publication indexes lossless retrieval windows and keeps the final condition in evidence',async()=>{
 const content=('conditional specification ').repeat(300)+'Final condition: MOQ 731 pcs only after artwork approval; freight excluded.';
 const id=await appendKnowledge(undefined,policy('Long fixture',content),actor);await build();
 const result=await retrieveKnowledge(actor,'conditional specification',[id]);const source=result.sources.find(s=>s.knowledgeId===id);
 // Evidence is the accepted windows, not the whole publication; the conditional tail must survive.
 assert.ok(source);assert.match(source.content,/Final condition: MOQ 731 pcs only after artwork approval; freight excluded\.$/);
 assert.ok(source.index!.chunks.length>1);
 assert.ok(source.index!.chunks.every(c=>!!c.location.retrievalWindow));
 await archiveKnowledge(id,1,actor);await build();
});

test('17 S1 document → reviewed draft → approved revision → semantic evidence preserves provenance',async()=>{
 const {uploadDocument,processKnowledgeDocument,documentDetail,saveChunkDraft}=await import('../src/services/knowledge/document.service');
 const text='# Fictional zipper pouch\nNylon zipper pouches for travel accessories.';
 const doc=await uploadDocument({fileName:'s2-fictional.md',data:Buffer.from(text).toString('base64'),source:'Synthetic integration file',category:'product'},actor);
 await processKnowledgeDocument();const detail=await documentDetail(doc.id,actor);assert.ok(detail.chunks.length);
 const chunk=detail.chunks[0];assert.ok(chunk.content);const draft=await saveChunkDraft(chunk.id,{title:'Nylon zipper pouch',content:chunk.content,category:'product',applicability:'Fictional nylon travel product only'},actor);
 const saved=await AgentKnowledge.findById(draft.id);assert.equal(saved?.approvedVersion,0);
 await appendKnowledge(saved!.id,{...policy('Nylon zipper pouch',chunk.content),expectedVersion:1},actor);await build();
 const unconstrained=await query('尼龙拉链旅行收纳袋');console.log('S2 diagnostic: free-text provenance source retrieved:',unconstrained.sources.some(s=>s.knowledgeId===saved!.id));
 const result=await retrieveKnowledge(actor,'尼龙拉链旅行收纳袋',[saved!.id]);const source=result.sources.find(s=>s.knowledgeId===saved!.id);
 assert.ok(source?.index?.chunks.some(c=>c.sourceRefs.some(ref=>ref.documentId===doc.id&&ref.chunkId===chunk.id)));
});

test('18 condition-backed inquiry reply uses real indexed policy; missing freight stays unconfirmed',async()=>{
 const id=await appendKnowledge(undefined,{...policy('Fictional standard pouch policy','Velvet pouches for jewelry.'),category:'trade',terms:[
 {topic:'moq',value:'73',conditions:'standard velvet pouch only',unit:'pcs',mode:'confirmed',scope:{reviewed:true,products:['velvet pouch'],processes:[],exclusions:[],polarity:'affirmed'}},
 {topic:'lead_time',value:'19',conditions:'after artwork approval; standard velvet pouch',unit:'working days',mode:'confirmed',scope:{reviewed:true,products:['velvet pouch'],processes:[],startsAfter:'artwork approval',exclusions:[],polarity:'affirmed'}},
 {topic:'sample',value:'Stock samples available',conditions:'courier charge requires confirmation',mode:'confirmed',scope:{reviewed:true,products:['velvet pouch'],processes:[],exclusions:[],polarity:'affirmed'}},
 ]},actor);await build();
 const {buildKnowledgeBundle,auditGroundedEmail}=await import('../src/services/agent/knowledge-grounding');
 const bundle=await buildKnowledgeBundle(actor,'velvet pouch MOQ lead time sample and freight',{ids:[id]});
 const result=auditGroundedEmail('Hello. Our freight is USD 999. Best regards, invented',bundle,{taskType:'inquiry_reply'});
 assert.ok(result.bodyText.includes('73'));assert.ok(result.bodyText.includes('19'));assert.ok(!result.bodyText.includes('999'));
 assert.ok(result.review.questions.some(q=>q.topic==='shipping'&&q.status==='unanswered'));
 assert.ok(result.review.sources.find(s=>s.knowledgeId===id)?.index?.modelName.includes('multilingual'));
});
test('19 identical text cannot reuse admin-only cache entries in a broader publication scope',async()=>{
 const v=policy('Scope fixture','Cotton fabric bags for retail.');
 const id=await appendKnowledge(undefined,{...v,accessScope:'admins'},other);const g1=await build(other);assert.ok((await Gen.findById(g1))!.embedded>0);
 await appendKnowledge(id,{...v,expectedVersion:1,accessScope:'project'},other);const g2=await build(other);
 assert.ok((await Gen.findById(g2))!.embedded>0,'new broader scope must not reuse private-scope cached embeddings');
});
test('20 administrator HTTP controls enforce current identity and project; extra project keys rejected',async()=>{
 const {createApp}=await import('../src/app');const {signToken}=await import('../src/services/auth.service');
 const http=createApp().listen(0,'127.0.0.1');await once(http,'listening');const port=(http.address() as import('node:net').AddressInfo).port;
 const auth=(who:AuthUser)=>({Authorization:'Bearer '+signToken(who).token,'X-Project-Id':who.projectId!,'Content-Type':'application/json'});
 try{
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/knowledge-index`,{headers:auth(sales)})).status,403);
  const status=await fetch(`http://127.0.0.1:${port}/api/knowledge-index`,{headers:auth(actor)});assert.equal(status.status,200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/knowledge-index/rebuild`,{method:'POST',headers:auth(actor),body:JSON.stringify({requestKey:randomUUID(),projectId:String(b)})})).status,422);
 }finally{await new Promise<void>((resolve,reject)=>http.close(e=>e?reject(e):resolve()));}
});

test('21 standalone real Embedding adapter yields finite normalized semantic vectors, not hashes',async()=>{
 const identity=await embeddingIdentity();const result=await localEmbedding.embed(['soft velvet jewelry pouch','柔软绒布珠宝袋','steel squat rack'],identity);
 assert.equal(result.dimension,384);assert.equal(result.vectors.length,3);
 for(const vector of result.vectors){assert.equal(vector.length,384);assert.ok(vector.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...vector)-1)<0.001);}
 const dot=(a:number[],b:number[])=>a.reduce((sum,n,i)=>sum+n*b[i],0);
 const cross=dot(result.vectors[0],result.vectors[1]),unrelated=dot(result.vectors[0],result.vectors[2]);assert.ok(cross>unrelated+0.15);
 console.log('Real model semantic cosine:',JSON.stringify({crossLanguage:cross,unrelated}));
});

test('22 interrupted old-generation cleanup can retry immediately and preserves the active generation',async()=>{
 const old=await build(),active=await build();await Gen.updateOne({_id:old},{$set:{updatedAt:new Date(0)}},{timestamps:false});
 const failing:SemanticAdapter={async run(){throw new IndexError('cleanup_failure','Fictional storage interruption');}};
 await assert.rejects(()=>cleanupIndexes(actor,failing));assert.equal((await Gen.findById(old))?.state,'deleting');
 await cleanupIndexes(actor,real);assert.equal((await Gen.findById(old))?.state,'deleted');assert.equal((await Gen.findById(active))?.state,'ready');
 assert.equal(String((await State.findOne({projectId:a}))!.activeGeneration),active);
});

test('23 legacy editors omitting access scope retain admin-only publication permissions',async()=>{
 const v=policy('Legacy private editor fixture','Private sample review for cotton bags.');
 const id=await appendKnowledge(undefined,{...v,accessScope:'admins'},actor);
 await appendKnowledge(id,{...v,expectedVersion:1,content:'Updated private sample review for cotton bags.'},actor);
 const record=await AgentKnowledge.findById(id);assert.equal(record?.revisions.at(-1)?.accessScope,'admins');
 await build();assert.ok((await query('private cotton sample',sales)).sources.every(s=>s.knowledgeId!==id));
});
