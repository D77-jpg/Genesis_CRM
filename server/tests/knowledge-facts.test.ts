import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {factScopeInput,factApplies,collectConditionalEvidence,type FactContext} from '../src/services/agent/conditional-facts';
import {auditGroundedEmail} from '../src/services/agent/knowledge-grounding';
import {agreementInput,saveCustomerAgreement,listCustomerAgreements,disableCustomerAgreement,agreementEvidence} from '../src/services/agent/customer-agreement.service';
import type {KnowledgeSource,KnowledgeTerm,KnowledgeBundle} from '../src/services/agent/knowledge-types';
import type {AuthUser} from '../src/types/express';
process.env.KNOWLEDGE_RETRIEVAL_MODE='keyword';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';
const past=new Date(Date.now()-86400000).toISOString(),future=new Date(Date.now()+86400000).toISOString();
const scope=factScopeInput.parse({products:['velvet pouch'],processes:['screen print'],quantity:{min:100,max:200,unit:'pcs'},startsAfter:'artwork and deposit approval'});
const term:KnowledgeTerm={topic:'lead_time',value:'19',unit:'working days',conditions:'standard velvet pouch; after artwork and deposit approval',mode:'confirmed',scope};
const source:KnowledgeSource={sourceId:'knowledge:test:v1',knowledgeId:'test',title:'Fictional policy',version:1,kind:'knowledge',category:'trade',source:'fixture://independent',content:'Fictional policy only.',products:['velvet pouch'],applicability:'standard only',validFrom:past,validUntil:future,terms:[term]};
const ctx:FactContext={products:['velvet pouch'],processes:['screen print'],quantity:150,quantityUnit:'pcs'};
const bundle=(sources=[source],topics:KnowledgeBundle['topics']=['lead_time']):KnowledgeBundle=>({projectId:'fixture',status:'ready',topics,sources,issues:[],factContext:ctx});
test('quantity ranges preserve inclusive/exclusive boundaries and unknown units',()=>{
 assert.equal(factApplies(term,source,{...ctx,quantity:100}).status,'applicable');
 assert.equal(factApplies({...term,scope:{...scope,quantity:{...scope.quantity!,minInclusive:false}}},source,{...ctx,quantity:100}).status,'not_applicable');
 assert.equal(factApplies(term,source,{...ctx,quantity:201}).status,'not_applicable');
 assert.equal(factApplies(term,source,{...ctx,quantityUnit:'sets'}).status,'needs_confirmation');
 assert.equal(factApplies(term,source,{...ctx,quantity:undefined}).status,'needs_confirmation');
});
test('product/process scope cannot be supplied by general similarity or free notes',()=>{
 assert.equal(factApplies(term,source,{...ctx,products:['satin pouch']}).status,'needs_confirmation');
 assert.equal(factApplies(term,source,{...ctx,processes:[]}).status,'needs_confirmation');
 const {scope:_,...legacy}=term;assert.equal(factApplies(legacy,source,ctx).status,'needs_confirmation');
});
test('start event, source validity and fact validity must be explicit and current',()=>{
 assert.equal(factApplies({...term,scope:{...scope,startsAfter:undefined}},source,ctx).status,'needs_confirmation');
 assert.equal(factApplies(term,{...source,validUntil:past},ctx).status,'expired');
 assert.equal(factApplies({...term,scope:{...scope,validFrom:future}},source,ctx).status,'expired');
 assert.equal(factApplies({...term,scope:{...scope,validUntil:past}},source,ctx).status,'expired');
});
test('certificate coverage and validity are checked, never certificate authenticity',()=>{
 const t={...term,topic:'certification' as const,scope:{...scope,certificate:{number:'FICT-001',issuer:'Fictional body',products:['velvet pouch'],validUntil:future}}};
 assert.equal(factApplies(t,source,ctx).status,'applicable');
 assert.equal(factApplies({...t,scope:{...t.scope,certificate:{...t.scope.certificate,products:['steel rack']}}},source,ctx).status,'needs_confirmation');
 assert.equal(factApplies({...t,scope:{...t.scope,certificate:{...t.scope.certificate,validUntil:past}}},source,ctx).status,'expired');
});
test('conflicts are contextual; disjoint products/quantity do not become false conflicts',()=>{
 const other={...source,sourceId:'knowledge:other:v1',terms:[{...term,value:'25'}]};
 assert.ok(collectConditionalEvidence(bundle([source,other])).every(f=>f.status==='conflict'));
 const disjoint={...other,terms:[{...term,value:'25',scope:{...scope,quantity:{...scope.quantity!,min:300,max:500}}}]};
 assert.equal(collectConditionalEvidence(bundle([source,disjoint]))[0].status,'applicable');
 assert.equal(collectConditionalEvidence(bundle([source,disjoint]))[1].status,'not_applicable');
});
test('affirmed and denied sources cannot silently override one another',()=>{
 const other={...source,sourceId:'knowledge:deny:v1',terms:[{...term,scope:{...scope,polarity:'denied' as const}}]};
 const result=auditGroundedEmail('We promise 19 days.',bundle([source,other]),{taskType:'inquiry_reply'});
 assert.equal(result.review.status,'conflict');assert.doesNotMatch(result.bodyText,/19 working days/);
});
test('unknown price/freight, model numbers and template examples never enter fallback body',()=>{
 const result=auditGroundedEmail('We promise USD 999 and free freight; all products certified.',bundle([source],['price','shipping']),{taskType:'inquiry_reply'});
 assert.doesNotMatch(result.bodyText,/999|free freight|all products certified/);assert.equal(result.review.completeness,'partial');
});
test('conditional output keeps value, units, start event and exact term revision reference',()=>{
 const result=auditGroundedEmail('Any invented body.',bundle(),{taskType:'inquiry_reply'});
 assert.match(result.bodyText,/19 working days/);assert.match(result.bodyText,/artwork and deposit approval/);
 assert.equal(result.review.factAudit?.facts[0].location.index,0);assert.equal(result.review.factAudit?.facts[0].version,1);
 assert.equal(result.review.claims[0].sourceIds[0],source.sourceId);
});
let db:MongoMemoryServer;let mongoose:typeof import('mongoose');let c1:string,c2:string;
const project=new Types.ObjectId(),foreign=new Types.ObjectId(),user=new Types.ObjectId(),stranger=new Types.ObjectId();
const actor:AuthUser={id:String(user),username:'s4-fixture',displayName:'Fixture',role:'admin',projectId:String(project)};
before(async()=>{db=await MongoMemoryServer.create();mongoose=await import('mongoose');await mongoose.default.connect(db.getUri(),{dbName:'s4-isolated'});const {Customer}=await import('../src/models');c1=(await Customer.create({projectId:project,ownerId:user,name:'Fictional buyer 1',email:'one@example.test'})).id;c2=(await Customer.create({projectId:project,ownerId:user,name:'Fictional buyer 2',email:'two@example.test'})).id;});
after(async()=>{await mongoose.default.disconnect();await db.stop();});
const agreement=()=>({expectedVersion:0,title:'Fictional agreed production terms',content:'Written reviewed fixture only, not legal inference.',source:'fixture://signed-sample',validFrom:new Date(past),validUntil:new Date(future),approved:true,terms:[term]});
test('only administrators may confirm explicit agreements, never inferred from notes',async()=>{
 await assert.rejects(()=>saveCustomerAgreement(c1,undefined,agreement(),{...actor,role:'user'}));
 assert.throws(()=>agreementInput.parse({...agreement(),terms:[{...term,scope:undefined}]}));
 await assert.rejects(()=>saveCustomerAgreement(c1,undefined,agreement(),{...actor,projectId:String(foreign)}));
});
test('customer agreements enforce project, current owner, customer, validity and immutable versions',async()=>{
 const id=await saveCustomerAgreement(c1,undefined,agreement(),actor);
 assert.ok((await agreementEvidence(c1,actor)).some(s=>s.agreementId===id));
 assert.ok(!(await agreementEvidence(c2,actor)).some(s=>s.agreementId===id));
 await assert.rejects(()=>listCustomerAgreements(c1,{...actor,id:String(stranger),role:'user'}));
 await saveCustomerAgreement(c1,id,{...agreement(),expectedVersion:1,terms:[{...term,value:'21'}]},actor);
 const list=await listCustomerAgreements(c1,actor);assert.equal(list.find(x=>x.id===id)?.revisions.length,2);
 await assert.rejects(()=>saveCustomerAgreement(c1,id,{...agreement(),expectedVersion:1},actor));
 await disableCustomerAgreement(c1,id,2,actor);assert.ok(!(await agreementEvidence(c1,actor)).some(s=>s.agreementId===id));
});
test('accepted quote model and explicit quantity are required; fallback profile demand is not an agreement',async()=>{
 const {Quotation}=await import('../src/models');const {buildKnowledgeBundle}=await import('../src/services/agent/knowledge-grounding');
 const q=await Quotation.create({projectId:project,customerId:c1,quotationNo:'S4-FICT-1',title:'Fixture',currency:'USD',status:'accepted',validityDate:future,version:1,totalAmount:200,items:[{productName:'velvet pouch',model:'VP-17',quantity:100,unitPrice:2,amount:200}]});
 const good=await buildKnowledgeBundle(actor,'velvet pouch VP-17 price quantity:100 pcs',{customerId:c1});assert.ok(good.sources.some(s=>s.quotationId===q.id));
 assert.equal(good.facts?.find(f=>f.sourceId.includes(q.id))?.status,'applicable');
 for(const query of ['velvet pouch price quantity:100 pcs','velvet pouch VP-18 price quantity:100 pcs','velvet pouch VP-17 price quantity:101 pcs'])assert.ok(!(await buildKnowledgeBundle(actor,query,{customerId:c1})).sources.some(s=>s.quotationId===q.id));
 const wrong=await buildKnowledgeBundle(actor,'velvet pouch VP-17 price quantity:100 pcs',{customerId:c2});assert.ok(!wrong.sources.some(s=>s.quotationId===q.id));
});

import {checkSemanticResults,verifyGroundedEmail,verifyLanguageTransform,type SemanticVerifier,inspectEditedDraft} from '../src/services/agent/fact-verifier';
import {conditionalSentence,transformNumbersMatch} from '../src/services/agent/knowledge-grounding';
const prose={...source,sourceId:'knowledge:prose:v1',knowledgeId:undefined,category:'company' as const,content:'We manufacture velvet pouches. We do not manufacture steel racks.',terms:[]};
function proof(text:string,authority:string,sourceId:string){const start=Array.from(authority).join('').indexOf(text);return {sourceId,quote:text,start,end:start+Array.from(text).length};}
test('ordinary paraphrases require whole-claim semantic support plus exact evidence offsets',()=>{
 const b=bundle([prose],[]);const text='We make velvet pouches.';
 const rows=checkSemanticResults(text,b,[{id:'s0',status:'supported',quotes:[proof('We manufacture velvet pouches.',prose.content,prose.sourceId)],reason:'same manufacturing meaning'}]);
 assert.equal(rows[0].status,'supported');assert.equal(rows[0].quotes?.[0].start,0);
 assert.equal(checkSemanticResults(text,b,[{id:'s0',status:'supported',quotes:[{sourceId:prose.sourceId,quote:'invented',start:0,end:8}],reason:'fake quote'}])[0].status,'unsupported');
});
test('real IDs cannot launder changed numbers, units or omitted start/quantity conditions',()=>{
 const b=bundle();const card=conditionalSentence(term,source);const quote=proof(card,card,source.sourceId+':term:0');
 for(const text of ['We deliver in 19 days.',card.replace('working days','weeks'),card.replace('19','91'),card.replace('after artwork and deposit approval','immediately')]){
  assert.equal(checkSemanticResults(text,b,[{id:'s0',status:'supported',quotes:[quote],reason:'unsafe permissive verifier'}])[0].status,'unsupported');
 }
 assert.equal(checkSemanticResults(card,b,[{id:'s0',status:'supported',quotes:[quote],reason:'complete card'}])[0].status,'supported');
});
test('negation cannot be dropped by a permissive model checker',()=>{
 const sentence='We manufacture steel racks.';const quote=proof('We do not manufacture steel racks.',prose.content,prose.sourceId);
 assert.equal(checkSemanticResults(sentence,bundle([prose],[]),[{id:'s0',status:'supported',quotes:[quote],reason:'permissive'}])[0].status,'contradicted');
});
test('every paragraph needs a verdict; omissions, duplicate IDs and source injection fail closed',()=>{
 assert.equal(checkSemanticResults('We make velvet pouches.',bundle([prose],[]),[])[0].status,'unverifiable');
 const row={id:'s0',status:'non_claim' as const,quotes:[],reason:'just prose'};
 assert.equal(checkSemanticResults('We manufacture steel racks.',bundle([prose],[]),[row])[0].status,'unverifiable');
 assert.equal(checkSemanticResults('We manufacture velvet pouches.',bundle([prose],[]),[{...row,status:'supported',quotes:[proof(prose.content,prose.content,'foreign:secret')]}])[0].status,'unsupported');
});
test('one whole-message rewrite is followed by another audit, with a hard two-check limit',async()=>{
 let count=0,rewrites=0;const verifier:SemanticVerifier={model:'fixture-transport-only',async check({segments}){count++;return segments.map(p=>({...p,status:'unsupported',quotes:[],reason:'not supported'}));},async rewrite(){rewrites++;return 'Our price is USD 999.';}};
 const result=await verifyGroundedEmail('We guarantee USD 888.',bundle(),{taskType:'inquiry_reply'},verifier);
 assert.equal(count,2);assert.equal(rewrites,1);assert.equal(result.review.completeness,'partial');assert.doesNotMatch(result.bodyText,/888|999/);assert.match(result.bodyText,/19 working days/);
});
test('semantic failure is distinct from no answer; a valid partial email stays readable',async()=>{
 const result=await verifyGroundedEmail('Unverified claim.',bundle(),{taskType:'inquiry_reply'},{model:'fixture',async check(){throw Error('isolated transport failure');}});
 assert.equal(result.review.factAudit?.mode,'unavailable');assert.ok(result.review.issues.some(i=>i.code==='semantic_unverified'));
 assert.match(result.bodyText,/Hello,[\s\S]*Thank you[\s\S]*19 working days[\s\S]*Could you please/);
});
test('question coverage follows the actually checked fact, not another fact with the same source ID',async()=>{
 const moq={...term,topic:'moq' as const,value:'73',unit:'pcs'};const b=bundle([{...source,terms:[moq,term]}],['moq','lead_time']);const card=conditionalSentence(moq,b.sources[0]);
 const result=await verifyGroundedEmail(card,b,{taskType:'inquiry_reply'},{model:'fixture',async check(){return [{id:'s0',status:'supported',quotes:[proof(card,card,source.sourceId+':term:0')],reason:'only MOQ answered'}];}});
 assert.equal(result.review.questions.find(q=>q.topic==='moq')?.status,'answered');assert.equal(result.review.questions.find(q=>q.topic==='lead_time')?.status,'unanswered');
});
test('pure transforms cannot permute the same numbers between price/MOQ or remove semantic conditions',async()=>{
 assert.equal(transformNumbersMatch('MOQ 19 pcs. Lead time 73 days.','MOQ 73 pcs. Lead time 19 days.'),false);
 assert.equal(transformNumbersMatch('MOQ 73 sets.','MOQ 73 pcs.'),false);
 const fail=await verifyLanguageTransform('We offer free samples.','We do not offer free samples.',{model:'fixture',async check(){return [{id:'s0',status:'contradicted',quotes:[],reason:'negation reversed'}];}});assert.match(fail,/未能确认/);
});
test('edited draft inspection reports unsupported assertions without rewriting the body',async()=>{
 const body='We guarantee USD 100.';const result=await inspectEditedDraft(body,bundle(),{model:'fixture',async check(){return [{id:'s0',status:'unsupported',quotes:[],reason:'no price policy'}];}});assert.equal(result.checks[0].text,body);assert.equal(result.checks[0].status,'unsupported');
});
