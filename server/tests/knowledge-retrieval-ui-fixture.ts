// Disposable UI acceptance: no real DB, customers, external LLM, or mail workers.
import {MongoMemoryServer} from 'mongodb-memory-server';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.KNOWLEDGE_RETRIEVAL_MODE='semantic';
async function main(){
 const indexDir=await mkdtemp(join(tmpdir(),'genesis-s3-ui-fictional-'));process.env.KNOWLEDGE_INDEX_DIR=indexDir;
 const memory=await MongoMemoryServer.create({instance:{dbName:'s3_ui_fictional'}});
 const mongoose=await import('mongoose');await mongoose.connect(memory.getUri('s3_ui_fictional'));
 const {Project,User,hashPassword}=await import('../src/models');
 const p=await Project.create({name:'S3 虚构知识验收',slug:'s3-ui-demo',code:'S3DEMO',companyName:'FICTIONAL ONLY',mailProfileKey:'s3-fixture',isDefault:true});
 const u=await User.create({username:'s3-demo',passwordHash:await hashPassword(['S3','fictional','only'].join('-')),displayName:'知识管理员（测试）',role:'admin',projectIds:[p._id],defaultProjectId:p._id});
 const {appendKnowledge}=await import('../src/services/agent/knowledge.service');const actor={id:u.id,projectId:p.id,username:u.username,displayName:u.displayName,role:'admin' as const};
 await appendKnowledge(undefined,{expectedVersion:0,title:'虚构绒布袋资料',content:'Soft velvet drawstring pouches for jewelry, rings and necklaces.',source:'独立虚构验收资料；不是公司真实政策',category:'product',applicability:'仅限本次虚构测试',approved:true},actor);
 await appendKnowledge(undefined,{expectedVersion:0,title:'虚构销售规则',content:'Do not invent freight prices or certificates. Send only after human review.',source:'独立虚构验收规则',category:'sales_rules',applicability:'仅限本次虚构测试',approved:true},actor);
 const {requestIndex}=await import('../src/services/knowledge/index.service');
 const preparation=await requestIndex(actor);const service=await import('../src/services/knowledge/index.service');await service.processKnowledgeIndex(preparation.id);
 const {createApp}=await import('../src/app');const {processKnowledgeIndex}=await import('../src/services/knowledge/index.service');
 const http=createApp().listen(5003,'127.0.0.1');let busy=false;
 const timer=setInterval(()=>{if(busy)return;busy=true;void processKnowledgeIndex().finally(()=>{busy=false;});},700);
 if(process.env.S3_UI_RECEIPT)await writeFile(process.env.S3_UI_RECEIPT,JSON.stringify({pid:process.pid,port:5003,fictional:true,indexDir}));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{clearInterval(timer);http.close(()=>{void mongoose.disconnect().then(()=>memory.stop()).then(()=>rm(indexDir,{recursive:true,force:true})).then(()=>process.exit(0));});});
 console.log('S3 fictional UI ready on 5003. Real local vectors; no mail workers.');
}
void main().catch(e=>{console.error('S3 fixture failed:',e.name);process.exit(1);});
