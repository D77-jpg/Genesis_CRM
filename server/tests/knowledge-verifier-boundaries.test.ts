import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkSemanticResults,verifyGroundedEmail,inspectEditedDraft,type SemanticVerifier,type SemanticCheck,type EvidenceQuote} from '../src/services/agent/fact-verifier';
import {resolveEvidenceQuote} from '../src/services/agent/evidence-quote';
import {draftHash,safeGeneratedSubject,needsKnowledge} from '../src/services/agent/knowledge-grounding';
import {mergeKnowledgeBundles,type KnowledgeBundle,type KnowledgeReview} from '../src/services/agent/knowledge-types';
import {knowledgeReviewSendIssue,knowledgeReviewRequiresApproval} from '../src/services/agent/knowledge-send-gate';

const bundle:KnowledgeBundle={projectId:'fixture',status:'ready',topics:[],sources:[],issues:[]};
const site={sourceId:'website:buyer:0',url:'https://fixture.example.com',text:'😀 UVARA is based in Dongguan and uses 925 silver.',sha256:'fixture-only',collectedAt:'2026-10-21T00:00:00Z'};
const customer={id:'buyer',profile:{name:'UVARA',company:'UVARA',country:'China',industry:'Jewelry',interestedProducts:'925 silver'},websites:[site]};
const options={taskType:'first_outreach',customerId:customer.id,customerProfile:customer.profile,customerWebsites:customer.websites};
const description='Your website shows that UVARA is based in Dongguan and uses 925 silver.';
const quote:EvidenceQuote={sourceId:site.sourceId,quote:site.text,start:0,end:Array.from(site.text).length};
const verdict:SemanticCheck={id:'s0',status:'supported',quotes:[quote],reason:'whole attributed customer description follows from original website'};

// Independent fixtures exercise authorization and deterministic gates, not model accuracy.
test('numeric customer facts pass only with a supported verdict and authorized exact customer quotes',async()=>{
 const check=checkSemanticResults(description,bundle,[verdict],customer)[0];
 assert.equal(check.status,'supported');assert.deepEqual(check.sourceIds,[site.sourceId]);
 const verifier:SemanticVerifier={model:'fixture',async check(){return [verdict];}};
 const result=await verifyGroundedEmail(description,bundle,options,verifier);
 assert.equal(result.bodyText,description);assert.equal(result.review.factAudit?.mode,'semantic');
 assert.equal(result.review.bodyHash,draftHash(result.bodyText));
 const edited=await inspectEditedDraft(description,bundle,verifier,customer);
 assert.equal(edited.checks[0].status,'supported');
});

test('numeric customer facts are retained when another paragraph fails or a later rewrite fails',async()=>{
 for(const failure of ['none','rewrite','second_check']){
  let calls=0;
  const verifier:SemanticVerifier={model:'fixture',async check({segments}){if(++calls>1&&failure==='second_check')throw Error('second audit outage');return segments.map(p=>p.text===description?{...verdict,id:p.id}:{id:p.id,status:'unsupported',quotes:[],reason:'unsupported offer'});},...(failure==='none'?{}:{async rewrite({body}){if(failure==='rewrite')throw Error('rewrite outage');return body;}})};
  const result=await verifyGroundedEmail(description+'\nWe can hold stock for you.',bundle,options,verifier);
  assert.ok(result.bodyText.includes(description));assert.doesNotMatch(result.bodyText,/hold stock/);
  assert.equal(result.review.completeness,'partial');assert.equal(result.review.factAudit?.mode,'semantic');
  assert.ok(result.review.claims.some(c=>c.text===description&&c.sourceIds.includes(site.sourceId)));
 }
});

test('customer numeric exception never weakens supplier terms, scope, attribution or numeric identity',()=>{
 for(const text of [description.replace('925','999'),description.replace('925','92'),description.replace('925','9250'),
  'We use 925 silver.','UVARA uses 925 silver.',
  description+' We can hold stock for you.',description+' Our boxes fit your products.',
  'Your website shows a price of USD 925.','Your website confirms delivery in 925 days.',
  'Your website shows MOQ 925 pcs.','Your website shows ISO 925 certification.']){
  assert.notEqual(checkSemanticResults(text,bundle,[verdict],customer)[0].status,'supported',text);
 }
 for(const status of ['unsupported','unverifiable','contradicted','non_claim'] as const)
  assert.notEqual(checkSemanticResults(description,bundle,[{...verdict,status}],customer)[0].status,'supported');
 for(const quotes of [[],[{...quote,sourceId:'website:foreign:0'}],[{...quote,quote:'invented'}],[{...quote,end:1}]])
  assert.notEqual(checkSemanticResults(description,bundle,[{...verdict,quotes}],customer)[0].status,'supported');
 assert.notEqual(checkSemanticResults(description,bundle,[verdict],{...customer,websites:[]})[0].status,'supported');
 const oldSite={...site,text:site.text.replace('925','1925')};
 const oldQuote={...quote,quote:oldSite.text,end:Array.from(oldSite.text).length};
 assert.notEqual(checkSemanticResults(description,bundle,[{...verdict,quotes:[oldQuote]}],{...customer,websites:[oldSite]})[0].status,'supported');
});

test('numeric profile personalization is supported but never becomes our capability',()=>{
 const text=JSON.stringify(customer.profile),start=text.indexOf('925 silver');
 const row={...verdict,quotes:[{sourceId:'profile:buyer',quote:'925 silver',start,end:start+10}]};
 assert.equal(checkSemanticResults('Your interested products include 925 silver.',bundle,[row],customer)[0].status,'supported');
 assert.notEqual(checkSemanticResults('We supply 925 silver.',bundle,[row],customer)[0].status,'supported');
});

test('new commitment wording and question-shaped promises cannot escape through non-claim exemptions',async()=>{
 const unsafe=['We can hold stock for you.','We are happy to set inventory aside.','Rest assured, you are covered.','Leave the customs paperwork to us.',
  '我们可以为您预留库存。','放心，报关手续我们包办。','Could you please reply, we can hold stock for you?',
  'Could you please share your address? We can hold stock for you','Would you mind accepting our offer?'];
 for(const status of ['unsupported','non_claim','contradicted','unverifiable'] as const){
  const verifier:SemanticVerifier={model:'fixture',async check({segments}){return segments.map(p=>({id:p.id,status,quotes:[],reason:'no whole-claim evidence'}));}};
  for(const text of unsafe){
   assert.notEqual(checkSemanticResults(text,bundle,[{...verdict,status,quotes:[]}],customer)[0].status,'non_claim',text);
   const result=await verifyGroundedEmail(text,{...bundle,sources:[{sourceId:'knowledge:company:v1',title:'Company',version:1,kind:'knowledge',category:'company',content:'We make velvet pouches.',source:'fixture',applicability:'',products:[],validFrom:'2020-01-01',terms:[]}]},options,verifier);
   assert.ok(!result.bodyText.includes(text),status+': '+text);
   assert.ok(!result.review.issues.some(i=>i.code==='descriptive_unchecked'));
  }
 }
 const approved='We can hold stock for you.';
 const knowledge={sourceId:'knowledge:stock:v1',title:'Stock',version:1,kind:'knowledge' as const,category:'company' as const,content:approved,source:'fixture',applicability:'',products:[],validFrom:'2020-01-01',terms:[]};
 const supported:SemanticVerifier={model:'fixture',async check({segments}){return segments.map(p=>({id:p.id,status:'supported',quotes:[{sourceId:knowledge.sourceId,quote:approved,start:0,end:approved.length}],reason:'whole stock offer explicitly supported'}));}};
 const allowed=await verifyGroundedEmail(approved,{...bundle,sources:[knowledge]},options,supported);
 assert.equal(allowed.bodyText,approved);assert.equal(allowed.review.factAudit?.mode,'semantic');
 for(const text of ['Hello,','Could you please share your delivery address?','Please provide your specifications.','请提供您的收货地址？'])
  assert.equal(checkSemanticResults(text,bundle,[],customer)[0].status,'non_claim',text);
});

test('quote location repairs whitespace only and records exact original Unicode spans',()=>{
 const source='😀 UVARA is based in Dongguan\n and uses\u00a0\u00a0925 silver.';
 const input={...quote,quote:'UVARA is based in Dongguan and uses 925 silver.',start:999,end:1000};
 const resolved=resolveEvidenceQuote(input,source)!;
 assert.equal(resolved.start,2);assert.equal(resolved.quote,Array.from(source).slice(resolved.start,resolved.end).join(''));
 assert.ok(resolved.quote.includes('\n'));assert.ok(resolved.quote.includes('\u00a0'));
 const authorized={...customer,websites:[{...site,text:source}]};
 assert.equal(checkSemanticResults(description,bundle,[{...verdict,quotes:[resolved]}],authorized)[0].status,'supported');
 for(const changed of ['UVARA uses 999 silver.','UVARA is not based in Dongguan and uses 925 silver.','UVARA is based in Dongguan and uses silver.'])
  assert.equal(resolveEvidenceQuote({...input,quote:changed},source),undefined);
 const duplicate='uses\n925 silver. uses  925 silver.';
 assert.equal(resolveEvidenceQuote({...input,quote:'uses 925 silver.'},duplicate),undefined);
 assert.equal(resolveEvidenceQuote({...input,quote:''},source),undefined);
});


test('generated subjects cannot smuggle commitments or numbers into the customer channel',()=>{
 const fallback='A quick question about your packaging needs';
 for(const value of ['Guaranteed free samples','Best price for your order','MOQ 500 pcs available','ISO certified factory','Exclusive stock reserved'])
  assert.equal(safeGeneratedSubject(value,fallback),fallback,value);
 assert.equal(safeGeneratedSubject('A quick question about your packaging',fallback),'A quick question about your packaging');
});

test('automatic send gate blocks retained drafts and stale knowledge reviews',()=>{
 const review=(patch:Partial<KnowledgeReview>):KnowledgeReview=>({version:1,projectId:'fixture',taskType:'inquiry_reply',generatedAt:'2026-10-26T00:00:00Z',status:'ready',completeness:'complete',sources:[],claims:[],questions:[],issues:[],context:{},bodyHash:'fixture',...patch});
 assert.equal(knowledgeReviewSendIssue(undefined),undefined);
 assert.equal(knowledgeReviewSendIssue(review({factAudit:{contract:'s4.1',mode:'unavailable',attempts:1,checks:[],facts:[]}})),undefined);
 assert.match(knowledgeReviewSendIssue(review({issues:[{code:'draft_unverified',message:'retained model draft'}]}))??'',/retained model draft/);
 assert.equal(knowledgeReviewSendIssue(review({issues:[{code:'semantic_unverified',message:'verifier failed'}]})),undefined);
 assert.match(knowledgeReviewSendIssue(review({status:'index_stale'}))??'',/依据检索状态异常/);
 assert.match(knowledgeReviewSendIssue(review({issues:[{code:'access_changed',message:'source access changed'}]}))??'',/source access changed/);
 assert.equal(knowledgeReviewSendIssue(review({completeness:'partial',issues:[{code:'semantic_partial',message:'verified fallback only'}]})),undefined);
});

test('high-risk commercial claims need a human approval from the existing review page',()=>{
 const base:KnowledgeReview={version:1,projectId:'fixture',taskType:'inquiry_reply',generatedAt:'2026-10-26T00:00:00Z',status:'ready',completeness:'complete',sources:[],claims:[{text:'Our price is USD 2 per piece.',sourceIds:['knowledge:price']}],questions:[],issues:[],context:{},bodyHash:'fixture',factAudit:{contract:'s4.1',mode:'semantic',attempts:1,checks:[],facts:[]}};
 assert.equal(knowledgeReviewRequiresApproval(base),true);
 assert.match(knowledgeReviewSendIssue(base)??'',/人工批准/);
 assert.equal(knowledgeReviewSendIssue({...base,manualApprovedAt:'2026-10-26T00:10:00Z'}),undefined);
});

test('merged request evidence keeps initial and tool sources for final verification',()=>{
 const first:KnowledgeBundle={...bundle,status:'no_match',sources:[{sourceId:'knowledge:first',title:'First',version:1,kind:'knowledge',category:'company',content:'First source',source:'fixture',applicability:'',products:[],validFrom:'2020-01-01',terms:[]}],topics:[]};
 const second:KnowledgeBundle={...bundle,status:'ready',sources:[{sourceId:'knowledge:second',title:'Second',version:1,kind:'knowledge',category:'product',content:'Second source',source:'fixture',applicability:'',products:[],validFrom:'2020-01-01',terms:[]}],topics:['price'],factContext:{quantity:500,quantityUnit:'pcs'}};
 const merged=mergeKnowledgeBundles([first,second])!;
 assert.deepEqual(merged.sources.map(source=>source.sourceId),['knowledge:first','knowledge:second']);
 assert.equal(merged.status,'ready');assert.equal(merged.factContext?.quantity,500);
});


test('short follow-ups still retrieve knowledge before answering',()=>{
 for(const text of ['那这个呢？','多少钱','what about this?','can you make this?'])assert.equal(needsKnowledge(text),true,text);
 assert.equal(needsKnowledge('你好'),false);
});
