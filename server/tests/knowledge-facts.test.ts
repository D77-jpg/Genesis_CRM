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
const scope=factScopeInput.parse({reviewed:true,products:['velvet pouch'],processes:['screen print'],quantity:{min:100,max:200,unit:'pcs'},startsAfter:'artwork and deposit approval'});
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
test('lexical polarity guards allow evidence-backed equivalent phrasing and cross-language paraphrases',()=>{
 for(const [authority,text] of [
  ['The display unit is wireless.','The display unit works without wires.'],
  ['该袋不提供内衬。','The pouch is unlined.'],
  ['The pouch is unlined.','该袋不含内衬。'],
 ]){
  const src={...prose,content:authority};
  const checked=checkSemanticResults(text,bundle([src],[]),[{id:'s0',status:'supported',quotes:[proof(authority,authority,src.sourceId)],reason:'whole-claim equivalent meaning'}]);
  assert.equal(checked[0].status,'supported');
 }
 for(const [authority,text] of [
  ['We do not supply foam inserts.','We supply foam inserts.'],
  ['We supply foam inserts.','We do not supply foam inserts.'],
  ['该袋不提供内衬。','该袋提供内衬。'],
 ]){
  const src={...prose,content:authority};
  assert.equal(checkSemanticResults(text,bundle([src],[]),[{id:'s0',status:'supported',quotes:[proof(authority,authority,src.sourceId)],reason:'permissive checker'}])[0].status,'contradicted');
 }
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

test('unreviewed structure, ambiguous sample money and route scope are not firm commitments',()=>{
 assert.equal(factApplies({...term,scope:{...scope,reviewed:false}},source,ctx).status,'needs_confirmation');
 assert.equal(factApplies({...term,topic:'sample',unit:'per sample',scope:{...scope,measure:'amount'}},source,ctx).status,'needs_confirmation');
 assert.equal(factApplies({...term,scope:{...scope,destination:'Germany'}},source,ctx).status,'needs_confirmation');
 assert.equal(factApplies({...term,scope:{...scope,destination:'Germany'}},source,{...ctx,destination:'Germany'}).status,'applicable');
});
test('draft recheck is idempotent, owner-scoped and never rewrites body/original snapshot',async()=>{
 const {appendKnowledge}=await import('../src/services/agent/knowledge.service');const {buildKnowledgeBundle}=await import('../src/services/agent/knowledge-grounding');
 const {DevelopmentLetter}=await import('../src/models');const {recheckKnowledgeDraft}=await import('../src/services/agent/knowledge-draft.service');const {randomUUID}=await import('node:crypto');
 await appendKnowledge(undefined,{expectedVersion:0,title:'Fictional S4 review fixture',source:'fixture://review',content:'Fictional terms for isolated audit only.',products:['velvet pouch'],applicability:'screen print',approved:true,category:'trade',terms:[term]},actor);
 const kb=await buildKnowledgeBundle(actor,'velvet pouch screen print lead time quantity:150 pcs',{customerId:c1});const original=auditGroundedEmail('',kb,{taskType:'inquiry_reply',customerId:c1});
 const letter=await DevelopmentLetter.create({projectId:project,customerId:c1,recipientName:'Fictional buyer 1',recipientEmail:'one@example.test',subject:'Regarding your inquiry',content:'<p>Unsent fixture.</p>',contentText:original.bodyText,template:'fixture',channel:'mock',status:'draft',knowledgeReview:original.review});
 const snapshot=JSON.stringify(letter.knowledgeReview),requestKey=randomUUID();let calls=0;
 const verifier:SemanticVerifier={model:'fixture-protocol-only',async check({segments}){calls++;return segments.map(p=>({id:p.id,status:'unsupported',quotes:[],reason:'unsupported edit'}));}};
 const record=await recheckKnowledgeDraft(letter.id,{requestKey,bodyText:'We promise USD 999.',subject:'Special price USD 100'},actor,verifier);
 assert.ok((record.checks as {status:string}[]).every(c=>c.status!=='supported'));
 const used=calls;await recheckKnowledgeDraft(letter.id,{requestKey,bodyText:'We promise USD 999.',subject:'Special price USD 100'},actor,verifier);assert.equal(calls,used);
 const current=await DevelopmentLetter.findById(letter.id);assert.equal(current?.knowledgeRechecks?.length,1);assert.equal(current?.contentText,original.bodyText);assert.equal(JSON.stringify(current?.knowledgeReview),snapshot);
 await assert.rejects(()=>recheckKnowledgeDraft(letter.id,{requestKey,bodyText:'Changed again'},actor,verifier));
 const subjectFault:SemanticVerifier={model:'fixture-subject-failure',async check({segments}){if(segments[0].text==='Subject fixture')throw Error('subject transport failure');return segments.map(p=>({id:p.id,status:'unsupported',quotes:[],reason:'fixture only'}));}};
 const subjectRecord=await recheckKnowledgeDraft(letter.id,{requestKey:randomUUID(),bodyText:'Body fixture',subject:'Subject fixture'},actor,subjectFault);assert.equal(subjectRecord.mode,'unavailable');

 await assert.rejects(()=>recheckKnowledgeDraft(letter.id,{requestKey:randomUUID()}, {...actor,id:String(stranger),role:'user'},verifier));
 const {AgentKnowledge}=await import('../src/models/AgentKnowledge');await AgentKnowledge.updateOne({_id:kb.sources[0].knowledgeId},{$set:{archived:true}});
 const before=calls;await assert.rejects(()=>recheckKnowledgeDraft(letter.id,{requestKey:randomUUID()},actor,verifier));assert.equal(calls,before);
});
test('Unicode citation offsets are code points, never silently UTF-16',()=>{
 const unicode={...prose,content:'😀 We manufacture cotton bags.'};const b=bundle([unicode],[]);const q='We manufacture cotton bags.';
 const good={sourceId:unicode.sourceId,quote:q,start:2,end:2+Array.from(q).length};
 assert.equal(checkSemanticResults('We make cotton bags.',b,[{id:'s0',status:'supported',quotes:[good],reason:'paraphrase'}])[0].status,'supported');
 assert.equal(checkSemanticResults('We make cotton bags.',b,[{id:'s0',status:'supported',quotes:[{...good,start:3,end:3+q.length}],reason:'wrong UTF-16'}])[0].status,'unsupported');
});

test('independent S4 gold labels and raw fixture hashes are frozen before live evaluation',async()=>{
 const {loadFactCases,factCaseBundle}=await import('../evaluation/knowledge/fact-evaluation');const fixture=loadFactCases();assert.equal(fixture.cases.length,44);assert.equal(fixture.cases.filter(c=>c.split==='holdout').length,22);
 for(const c of fixture.cases.filter(c=>c.kind==='critical'&&c.supported)){const b=factCaseBundle(c);assert.equal(c.claim,conditionalSentence(b.sources[0].terms[0],b.sources[0]));}
});

test('same amounts with incompatible inclusion/refund wording are not silently treated as identical policy',()=>{
 const a={...source,terms:[{...term,topic:'sample' as const,value:'25',unit:'per sample',currency:'USD',conditions:'Freight included; nonrefundable',scope:{...scope,measure:'amount' as const}}]};
 const b={...a,sourceId:'knowledge:different-conditions:v1',terms:[{...a.terms[0],conditions:'Freight excluded; refundable'}]};
 assert.ok(collectConditionalEvidence(bundle([a,b],['sample'])).every(f=>f.status==='conflict'));
});

test('range rendering keeps original policy wording and global footnotes; budgets never slice a condition',()=>{
 const t={...term,min:19,max:25,value:'19 to 25 working days; prototypes excluded'};
 const s={...source,applicability:'No guarantee before artwork confirmation; standard orders only',terms:[t]};
 const text=conditionalSentence(t,s);assert.match(text,/prototypes excluded/);assert.match(text,/No guarantee before artwork/);
 const huge={...s,terms:Array.from({length:25},()=>({...t,conditions:'Entire condition '.repeat(35)}))};
 const result=auditGroundedEmail('',bundle([huge]),{taskType:'inquiry_reply'});assert.ok(result.bodyText.length<20000);assert.ok(result.review.issues.some(i=>i.code==='fact_budget'));assert.equal(result.review.completeness,'partial');
});

test('recipient profile supports personalization but never supplier capabilities or commitments',()=>{
 const profile={name:'Fictional Buyer',company:'Fictional Co',country:'Netherlands',industry:'Jewelry',interestedProducts:'velvet pouch'};
 const text=JSON.stringify(profile);const evidence=proof('Fictional Co',text,'profile:fixture-customer');const checker={id:'s0',status:'supported' as const,quotes:[evidence],reason:'profile identifies company'};
 assert.equal(checkSemanticResults('Your company is Fictional Co.',bundle([],[]),[checker],{id:'fixture-customer',profile})[0].status,'supported');
 assert.equal(checkSemanticResults('Our company is Fictional Co.',bundle([],[]),[checker],{id:'fixture-customer',profile})[0].status,'unsupported');
 assert.equal(checkSemanticResults('Your price is USD 73.',bundle([],[]),[checker],{id:'fixture-customer',profile})[0].status,'unsupported');
});


test('real provider HTTP protocol validates JSON, unique Unicode quotes and rejects tool calls',async()=>{
 const {createServer}=await import('node:http');const {OpenAIResponsesProvider}=await import('../src/services/agent/openai-provider');const {providerFactVerifier}=await import('../src/services/agent/fact-verifier');
 const requests:Record<string,unknown>[]=[];let mode:'valid'|'invalid'|'tool'='valid';
 const http=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=String(chunk);requests.push(JSON.parse(body));
  const text=mode==='invalid'?'not JSON':JSON.stringify({checks:[{id:'s0',status:'supported',quotes:[{sourceId:'local-evidence',quote:'cotton bags',start:0,end:1}],reason:'loopback fixture only'}]});
  res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'completed',output:mode==='tool'?[{type:'function_call',call_id:'forbidden',name:'send_email',arguments:'{}'}]:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}));
 });await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
 try{const address=http.address();assert.ok(address&&typeof address==='object');const provider=new OpenAIResponsesProvider({apiKey:'fictional-loopback-only',baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'loopback-not-a-real-model',timeoutMs:3000});const verifier=providerFactVerifier(provider,actor)!;
  const payload={segments:[{id:'s0',text:'We make cotton bags.'}],evidence:[{sourceId:'local-evidence',text:'😀 We make cotton bags.'}]};
  const rows=await verifier.check(payload);assert.equal(rows[0].quotes[0].start,10);assert.equal(rows[0].quotes[0].end,21);
  assert.deepEqual(requests[0].tools,[]);assert.equal(requests[0].store,false);assert.equal(requests[0].parallel_tool_calls,false);
  assert.equal((requests[0].text as {format:{type:string;name:string}}).format.type,'json_schema');
  assert.equal((requests[0].text as {format:{name:string}}).format.name,'evidence_entailment');
  await verifier.rewrite!({body:'Fictional only',allowed:[],issues:[]});assert.deepEqual(requests[1].text,{format:{type:'text'}});
  mode='invalid';await assert.rejects(()=>verifier.check(payload));mode='tool';await assert.rejects(()=>verifier.check(payload));
 }finally{await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));}
});

test('legacy literal-condition disagreement is visible but never promotes either value to applicable',()=>{
 const legacy:KnowledgeTerm={topic:'price',value:'28',unit:'per design',currency:'EUR',conditions:'standard debossing on linen packaging',mode:'confirmed'};
 const first={...source,terms:[legacy]},second={...source,sourceId:'knowledge:legacy-other:v1',terms:[{...legacy,value:'52'}]};
 const b=bundle([first,second],['price']);assert.ok(collectConditionalEvidence(b).every(f=>f.status==='conflict'));
 const result=auditGroundedEmail('We promise EUR 28.',b,{taskType:'quotation_explanation'});assert.equal(result.review.status,'conflict');assert.doesNotMatch(result.bodyText,/EUR 28|EUR 52/);
 const different={...second,terms:[{...legacy,value:'52',conditions:'different embossing method'}]};assert.ok(collectConditionalEvidence(bundle([first,different],['price'])).every(f=>f.status==='needs_confirmation'));
});


test('live evaluation and production share exactly the authorized semantic evidence boundary',async()=>{
 const {evidenceForCheck}=await import('../src/services/agent/fact-verifier');
 const {factCaseBundle,loadFactCases}=await import('../evaluation/knowledge/fact-evaluation');
 for(const row of loadFactCases().cases){const b=factCaseBundle(row);const allowed=evidenceForCheck(b);assert.ok(allowed.length);if(row.kind==='critical'){assert.ok(allowed.every(e=>e.sourceId.includes(':term:')));assert.ok(allowed.every(e=>!e.text.includes('No confirmed freight')));}else assert.equal(allowed[0].text,row.source);}
});


test('bounded address questions and standard closings are non-claims; disguised commitments stay blocked',()=>{
 const text='Could you please share your delivery address?\nWe look forward to hearing from you.';
 assert.ok(checkSemanticResults(text,bundle([],[]),[]).every(c=>c.status==='non_claim'));
 for(const unsafe of ['Could you please confirm our free shipping?','Could you please confirm our delivery in 7 days?','We look forward to guaranteeing free samples.'])assert.ok(checkSemanticResults(unsafe,bundle([],[]),[]).every(c=>c.status!=='non_claim'));
});
