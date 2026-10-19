
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {buildSync}=require('esbuild');
const build=buildSync({entryPoints:[path.resolve(__dirname,'../src/lib/knowledge-sales.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const compiled={exports:{}};
new Function('module','exports',build.outputFiles[0].text)(compiled,compiled.exports);
const {salesKnowledge,matchesSalesKnowledge,knowledgeEmailPrompt,acceptsKnowledgeHandoff,salesTermState,salesTermDetails}=compiled.exports;
const now=Date.parse('2026-10-20T12:00:00Z');
const revision=(version,extra={})=>({version,approved:true,title:'Fictional linen pouch',category:'trade',tags:['linen','亚麻袋'],content:'Fictional approved source only.',source:'fixture://only',products:['linen pouch'],applicability:'standard bag only',validFrom:'2026-01-01T00:00:00Z',terms:[{topic:'sample',value:'9',currency:'USD',unit:'prototype',conditions:'courier excluded',mode:'confirmed'}],...extra});
const row=(extra={})=>({id:'a'.repeat(24),projectId:'p',version:2,approvedVersion:1,archived:false,effective:true,status:'published',hasDraft:true,updatedAt:'2026-10-01T00:00:00Z',revisions:[revision(1),revision(2,{approved:false,title:'UNPUBLISHED PROMISE'})],...extra});
test('sales view uses the approved revision even when the latest administrator edit is a draft',()=>{
 const original=row(),items=salesKnowledge([original],now);assert.equal(items.length,1);assert.equal(items[0].revision.version,1);assert.equal(items[0].revision.title,'Fictional linen pouch');assert.equal(original.revisions[1].title,'UNPUBLISHED PROMISE');
});
test('draft-only, disabled, server-inactive, future, expired and malformed dates are not usable sales material',()=>{
 const cases=[row({approvedVersion:0}),row({archived:true}),row({effective:false}),row({revisions:[revision(1,{validFrom:'2027-01-01'})]}),row({revisions:[revision(1,{validUntil:'2026-10-20T12:00:00Z'})]}),row({revisions:[revision(1,{validFrom:'invalid'})]}),row({revisions:[revision(1,{validUntil:'invalid'})]}),row({revisions:[revision(1,{approved:false})]})];assert.deepEqual(salesKnowledge(cases,now),[]);
});
test('only a matching approved version can be selected; array order does not grant publication',()=>{
 assert.deepEqual(salesKnowledge([row({approvedVersion:7})],now),[]);const items=salesKnowledge([row({revisions:[revision(2),revision(1)]})],now);assert.equal(items[0].revision.version,1);
});
test('sales filtering finds multilingual tags and conditional policy fields but not the unapproved revision',()=>{
 const item=salesKnowledge([row()],now)[0];assert.ok(matchesSalesKnowledge(item,'亚麻袋 USD courier','trade'));assert.equal(matchesSalesKnowledge(item,'UNPUBLISHED PROMISE','all'),false);assert.equal(matchesSalesKnowledge(item,'linen','company'),false);assert.ok(matchesSalesKnowledge(item,'','all'));
});
test('knowledge handoff must match project, signed-in user and exact customer route',()=>{
 const h={requestId:'one',projectId:'p',userId:'u',customerId:'c',prompt:'fictional request'};
 assert.ok(acceptsKnowledgeHandoff(h,'p','u',{type:'customer',resourceId:'c'}));
 for(const args of [[h,'other','u',{type:'customer',resourceId:'c'}],[h,'p','other',{type:'customer',resourceId:'c'}],[h,'p','u',{type:'customer',resourceId:'other'}],[h,'p','u',{type:'project'}],[null,'p','u',{type:'customer',resourceId:'c'}],[h,undefined,undefined,{type:'customer',resourceId:'c'}]])assert.equal(acceptsKnowledgeHandoff(...args),false);
});
test('the handoff requests fresh evidence and human draft review without copying policy values into an instruction',()=>{
 const prompt=knowledgeEmailPrompt(salesKnowledge([row()],now)[0]);assert.match(prompt,/检索当前项目已发布且适用/);assert.match(prompt,/资料已变或不适用时请提醒我/);assert.match(prompt,/不要发送邮件/);assert.doesNotMatch(prompt,/USD|courier excluded/);
});

test('a reviewed condition that expired or is not yet effective is never labelled ready for use',()=>{
 const term={mode:'confirmed',scope:{reviewed:true,validUntil:'2026-01-01'}};assert.match(salesTermState(term,now),/已过期/);
 assert.match(salesTermState({mode:'confirmed',scope:{reviewed:true,validFrom:'2027-01-01'}},now),/尚未生效/);
 assert.match(salesTermState({mode:'confirmed',scope:{reviewed:true,certificate:{validUntil:'2026-01-01'}}},now),/已过期/);
 assert.match(salesTermState({mode:'confirmed'},now),/需人工确认/);
});
test('sales details preserve quantity inequalities, lead-time origin, exclusions and certificate scope',()=>{
 const lines=salesTermDetails({min:3,max:9,unit:'USD',scope:{products:['fictional pouch'],processes:['printing'],quantity:{min:80,max:140,minInclusive:false,maxInclusive:true,unit:'pcs'},startsAfter:'artwork approval',origin:'A',destination:'B',incoterm:'FOB',polarity:'denied',exclusions:['courier excluded'],certificate:{number:'FICTIONAL',issuer:'Synthetic',products:['fictional pouch'],validUntil:'2027-01-01'}}}).join(' ');
 for(const expected of ['>80','≤140','pcs','artwork approval','courier excluded','不提供','FICTIONAL','fictional pouch','FOB','区间下限：3','区间上限：9'])assert.ok(lines.includes(expected),expected);
});
