import './runtime-safety';
// Independent in-memory MongoDB only. This entry point never starts app/mail workers or an LLM.
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {mock} from 'node:test';
import {Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {loadFixtures,type EvaluationCase} from './schema';
import {summarize,grouped,type Observation} from './metrics';
import type {AuthUser} from '../../src/types/express';

process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.NODE_ENV='test';
const oid=(label:string)=>new Types.ObjectId(createHash('sha256').update('knowledge-s0:'+label).digest('hex').slice(0,24));
const normalized=(text:string)=>text.toLowerCase().replace(/\s+/g,' ').trim();
async function main(){
 const split=process.argv.find(arg=>arg.startsWith('--split='))?.split('=')[1]??'dev';
 if(!['dev','holdout','all'].includes(split))throw Error('Invalid split');
 const output=resolve(process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)??join(__dirname,'../../tmp/knowledge-s0/baseline-'+split+'.json'));
 const fixtures=loadFixtures();const runAtUTC=new Date().toISOString();let clockFrozen=false;
 const memory=await MongoMemoryServer.create();process.env.MONGODB_URI=memory.getUri('knowledge-s0-isolated');
 const mongoose=(await import('mongoose')).default;
 try{
  await mongoose.connect(memory.getUri('knowledge-s0-isolated'));
  mock.timers.enable({apis:['Date'],now:new Date(fixtures.corpus.asOf)});clockFrozen=true;
  const {Project,User,Customer,Quotation,DevelopmentLetter,FollowUp}=await import('../../src/models');
  const {AgentKnowledge}=await import('../../src/models/AgentKnowledge');
  const {MailMessage}=await import('../../src/models/MailMessage');
  const {buildKnowledgeBundle,auditGroundedEmail}=await import('../../src/services/agent/knowledge-grounding');
  const {getCustomerByIdOrThrow}=await import('../../src/services/customer.service');
  const {agentMailOrThrow}=await import('../../src/services/agent/mail-access');
  const {executeAgentTool}=await import('../../src/services/agent/tool-registry');
  await Project.insertMany(['pack','gym'].map(p=>({_id:oid(p),name:'FICTIONAL S0 '+p,slug:'fictional-s0-'+p,code:p.toUpperCase(),companyName:'Fixture Company',mailProfileKey:p})));
  await User.insertMany(['u1','u2','admin'].map(u=>({_id:oid(u),username:'fixture-'+u,passwordHash:'not-a-login',displayName:'Fixture '+u,role:u==='admin'?'admin':'user',projectIds:[oid('pack'),oid('gym')]})));
  await Customer.insertMany(['c1','c2'].map((c,i)=>({_id:oid(c),projectId:oid('pack'),ownerId:oid(i?'u2':'u1'),name:i?'Birch':'Acorn',company:'Fictional Buyer',email:c+'@example.test',expectedQuantity:'200',interestedProducts:'velvet pouch'})));
  await Customer.insertMany([{_id:oid('cGym'),projectId:oid('gym'),ownerId:oid('u1'),name:'Fictional Gym Buyer',email:'gym@example.test'},{_id:oid('cPool'),projectId:oid('pack'),name:'Fictional Unassigned',email:'pool@example.test'}]);
  await MailMessage.insertMany([
   ['private-other','pack','u2','c1',false],['private-reassigned','pack','u1','c2',false],['private-deleted','pack','u1','c1',true],['private-foreign','gym','u2','cGym',false],
  ].map(([id,project,owner,customer,deleted])=>({_id:oid(String(id)),projectId:oid(String(project)),mailboxUserId:oid(String(owner)),customerId:oid(String(customer)),dedupKey:String(id),threadId:String(id),from:'fixture@example.test',to:['owner@example.test'],text:'Fictional personal mail; not seller policy.',sentAt:new Date(),deleted})));
  for(const s of fixtures.corpus.sources){
   if(s.kind==='quotation'){
    await Quotation.create({_id:oid(s.id),projectId:oid(s.project),customerId:oid('c1'),quotationNo:'S0-ACORN-200',title:s.title,status:'accepted',version:1,currency:'USD',validityDate:new Date('2030-12-31'),items:[{productName:'velvet pouch',quantity:200,unitPrice:2.35,amount:470}],totalAmount:470});continue;
   }
   const revision={version:1,title:s.title,tags:s.tags,content:s.content,source:s.source,approved:s.state!=='draft',category:s.category,applicability:'Fixture only; respect stated product and commercial conditions',products:s.products,terms:s.terms,
    validFrom:new Date(s.state==='future'?'2035-01-01':'2020-01-01'),validUntil:s.state==='expired'?new Date('2025-12-31'):new Date('2050-01-01'),createdBy:oid('admin'),createdAt:new Date('2026-01-01')};
   await AgentKnowledge.create({_id:oid(s.id),projectId:oid(s.project),version:s.draftContent?2:1,approvedVersion:s.state==='draft'?0:1,archived:s.state==='disabled',revisions:[revision,...(s.draftContent?[{...revision,version:2,approved:false,content:s.draftContent}]:[])]});
  }
  const byMongoId=new Map(fixtures.corpus.sources.map(s=>[String(oid(s.id)),s]));
  const actorFor=(c:EvaluationCase):AuthUser=>({id:String(oid(c.actor)),username:'fixture-'+c.actor,displayName:'Fixture',role:c.actor==='admin'?'admin':'user',projectId:String(oid(c.project))});
  const observations:Observation[]=[];let productionFind=AgentKnowledge.find;
  for(const c of fixtures.cases.filter(c=>split==='all'||c.split===split)){
   const started=performance.now();const row:Observation={id:c.id,split:c.split,language:c.language,crossLanguage:c.crossLanguage,category:c.category,expected:c.expected,observed:'unclassified',required:c.required,rankedEvidence:[],durationMs:0,forbiddenHits:[]};
   try{
    const actor=actorFor(c);
    if(c.operation==='customer'){await getCustomerByIdOrThrow(String(oid(c.customer!)),actor);row.observed='allowed';if(c.expected==='forbidden')row.forbiddenHits.push(c.operation+':'+(c.customer??c.mail??'fixture'));}
    else if(c.operation==='mail'){await agentMailOrThrow(String(oid(c.mail!)),actor);row.observed='allowed';if(c.expected==='forbidden')row.forbiddenHits.push(c.operation+':'+(c.customer??c.mail??'fixture'));}
    else if(c.operation==='tool'){try{await executeAgentTool('search_product_knowledge',{actor},c.toolArguments!);row.observed='allowed';if(c.expected==='forbidden')row.forbiddenHits.push(c.operation+':'+(c.customer??c.mail??'fixture'));}catch(error){if((error as Error).name==='ZodError')row.observed='forbidden';else throw error;}}
    else{
     if(c.fault)AgentKnowledge.find=(()=>{throw Error('Explicit S0 isolated retrieval failure');}) as typeof AgentKnowledge.find;
     const bundle=await buildKnowledgeBundle(actor,c.query,{customerId:c.customer?String(oid(c.customer)):undefined,ids:c.foreignIds?.map(id=>String(oid(id)))});
     AgentKnowledge.find=productionFind;
     const review=auditGroundedEmail('Thank you for your inquiry.',bundle,{taskType:'evaluation'}).review;
     row.rawStatus=bundle.status;row.issueCodes=review.issues.map(issue=>issue.code);
     row.rankedEvidence=bundle.sources.slice(0,10).map(hit=>{
      const s=byMongoId.get(hit.knowledgeId??hit.quotationId??'');if(!s||hit.version!==s.version)return [];
      const evidence=normalized(hit.content+' '+JSON.stringify(hit.terms));
      return s.clauses.filter(clause=>clause.matchAll?clause.matchAll.every(part=>evidence.includes(normalized(part))):evidence.includes(normalized(clause.quote))).map(clause=>clause.id);
     });
     for(const hit of bundle.sources){const source=byMongoId.get(hit.knowledgeId??hit.quotationId??'');if(source&&(source.project!==c.project||source.state!=='active'||c.forbidden.some(id=>source.clauses.some(clause=>clause.id===id))))row.forbiddenHits.push(source.id);}
     // This transparent adapter maps existing returned states; it adds no semantic model,
     // no golden-answer lookup, and cannot manufacture a missing draft-only signal.
     row.observed=review.status==='retrieval_failed'?'retrieval_failed':review.status==='conflict'?'conflict':
      row.issueCodes.includes('expired')?'expired':row.issueCodes.includes('disabled')?'disabled':row.issueCodes.includes('not_effective')?'not_effective':
      bundle.sources.some(hit=>hit.category!=='sales_rules')?'answerable':'no_match';
    }
   }catch(error){const e=error as {statusCode?:number;name?:string};row.observed=e.statusCode===404||e.statusCode===403?'forbidden':'error';row.error=e.name??'Unknown';}
   finally{AgentKnowledge.find=productionFind;row.durationMs=Number((performance.now()-started).toFixed(3));}
   observations.push(row);
  }
  const sent=await DevelopmentLetter.countDocuments(),followups=await FollowUp.countDocuments();
  if(sent||followups)throw Error('Read-only baseline unexpectedly wrote mail/follow-up');
  const hashes=Object.fromEntries(['corpus.json','cases.dev.json','cases.holdout.json','probe-set.json','baseline.ts','schema.ts','metrics.ts','runtime-safety.ts'].map(file=>[file,createHash('sha256').update(readFileSync(join(__dirname,file))).digest('hex')]));
  const report={schemaVersion:1,createdAt:runAtUTC,evaluationAsOf:fixtures.corpus.asOf,clockPolicy:'Date-only frozen in isolated CLI; performance.now remains real; production retrieval unchanged',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtyTree:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,engine:'unchanged production buildKnowledgeBundle + auditGroundedEmail',scope:'No LLM or live DB. No email generation quality measured. Existing knowledge retrieval returns at most 4 base + 6 other entries; Recall@10 does not pretend it returned 10.',split,hashes,machine:{os:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalRamBytes:os.totalmem(),node:process.version},fixture:{sources:50,cases:120},productionHashes:Object.fromEntries(['knowledge.service.ts','knowledge-grounding.ts','mail-access.ts'].map(file=>[file,createHash('sha256').update(readFileSync(join(__dirname,'../../src/services/agent',file))).digest('hex')])),summary:summarize(observations),bySplit:grouped(observations,r=>r.split),byLanguage:grouped(observations,r=>r.language),byCrossLanguage:grouped(observations,r=>String(r.crossLanguage)),byCategory:grouped(observations,r=>r.category),rows:observations,sideEffects:{letters:sent,followups}};
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,summary:report.summary,bySplit:report.bySplit,sideEffects:report.sideEffects}));
 }finally{if(clockFrozen)mock.timers.reset();await mongoose.disconnect();await memory.stop();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Evaluation failed');process.exitCode=1;});
