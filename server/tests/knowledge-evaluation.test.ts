import {test} from 'node:test';
import {mkdtempSync,copyFileSync,appendFileSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {loadFixtures,validateFixtures} from '../evaluation/knowledge/schema';
import {summarize,retrievalScore,type Observation} from '../evaluation/knowledge/metrics';
const fixture=loadFixtures();
test('frozen fixture has 120 scoped queries, balanced splits and development-only probes',()=>{
 assert.equal(fixture.cases.length,120);assert.equal(fixture.corpus.sources.length,50);
 assert.equal(fixture.cases.filter(c=>c.required.map(r=>r.split('.')[0]).filter((s,i,a)=>a.indexOf(s)===i).length>1).length,16);
 assert.ok(fixture.cases.some(c=>c.crossLanguage&&c.language==='en'));
 assert.ok(fixture.cases.some(c=>c.crossLanguage&&c.language==='zh'));
});
test('metrics count multiple necessary evidence units and never inflate recall with duplicates',()=>{
 assert.deepEqual(retrievalScore(['a','b'],[['a','a'],[],['b']]),{recall:1,reciprocalRank:1});
 assert.deepEqual(retrievalScore(['a','b'],[[],['a']]),{recall:.5,reciprocalRank:.5});
 assert.deepEqual(retrievalScore(['a'],Array.from({length:11},(_,i)=>i===10?['a']:[])),{recall:0,reciprocalRank:0});
});
test('negative and failure states cannot improve answerable recall and leak counts remain independent',()=>{
 const row:Observation={id:'a',split:'dev',language:'en',crossLanguage:false,category:'sample',expected:'answerable',observed:'answerable',required:['a'],rankedEvidence:[['a']],durationMs:10,forbiddenHits:[]};
 const r=summarize([row,{...row,id:'b',expected:'forbidden',observed:'allowed',required:[],durationMs:20,forbiddenHits:['private-message']}]);
 assert.equal(r.recallAt10,1);assert.equal(r.negativeStateAccuracy,0);assert.equal(r.forbiddenHits,1);assert.equal(r.latencyMs.p95,20);
 assert.equal(summarize([]).recallAt10,null);
});
function mutated(change:(f:typeof fixture)=>void){const f=structuredClone(fixture);change(f);return()=>validateFixtures(f.corpus,f.cases,f.probe);}
test('labels reject unknown references, fake source locations and wrong project authority',()=>{
 assert.throws(mutated(f=>{f.cases[0].required=['missing.1'];}),/Unknown reference/);
 assert.throws(mutated(f=>{f.corpus.sources[0].clauses[0].location.start=1;}),/Invalid source location/);
 assert.throws(mutated(f=>{f.cases[0].project='gym';}),/Invalid expected authority/);
});
test('holdout contamination and repeated question/labels cannot pass validation',()=>{
 assert.throws(mutated(f=>{f.probe.caseIds[0]=f.cases.find(c=>c.split==='holdout')!.id;}),/Holdout/);
 assert.throws(mutated(f=>{f.cases[1].id=f.cases[0].id;}),/Duplicate case/);
 assert.throws(mutated(f=>{f.cases[0].required=[];}),/Answer label/);
 assert.throws(mutated(f=>{f.cases.find(c=>c.expected==='retrieval_failed')!.fault=undefined;}),/Missing explicit fault/);
});

test('cross-language labels and unpublished diagnostics follow evidence and role scope',()=>{
 assert.throws(mutated(f=>{f.cases[0].crossLanguage=!f.cases[0].crossLanguage;}),/cross-language/);
 assert.throws(mutated(f=>{f.cases.find(c=>c.expected==='draft_only')!.actor='u1';}),/admin scope/);
});

test('frozen hashes detect even valid JSON edits before an evaluation can run',()=>{
 const directory=mkdtempSync(join(tmpdir(),'knowledge-s0-hash-'));
 try{
  for(const name of ['manifest.json','corpus.json','cases.dev.json','cases.holdout.json','probe-set.json'])copyFileSync(join(__dirname,'../evaluation/knowledge',name),join(directory,name));
  appendFileSync(join(directory,'cases.holdout.json'),' ');
  assert.throws(()=>loadFixtures(directory),/Frozen fixture hash mismatch/);
 }finally{for(const name of readdirSync(directory))unlinkSync(join(directory,name));rmdirSync(directory);}
});
