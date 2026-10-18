import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {Types} from 'mongoose';
import {randomUUID} from 'node:crypto';
import type {AuthUser} from '../src/types/express';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.KNOWLEDGE_RETRIEVAL_MODE='keyword';
let db:MongoMemoryServer;let mongo:typeof import('mongoose');let tasks:typeof import('../src/services/agent/task.service');let models:typeof import('../src/models');
const project=new Types.ObjectId(),otherProject=new Types.ObjectId(),owner=new Types.ObjectId(),stranger=new Types.ObjectId();
const actor:AuthUser={id:String(owner),username:'s5-user',displayName:'Fictional Seller',projectId:String(project),role:'user'};
before(async()=>{db=await MongoMemoryServer.create();mongo=await import('mongoose');await mongo.connect(db.getUri(),{dbName:'s5-independent'});models=await import('../src/models');tasks=await import('../src/services/agent/task.service');await models.User.create({_id:owner,username:'s5-user',passwordHash:'fictional-not-login',displayName:'Fictional Seller',role:'user',projectIds:[project]});await models.User.create({_id:stranger,username:'s5-other',passwordHash:'fictional-not-login',role:'user',projectIds:[project]});await models.Project.create({_id:project,name:'S5 Fictional',slug:'s5-fictional',code:'S5',companyName:'Fictional Only',mailProfileKey:'mock'});});
after(async()=>{await mongo.disconnect();await db.stop();});
async function customer(){return models.Customer.create({projectId:project,ownerId:owner,name:'Fictional '+randomUUID().slice(0,8),email:randomUUID()+'@example.test',interestedProducts:'velvet pouch',industry:'jewelry'});}
async function task(goal:string){const c=await customer();const {createAgentSession}=await import('../src/services/agent/agent.service');const session=await createAgentSession({context:{type:'customer',resourceId:c.id}},actor);return {c,task:await tasks.createAgentTask({sessionId:session.id,goal,requestKey:randomUUID(),tokenBudget:200000},actor)};}
const goals=[['first_outreach','帮我给这个客户写第一封开发信'],['inquiry_reply','请写邮件回复这个客户的询盘'],['quotation_explanation','请给这个客户写报价说明邮件'],['sample_reply','请写样品回复邮件'],['followup_review','请给这个客户写跟进邮件']] as const;
for(const [kind,goal] of goals)test('five mail types share persisted evidence workflow: '+kind,async()=>{
 const created=await task(goal);assert.equal(created.task.kind,kind);await tasks.processAgentTask(created.task.id);const done=await tasks.getAgentTask(created.task.id,actor);assert.equal(done.status,'awaiting_review',JSON.stringify(done.error));assert.ok(done.draftId);
 for(const key of ['read_context','extract_requirements','load_rules','retrieve_0','assess_evidence','generate_email','audit_claims','handoff'])assert.ok(done.workflow.some(s=>s.key===key&&s.state==='completed'),key);
 assert.ok(done.workflow.every(s=>!('payload' in s)));const draft=await models.DevelopmentLetter.findById(done.draftId);assert.equal(draft?.knowledgeReview?.taskType,kind);assert.equal(draft?.status,'draft');assert.equal(await models.FollowUp.countDocuments({customerId:created.c._id}),0);
});
test('deterministic requirement extraction preserves known quantity/destination and does not infer policy',async()=>{
 const {extractSalesRequirements}=await import('../src/services/agent/sales-evidence');const r=extractSalesRequirements('请写样品回复邮件','Quantity: 150 pcs\nDestination: Germany\nWhat is the sample fee?','sample_reply');assert.equal(r.known.quantity,150);assert.equal(r.known.destination,'Germany');assert.ok(r.topics.includes('sample'));
 assert.equal(extractSalesRequirements('询盘','Qty: 150 pcs\nQty: 250 pcs','inquiry_reply').known.quantity,undefined);
});
test('knowledge, history or ownership changes never silently reuse an old draft',async()=>{
 const created=await task('请写样品回复邮件');await tasks.processAgentTask(created.task.id);const before=await tasks.getAgentTask(created.task.id,actor);const original=await models.DevelopmentLetter.findById(before.draftId);assert.ok(original);
 const {AgentTask}=await import('../src/models/AgentTask');await models.Customer.updateOne({_id:created.c._id},{$set:{interestedProducts:'satin pouch'}});await AgentTask.updateOne({_id:created.task.id},{$set:{status:'running',leaseToken:'dead',leaseUntil:new Date(0)}});await tasks.processAgentTask(created.task.id);const after=await tasks.getAgentTask(created.task.id,actor);assert.equal(after.status,'awaiting_review',JSON.stringify(after.error));assert.equal(after.workflowEpoch,1);assert.notEqual(after.draftId,before.draftId);assert.equal((await models.DevelopmentLetter.findById(before.draftId))?.content,original.content);assert.equal(await models.FollowUp.countDocuments({customerId:created.c._id}),0);
 await models.Customer.updateOne({_id:created.c._id},{$set:{ownerId:stranger}});await assert.rejects(()=>tasks.getAgentTask(created.task.id,actor));
});
test('step cache is fenced, input-hashed and budgets survive retry',async()=>{
 const {taskEvidenceWorkflow}=await import('../src/services/agent/evidence-workflow');const {AgentTask}=await import('../src/models/AgentTask');const created=await task('请写跟进邮件');const row=await AgentTask.findById(created.task.id);assert.ok(row);await AgentTask.updateOne({_id:row._id},{$set:{status:'running',leaseToken:'fixture-fence'}});let calls=0;
 const workflow=taskEvidenceWorkflow(row,'fixture-fence',async()=>{});const action=async()=>({answer:++calls});assert.equal((await workflow.run('generate_email',{input:'a'},action,{cache:true,tool:'model'})).answer,1);assert.equal((await workflow.run('generate_email',{input:'a'},action,{cache:true,tool:'model'})).answer,1);assert.equal(calls,1);assert.equal((await workflow.run('generate_email',{input:'b'},action,{cache:true,tool:'model'})).answer,2);
 await AgentTask.updateOne({_id:row._id},{$set:{workflowCalls:30}});await assert.rejects(()=>workflow.run('load_rules',{},action));await AgentTask.updateOne({_id:row._id},{$set:{status:'paused'}});await assert.rejects(()=>workflow.run('generate_email',{input:'a'},action,{cache:true}));assert.equal(calls,2);
});
test('expired fifth lease becomes an explicit non-retryable failure instead of looping forever',async()=>{
 const {AgentTask}=await import('../src/models/AgentTask');const created=await task('请写跟进邮件');await AgentTask.updateOne({_id:created.task.id},{$set:{status:'running',attempts:5,leaseToken:'dead',leaseUntil:new Date(0)}});await tasks.processAgentTask(created.task.id);const done=await tasks.getAgentTask(created.task.id,actor);assert.equal(done.status,'failed');assert.equal(done.error?.retryable,false);
});
test('sales rule loading enforces project, publication, expiry and administrator scope',async()=>{
 const {appendKnowledge}=await import('../src/services/agent/knowledge.service');const {prepareSalesEvidence}=await import('../src/services/agent/sales-evidence');const admin={...actor,role:'admin' as const};const title='Fictional private rule '+randomUUID();
 await appendKnowledge(undefined,{expectedVersion:0,title,category:'sales_rules',source:'fixture://private',content:'Do not invent supplier promises.',products:[],tags:[],applicability:'all',terms:[],approved:true,accessScope:'admins'},admin);
 const result=await prepareSalesEvidence(actor,{request:'请写第一封开发信',history:'',productHint:'velvet pouch',kind:'first_outreach'});assert.ok(!result.bundle.sources.some(s=>s.title===title));
 const {AgentKnowledge}=await import('../src/models/AgentKnowledge');await AgentKnowledge.create({projectId:otherProject,version:1,approvedVersion:1,revisions:[{version:1,title:'Foreign rule',content:'Foreign only',category:'sales_rules',approved:true,validFrom:new Date(0)}]});assert.ok(!result.bundle.sources.some(s=>s.title==='Foreign rule'));
});
test('actual worker termination after raw generation recovers its checkpoint without another generation',async()=>{
 const {fork}=await import('node:child_process');const {join}=await import('node:path');const {AgentTask}=await import('../src/models/AgentTask');const created=await task('请写样品回复邮件');const events:string[]=[];
 const spawn=(mode:string)=>fork(join(__dirname,'fixtures/knowledge-s5/worker.ts'),[created.task.id,mode],{execArgv:['--require',join(__dirname,'os-user-info.cjs'),'--import','tsx'],env:{...process.env,S5_TEST_MONGO:db.getUri(),S5_TEST_DB:'s5-independent'},stdio:['ignore','ignore','ignore','ipc']});
 const first=spawn('hang-audit');try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('checkpoint not reached')),20000);first.on('message',(m:unknown)=>{const value=m as {event:string};events.push(value.event);if(value.event==='audit-request'){clearTimeout(timer);resolve();}});first.once('exit',()=>{clearTimeout(timer);reject(Error('child exited too early'));});});
 assert.equal(await models.AgentCustomerAnalysis.countDocuments({customerId:created.c._id}),0);const checkpoint=await AgentTask.findById(created.task.id);assert.ok(checkpoint?.workflowRecords.some(r=>r.key==='generate_email'&&r.state==='completed'));
 }finally{first.kill('SIGKILL');await new Promise<void>(resolve=>{if(first.exitCode!==null||first.signalCode!==null)resolve();else first.once('exit',()=>resolve());});}
 await AgentTask.updateOne({_id:created.task.id},{$set:{leaseUntil:new Date(0)}});const second=spawn('finish');let generated=0;try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('recovery timed out')),20000);second.on('message',(m:unknown)=>{if((m as {event:string}).event==='generate')generated++;});second.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('recovery child failed'));});});}finally{if(second.exitCode===null)second.kill('SIGKILL');}
 const done=await tasks.getAgentTask(created.task.id,actor);assert.equal(done.status,'awaiting_review',JSON.stringify(done.error));assert.equal(events.filter(e=>e==='generate').length,1);assert.equal(generated,0);assert.equal(await models.DevelopmentLetter.countDocuments({customerId:created.c._id}),1);assert.equal(await models.FollowUp.countDocuments({customerId:created.c._id}),0);
});
