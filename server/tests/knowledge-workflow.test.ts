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
async function task(goal:string){const c=await customer();const {createAgentSession}=await import('../src/services/agent/agent.service');let context:{type:'customer'|'mail';resourceId:string;direction?:'inbound'}={type:'customer',resourceId:c.id};if(/询盘|样品/.test(goal)){const {MailMessage}=await import('../src/models/MailMessage');const id=randomUUID();const mail=await MailMessage.create({projectId:project,customerId:c._id,mailboxUserId:owner,dedupKey:id,threadId:id,messageId:'<'+id+'@example.test>',from:c.email,to:['seller@example.test'],subject:'Fictional inquiry',text:'Product: velvet pouch\nQuantity: 150 pcs\nDestination: Germany\nWhat is the sample fee and lead time?',sentAt:new Date()});context={type:'mail',resourceId:mail.id,direction:'inbound'};}const session=await createAgentSession({context},actor);return {c,task:await tasks.createAgentTask({sessionId:session.id,goal,requestKey:randomUUID(),tokenBudget:200000},actor)};}
const goals=[['first_outreach','帮我给这个客户写第一封开发信'],['inquiry_reply','请写邮件回复这个客户的询盘'],['quotation_explanation','请给这个客户写报价说明邮件'],['sample_reply','请写样品回复邮件'],['followup_review','请给这个客户写跟进邮件']] as const;
for(const [kind,goal] of goals)test('five mail types share persisted evidence workflow: '+kind,async()=>{
 const created=await task(goal);assert.equal(created.task.kind,kind);await tasks.processAgentTask(created.task.id);const done=await tasks.getAgentTask(created.task.id,actor);assert.equal(done.status,'awaiting_review',JSON.stringify(done.error));assert.ok(done.draftId);
 for(const key of ['read_context','extract_requirements','load_rules','retrieve_0','assess_evidence','generate_email','audit_claims','handoff'])assert.ok(done.workflow.some(s=>s.key===key&&s.state==='completed'),key);
 assert.ok(done.workflow.every(s=>!('payload' in s)));const draft=await models.DevelopmentLetter.findById(done.draftId);assert.equal(draft?.knowledgeReview?.taskType,kind);assert.equal(draft?.status,'draft');if(created.task.sourceMailId){const {MailMessage}=await import('../src/models/MailMessage');const mail=await MailMessage.findById(created.task.sourceMailId);assert.equal(draft?.inReplyTo,mail?.messageId);assert.equal(draft?.threadId,mail?.threadId);}assert.equal(await models.FollowUp.countDocuments({customerId:created.c._id}),0);
});
test('deterministic requirement extraction preserves known quantity/destination and does not infer policy',async()=>{
 const {extractSalesRequirements}=await import('../src/services/agent/sales-evidence');const r=extractSalesRequirements('请写样品回复邮件','Quantity: 150 pcs\nDestination: Germany\nWhat is the sample fee?','sample_reply');assert.equal(r.known.quantity,150);assert.equal(r.known.destination,'Germany');assert.ok(r.topics.includes('sample'));
 assert.equal(extractSalesRequirements('询盘','Qty: 150 pcs\nQty: 250 pcs','inquiry_reply').known.quantity,undefined);
 assert.equal(extractSalesRequirements('询盘','Is your MOQ 73 pcs?','inquiry_reply').known.quantity,undefined);assert.deepEqual(extractSalesRequirements('请写第一封开发信','What is your MOQ and price?','first_outreach').topics,[]);
 const {salesMailKind}=await import('../src/services/agent/sales-evidence');assert.equal(salesMailKind('请写第一封开发信，介绍样品服务'),'first_outreach');
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
for(const [kind,goal] of goals)test('actual worker termination resumes '+kind+' without another generation',async()=>{
 const {fork}=await import('node:child_process');const {join}=await import('node:path');const {AgentTask}=await import('../src/models/AgentTask');const created=await task(goal);const events:string[]=[];
 const spawn=(mode:string)=>fork(join(__dirname,'fixtures/knowledge-s5/worker.ts'),[created.task.id,mode],{execArgv:['--require',join(__dirname,'os-user-info.cjs'),'--import','tsx'],env:{...process.env,S5_TEST_MONGO:db.getUri(),S5_TEST_DB:'s5-independent'},stdio:['ignore','ignore','ignore','ipc']});
 const first=spawn('hang-audit');try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('checkpoint not reached')),20000);first.on('message',(m:unknown)=>{const value=m as {event:string};events.push(value.event);if(value.event==='audit-request'){clearTimeout(timer);resolve();}});first.once('exit',()=>{clearTimeout(timer);reject(Error('child exited too early'));});});
 assert.equal(await models.AgentCustomerAnalysis.countDocuments({customerId:created.c._id}),0);assert.equal(await models.AgentMailThreadAnalysis.countDocuments({customerId:created.c._id}),0);const checkpoint=await AgentTask.findById(created.task.id);assert.ok(checkpoint?.workflowRecords.some(r=>r.key==='generate_email'&&r.state==='completed'));
 }finally{first.kill('SIGKILL');await new Promise<void>(resolve=>{if(first.exitCode!==null||first.signalCode!==null)resolve();else first.once('exit',()=>resolve());});}
 await AgentTask.updateOne({_id:created.task.id},{$set:{leaseUntil:new Date(0)}});const second=spawn('finish');let generated=0;try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('recovery timed out')),20000);second.on('message',(m:unknown)=>{if((m as {event:string}).event==='generate')generated++;});second.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('recovery child failed'));});});}finally{if(second.exitCode===null)second.kill('SIGKILL');}
 const done=await tasks.getAgentTask(created.task.id,actor);assert.equal(done.status,'awaiting_review',JSON.stringify(done.error));assert.equal(events.filter(e=>e==='generate').length,1);assert.equal(generated,0);assert.equal(await models.DevelopmentLetter.countDocuments({customerId:created.c._id}),1);assert.equal(await models.FollowUp.countDocuments({customerId:created.c._id}),0);
});


test('multi-question retrieval performs bounded supplemental lookup and keeps complete evidence',async()=>{
 const {appendKnowledge}=await import('../src/services/agent/knowledge.service');const {prepareSalesEvidence}=await import('../src/services/agent/sales-evidence');const {taskEvidenceWorkflow}=await import('../src/services/agent/evidence-workflow');const {AgentTask}=await import('../src/models/AgentTask');const {policyTopics}=await import('../src/services/agent/knowledge.service');const admin={...actor,role:'admin' as const};
 const topics=['moq','lead_time','sample','price','shipping','payment','certification'] as const;
 const names=['MOQ 起订量','lead time 交期','sample 样品','price 报价','freight 运费','payment 付款','certification 认证'];
 for(let i=0;i<topics.length;i++)await appendKnowledge(undefined,{expectedVersion:0,title:names[i]+' synthetic7',category:'trade',source:'fixture://seven',content:names[i]+' fictional only',approved:true,products:['synthetic7'],applicability:'standard only',terms:[{topic:topics[i],value:topics[i]==='price'?'4.25':'fictional conditional value',currency:topics[i]==='price'?'USD':undefined,unit:'text',conditions:'standard product only',mode:'confirmed',scope:{reviewed:true,products:['synthetic7'],startsAfter:'approved artwork',certificate:topics[i]==='certification'?{number:'FICT-S5',issuer:'Fictional',products:['synthetic7'],validUntil:'2099-01-01T00:00:00Z'}:undefined}}]},admin);
 const created=await task('请写报价说明邮件');const row=await AgentTask.findById(created.task.id);assert.ok(row);await AgentTask.updateOne({_id:row._id},{$set:{status:'running',leaseToken:'multi-query'}});
 const workflow=taskEvidenceWorkflow(row,'multi-query',async()=>{});const result=await prepareSalesEvidence(actor,{request:'请写邮件说明 '+names.join(' '),history:'',productHint:'synthetic7',kind:'quotation_explanation'},workflow);assert.equal(policyTopics(names.join(' ')).length,7);assert.equal(result.bundle.sources.filter(s=>s.products.includes('synthetic7')).length,7);
 const stored=await AgentTask.findById(row._id);assert.ok(stored?.workflowRecords.some(r=>r.key==='retrieve_1'));assert.ok((stored?.workflowRecords.filter(r=>r.key.startsWith('retrieve_')).length??0)<=3);assert.ok(result.bundle.sources.every(s=>s.source!=='other-project'));
});


test('in-flight knowledge changes stop delivery and explicit retry re-reads the new epoch',async()=>{
 const created=await task('请写报价说明邮件');const {MockAgentProvider}=await import('../src/services/agent/mock-provider');const {AgentKnowledge}=await import('../src/models/AgentKnowledge');const provider=new MockAgentProvider();let changed=false;const original=provider.analyzeCustomer.bind(provider);
 provider.analyzeCustomer=async(input)=>{if(!changed){changed=true;await AgentKnowledge.create({projectId:project,version:1,approvedVersion:1,revisions:[{version:1,title:'New fictional publication during generation',category:'company',content:'Fictional manufacturing update only',approved:true,validFrom:new Date(0),createdBy:owner,createdAt:new Date()}]});}return original(input);};
 await tasks.processAgentTask(created.task.id,provider);const failed=await tasks.getAgentTask(created.task.id,actor);assert.equal(failed.status,'failed');assert.equal(failed.error?.retryable,true);assert.equal(await models.DevelopmentLetter.countDocuments({customerId:created.c._id}),0);
 await tasks.controlAgentTask(created.task.id,'resume',{version:failed.version},actor);await tasks.processAgentTask(created.task.id,provider);const done=await tasks.getAgentTask(created.task.id,actor);assert.equal(done.status,'awaiting_review',JSON.stringify(done.error));assert.equal(done.workflowEpoch,1);
});
test('revoking personal mailbox access during inference cannot persist or expose a reply',async()=>{
 const created=await task('请回复询盘邮件');const {MockAgentProvider}=await import('../src/services/agent/mock-provider');const {MailMessage}=await import('../src/models/MailMessage');const provider=new MockAgentProvider();const original=provider.analyzeMailThread.bind(provider);
 provider.analyzeMailThread=async(input)=>{await MailMessage.updateOne({_id:created.task.sourceMailId},{$set:{mailboxUserId:stranger,visibility:'private'}});return original(input);};
 await tasks.processAgentTask(created.task.id,provider);assert.equal(await models.DevelopmentLetter.countDocuments({customerId:created.c._id}),0);await assert.rejects(()=>tasks.getAgentTask(created.task.id,actor));
});


test('ready-task metadata hides stale summaries and allows explicit fresh preparation',async()=>{
 const created=await task('请写跟进邮件');await tasks.processAgentTask(created.task.id);const before=await tasks.getAgentTask(created.task.id,actor);await models.Customer.updateOne({_id:created.c._id},{$set:{notes:'Updated independent buyer requirement'}});const stale=await tasks.getAgentTask(created.task.id,actor);assert.equal(stale.needsRefresh,true);assert.equal(stale.contextSummary,undefined);assert.equal(stale.draftId,undefined);await tasks.controlAgentTask(created.task.id,'resume',{version:stale.version},actor);await tasks.processAgentTask(created.task.id);const done=await tasks.getAgentTask(created.task.id,actor);assert.equal(done.status,'awaiting_review',JSON.stringify(done.error));assert.equal(done.needsRefresh,false);assert.notEqual(done.draftId,before.draftId);
});


test('repeated questions about known buyer quantity cannot pass the generated-email audit',async()=>{
 const {verifyGroundedEmail}=await import('../src/services/agent/fact-verifier');const result=await verifyGroundedEmail('Could you please confirm the order quantity?',{projectId:String(project),status:'ready',topics:[],issues:[],sources:[{sourceId:'knowledge:fictional:v1',title:'Fictional',kind:'knowledge',category:'company',version:1,source:'fixture://only',content:'We manufacture pouches.',applicability:'standard',products:[],validFrom:'2020-01-01T00:00:00Z',terms:[]}]},{taskType:'inquiry_reply',knownRequirements:{quantity:150,quantityUnit:'pcs'}},{model:'fixture',async check(){return [{id:'s0',status:'non_claim',quotes:[],reason:'question only'}];}});assert.doesNotMatch(result.bodyText,/confirm the order quantity/);assert.ok(result.review.factAudit?.checks.some(c=>c.reason.includes('已提供')));
});


test('invalid structured model output is not cached as a completed generation checkpoint',async()=>{
 const created=await task('请写报价说明邮件');const {MockAgentProvider}=await import('../src/services/agent/mock-provider');const {AgentTask}=await import('../src/models/AgentTask');const provider=new MockAgentProvider();const original=provider.analyzeCustomer.bind(provider);let calls=0;provider.analyzeCustomer=async(input)=>{calls++;const result=await original(input);if(calls===1)return {...result,emailDraft:{subject:'',bodyText:''}};return result;};
 await tasks.processAgentTask(created.task.id,provider);const failed=await tasks.getAgentTask(created.task.id,actor);assert.equal(failed.status,'failed');assert.equal((await AgentTask.findById(created.task.id))?.workflowRecords.find(r=>r.key==='generate_email')?.state,'failed');await tasks.controlAgentTask(created.task.id,'resume',{version:failed.version},actor);await tasks.processAgentTask(created.task.id,provider);assert.equal((await tasks.getAgentTask(created.task.id,actor)).status,'awaiting_review');assert.equal(calls,2);
});


test('synthetic accepted receipts for an older draft do not complete its newer workflow version',async()=>{
 const created=await task('请写报价说明邮件');await tasks.processAgentTask(created.task.id);const old=await tasks.getAgentTask(created.task.id,actor);await models.Customer.updateOne({_id:created.c._id},{$set:{notes:'Fictional requirements revised'}});const stale=await tasks.getAgentTask(created.task.id,actor);await tasks.controlAgentTask(created.task.id,'resume',{version:stale.version},actor);await tasks.processAgentTask(created.task.id);const current=await tasks.getAgentTask(created.task.id,actor);assert.notEqual(current.draftId,old.draftId);
 const {recordAgentSendReceipt}=await import('../src/services/agent/automation.service');const receipt=async(draftId:string)=>models.DevelopmentLetter.create({projectId:project,customerId:created.c._id,recipientEmail:created.c.email,subject:'Fictional receipt only; no actual transport',content:'<p>Fixture</p>',contentText:'Fixture',template:'',agentTaskId:created.task.id,agentDraftId:draftId,channel:'smtp',status:'sent',sentBy:owner,sentAt:new Date()});
 const first=await receipt(old.draftId!);await recordAgentSendReceipt(first.id);assert.equal((await tasks.getAgentTask(created.task.id,actor)).status,'awaiting_review');
 const second=await receipt(current.draftId!);await recordAgentSendReceipt(second.id);await recordAgentSendReceipt(second.id);assert.equal((await tasks.getAgentTask(created.task.id,actor)).status,'completed');assert.equal(await models.FollowUp.countDocuments({customerId:created.c._id}),2);
});


test('each semantic check/rewrite revalidates the running lease before calling its provider',async()=>{
 const {providerFactVerifier}=await import('../src/services/agent/fact-verifier');const {MockAgentProvider}=await import('../src/services/agent/mock-provider');const base=new MockAgentProvider();const provider=Object.create(base);Object.defineProperty(provider,'name',{value:'openai'});let allowed=true,calls=0;provider.createTurn=async()=>{calls++;return {text:JSON.stringify({checks:[]}),toolCalls:[],output:[],usage:{inputTokens:1,outputTokens:1,totalTokens:2}};};const verifier=providerFactVerifier(provider,actor,undefined,async()=>{if(!allowed)throw Error('lease revoked');})!;
 await verifier.check({segments:[],evidence:[]});allowed=false;await assert.rejects(()=>verifier.check({segments:[],evidence:[]}));await assert.rejects(()=>verifier.rewrite!({body:'',allowed:[],issues:[]}));assert.equal(calls,1);
});


test('workflow instructions cannot crowd product evidence out of bounded lookup; scope facts remain explicit',async()=>{
 const {appendKnowledge}=await import('../src/services/agent/knowledge.service');const {prepareSalesEvidence}=await import('../src/services/agent/sales-evidence');const admin={...actor,role:'admin' as const};
 const id=await appendKnowledge(undefined,{expectedVersion:0,title:'Independent hemp sleeve construction',category:'product',source:'fixture://independent-lookup',content:'The hemp sleeve has a fold-over flap.',products:['hemp sleeve'],approved:true},admin);
 for(let n=0;n<8;n++)await appendKnowledge(undefined,{expectedVersion:0,title:'Write first outreach email help workflow '+n,category:'company',source:'fixture://lookup-noise',content:'Write first outreach email help workflow. This is irrelevant operational noise.',approved:true},admin);
 const result=await prepareSalesEvidence(actor,{request:'Help write first outreach email please',productHint:'hemp sleeve',kind:'first_outreach',history:'Quantity: 320 pcs\nDestination: Sweden'});
 assert.ok(result.bundle.sources.some(s=>s.knowledgeId===id));assert.equal(result.bundle.factContext?.quantity,320);assert.equal(result.bundle.factContext?.destination,'Sweden');
 assert.ok(result.bundle.sources.every(s=>!s.source.includes('lookup-noise')));
 const none=await prepareSalesEvidence(actor,{request:'write first outreach email',productHint:'unmatched aquarium cover',kind:'first_outreach',history:''});assert.equal(none.bundle.status,'no_match');
});

test('completed model work settles actual time instead of exhausting cumulative limit with reservations',async()=>{
 const {taskEvidenceWorkflow}=await import('../src/services/agent/evidence-workflow');const {AgentTask}=await import('../src/models/AgentTask');
 const created=await task('请写跟进邮件');const row=await AgentTask.findById(created.task.id);assert.ok(row);
 await AgentTask.updateOne({_id:row._id},{$set:{status:'running',leaseToken:'settled-time'}});
 const workflow=taskEvidenceWorkflow(row,'settled-time',async()=>{});let invoked=0;
 for(let n=0;n<6;n++)await workflow.run(n%2?'audit_claims':'generate_email',{independentInput:n},async()=>{invoked++;await new Promise(r=>setTimeout(r,10));return {done:n};},{tool:'model'});
 const saved=await AgentTask.findById(row._id);assert.equal(invoked,6);assert.equal(saved?.workflowCalls,6);assert.ok(saved!.workflowActiveMs<10000);assert.ok(saved!.workflowActiveMs>=60);
 await AgentTask.updateOne({_id:row._id},{$set:{workflowActiveMs:600000}});
 await assert.rejects(()=>workflow.run('load_rules',{},async()=>{throw Error('must not execute after actual budget is exhausted');}));
});

test('lost lease keeps its conservative time reservation and cannot settle another owner checkpoint',async()=>{
 const {taskEvidenceWorkflow}=await import('../src/services/agent/evidence-workflow');const {AgentTask}=await import('../src/models/AgentTask');
 const created=await task('请写跟进邮件');const row=await AgentTask.findById(created.task.id);assert.ok(row);
 await AgentTask.updateOne({_id:row._id},{$set:{status:'running',leaseToken:'lost-time'}});
 const workflow=taskEvidenceWorkflow(row,'lost-time',async()=>{});
 await assert.rejects(()=>workflow.run('generate_email',{},async()=>{await AgentTask.updateOne({_id:row._id},{$set:{status:'paused',leaseToken:'new-owner'}});return {done:true};},{tool:'model'}));
 const saved=await AgentTask.findById(row._id);assert.equal(saved?.workflowActiveMs,120000);assert.equal(saved?.workflowCalls,1);assert.equal(saved?.workflowRecords[0]?.state,'running');
});

test('finished failed attempts settle elapsed time but retain retry and work counters',async()=>{
 const {taskEvidenceWorkflow}=await import('../src/services/agent/evidence-workflow');const {AgentTask}=await import('../src/models/AgentTask');
 const created=await task('请写跟进邮件');const row=await AgentTask.findById(created.task.id);assert.ok(row);
 await AgentTask.updateOne({_id:row._id},{$set:{status:'running',leaseToken:'failed-time'}});
 const workflow=taskEvidenceWorkflow(row,'failed-time',async()=>{});let invoked=0;
 for(let n=0;n<2;n++)await assert.rejects(()=>workflow.run('generate_email',{independentAttempt:n},async()=>{invoked++;await new Promise(r=>setTimeout(r,10));throw Error('independent bounded transport failure');},{tool:'model'}));
 const saved=await AgentTask.findById(row._id);assert.equal(invoked,2);assert.equal(saved?.workflowCalls,2);assert.ok(saved!.workflowActiveMs>=20&&saved!.workflowActiveMs<10000);assert.equal(saved?.workflowRecords[0]?.attempts,2);assert.equal(saved?.workflowRecords[0]?.state,'failed');
});
