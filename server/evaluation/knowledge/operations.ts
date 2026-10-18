/** S7 isolated scale run: actual locked local models, no external calls, no real DB. */
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose,{Types} from 'mongoose';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir,cpus,totalmem,platform,release} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {AgentKnowledge} from '../../src/models/AgentKnowledge';
import {KnowledgeIndexGeneration as Gen,KnowledgeIndexItem as Item} from '../../src/models/KnowledgeIndex';
import {Project} from '../../src/models/Project';import {User} from '../../src/models/User';
import {requestIndex,processKnowledgeIndex} from '../../src/services/knowledge/index.service';
import {retrieveKnowledge} from '../../src/services/agent/knowledge.service';
import {embeddingIdentity,semanticPool,sha} from '../../src/services/knowledge/embedding';
import type {AuthUser} from '../../src/types/express';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.KNOWLEDGE_RETRIEVAL_MODE='semantic';
async function main(){
 const count=Number(process.env.S7_BENCH_ITEMS??10000),concurrency=2,output=process.env.S7_REPORT;
 if(!output||!Number.isInteger(count)||count<16||count>10000)throw Error('Explicit report path and 16..10000 fictional rows required');
 const dir=await mkdtemp(join(tmpdir(),'genesis-s7-scale-')),memory=await MongoMemoryServer.create();
 process.env.KNOWLEDGE_INDEX_DIR=dir;
 const samples:Record<string,unknown>[]=[],report:Record<string,unknown>={schemaVersion:1,fictional:true,realEmbedding:true,realRerank:true,externalLLMCalls:0,concurrency,count,startedAt:new Date(),machine:{platform:platform(),release:release(),cpu:cpus()[0].model,logicalCpus:cpus().length,totalMemory:totalmem(),node:process.version,cpuThreadsPerWorker:4,maxWorkers:2},samples};
 try{
 await mongoose.connect(memory.getUri('s7_scale_fictional_only'));
 const project=new Types.ObjectId(),uid=new Types.ObjectId();
 await Project.create({_id:project,name:'FICTIONAL S7 scale',slug:'s7-scale',code:'S7',companyName:'FICTIONAL ONLY',mailProfileKey:'s7'});
 await User.create({_id:uid,username:'s7-scale',displayName:'S7 fictional admin',role:'admin',passwordHash:'not-a-login',projectIds:[project]});
 const actor:AuthUser={id:String(uid),projectId:String(project),role:'admin',username:'s7-scale',displayName:'S7'};
 const materials=['velvet','cotton','linen','nylon','kraft paper','recycled cardboard','bamboo fabric','satin','jute','polyester'];
 const uses=['jewelry','travel accessories','cosmetics','retail gifts','watches','shoes','eyewear','stationery','tea','candles'];
 const docs=Array.from({length:count},(_,n)=>{const a=materials[n%10],b=uses[Math.floor(n/10)%10];return {_id:new Types.ObjectId(),projectId:project,version:1,approvedVersion:1,archived:false,revisions:[{version:1,title:'Fictional product SX-'+n,category:'product',content:`Fictional product SX-${n}: ${a} packaging for ${b}. Construction variant ${Math.floor(n/100)}. This synthetic record is not a real commercial policy.`,products:[],applicability:'FICTIONAL performance fixture only',source:'fixture://s7/scale',accessScope:'project',approved:true,validFrom:new Date('2020-01-01'),terms:[],sourceRefs:[],createdBy:uid,createdAt:new Date('2020-01-01')}]};});
 await AgentKnowledge.insertMany(docs);const t=performance.now(),task=await requestIndex(actor,crypto.randomUUID());await processKnowledgeIndex(task.id);
 const generation=await Gen.findById(task.id);report.build={elapsedMs:performance.now()-t,state:generation?.state,errorCode:generation?.error?.code,total:generation?.total,embedded:generation?.embedded,reused:generation?.reused,stored:await Item.countDocuments({generation:task.id}),identity:await embeddingIdentity()};
 if(generation?.state!=='ready')throw Error('generation_not_ready');
 const ask=async(n:number,phase:string)=>{const start=performance.now();const q=n%2===0?'What is the material of fictional product SX-'+(n*137%count)+'?':'虚构产品 SX-'+(n*137%count)+' 使用什么包装材料？';const result=await retrieveKnowledge(actor,q);const sample={phase,n,elapsedMs:performance.now()-start,status:result.status,sources:result.sources.length,issueCodes:result.issues.map(i=>i.code),trace:result.retrieval?.trace?.timings};samples.push(sample);return sample;};
 // Reopen fresh workers: cold includes weight integrity verification and model/session load.
 // First query loads the real Rerank session; Embedding may remain warm from the build.
 await Promise.all([ask(0,'cold_rerank'),ask(1,'cold_rerank')]);
 for(let n=2;n<42;n+=concurrency)await Promise.all([ask(n,'warm'),ask(n+1,'warm')]);
 const warm=samples.filter(s=>s.phase==='warm'),durations=warm.map(s=>Number(s.elapsedMs)).sort((a,b)=>a-b),p95=durations[Math.ceil(.95*durations.length)-1];
 report.result={warmRequests:warm.length,warmP50Ms:durations[Math.ceil(.5*durations.length)-1],warmP95Ms:p95,warmMaxMs:durations.at(-1),failures:warm.filter(s=>s.status!=='ready').length,performanceGate:count===10000&&generation.total>=10000&&p95<=5000&&warm.every(s=>s.status==='ready'),fixedTargetMs:5000,qualityGate:'not measured by this synthetic scale run',pool:semanticPool.status(),nodeRssMiB:process.memoryUsage().rss/1024**2};
 report.sourceHashes=await Promise.all(['src/services/knowledge/index.service.ts','src/services/knowledge/process-pool.ts','semantic/runtime.py','semantic/retrieval.py'].map(async path=>({path,sha256LF:sha((await readFile(path,'utf8')).replace(/\r\n/g,'\n'))})));
 }catch(e){report.failure=e instanceof Error?e.message:'scale_failed';process.exitCode=1;}finally{report.finishedAt=new Date();await writeFile(output,JSON.stringify(report,null,2));semanticPool.close();await mongoose.disconnect();await memory.stop();await rm(dir,{recursive:true,force:true});}
}
void main();
