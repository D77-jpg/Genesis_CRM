import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import type {AuthUser} from '../src/types/express';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';
// A whole document is reviewed as one entry. Parser chunks remain provenance only.
let memory:MongoMemoryServer, mongoose:typeof import('mongoose'), service:typeof import('../src/services/knowledge/document.service');
let models:typeof import('../src/models/KnowledgeDocument'), knowledge:typeof import('../src/models/AgentKnowledge');
const projectId=new Types.ObjectId();let counter=0;
const actor:AuthUser={id:String(new Types.ObjectId()),projectId:String(projectId),role:'admin',username:'collection-fixture',displayName:'Collection Fixture'};
async function fixture(chunks:string[]){
 const ticket=String(++counter).padStart(2,'0');
 const doc=await models.KnowledgeDocument.create({projectId,kind:'project_document',originalName:'profile-'+ticket+'.md',extension:'md',mime:'text/markdown',bytes:100,
  sha256:ticket.repeat(32),uploadedBy:new Types.ObjectId(actor.id),source:'profile.md',category:'pending'});
 const parsing=await models.KnowledgeParsing.create({projectId,documentId:doc._id,requestedBy:new Types.ObjectId(actor.id),revision:1,parserVersion:'fixture',
  configHash:'x',state:'succeeded',artifactHash:'b'.repeat(64),chunkCount:chunks.length,warnings:[]});
 await models.KnowledgeChunk.insertMany(chunks.map((content,ordinal)=>({_id:ticket+String(ordinal+1).padStart(62,'0'),projectId,documentId:doc._id,
  parsingRevisionId:parsing._id,artifactHash:'b'.repeat(64),ordinal,content,contentHash:String(ordinal).padStart(64,'c'),headingPath:['01 heading'],
  location:{kind:'text',start:ordinal*10,end:ordinal*10+content.length}})));
 return doc.id;
}
async function tableFixture(extension:string,headers:string[],rows:string[][]){
 const ticket=String(++counter).padStart(2,'0');
 const doc=await models.KnowledgeDocument.create({projectId,kind:'project_document',originalName:'sheet-'+ticket+'.'+extension,extension,mime:'text/csv',bytes:100,
  sha256:ticket.repeat(32),uploadedBy:new Types.ObjectId(actor.id),source:'sheet',category:'pending'});
 const parsing=await models.KnowledgeParsing.create({projectId,documentId:doc._id,requestedBy:new Types.ObjectId(actor.id),revision:1,parserVersion:'fixture',
  configHash:'x',state:'succeeded',artifactHash:'b'.repeat(64),chunkCount:rows.length,warnings:[]});
 await models.KnowledgeChunk.insertMany(rows.map((cells,ordinal)=>({_id:ticket+String(ordinal+1).padStart(62,'t'),projectId,documentId:doc._id,
  parsingRevisionId:parsing._id,artifactHash:'b'.repeat(64),ordinal,content:headers.join(' | ')+'\n'+cells.join(' | '),headers,
  table:{headers,rows:[cells]},contentHash:String(ordinal).padStart(64,'c'),headingPath:[],location:{kind:'table',sheet:'Sheet1'}})));
 return doc.id;
}
async function markdownTableFixture(headerText:string,rowTexts:string[],note:string,extraChunks:string[]=[]){
 const ticket=String(++counter).padStart(2,'0');
 const doc=await models.KnowledgeDocument.create({projectId,kind:'project_document',originalName:'table-'+ticket+'.md',extension:'md',mime:'text/markdown',bytes:100,
  sha256:ticket.repeat(32),uploadedBy:new Types.ObjectId(actor.id),source:'table.md',category:'pending'});
 const parsing=await models.KnowledgeParsing.create({projectId,documentId:doc._id,requestedBy:new Types.ObjectId(actor.id),revision:1,parserVersion:'fixture',
  configHash:'x',state:'succeeded',artifactHash:'b'.repeat(64),chunkCount:rowTexts.length+extraChunks.length,warnings:[]});
 await models.KnowledgeChunk.insertMany([
  ...rowTexts.map((rowText,ordinal)=>({_id:ticket+String(ordinal+1).padStart(62,'m'),projectId,documentId:doc._id,
   parsingRevisionId:parsing._id,artifactHash:'b'.repeat(64),ordinal,content:headerText+'\n|---|---|\n'+rowText+'\n'+note,headers:[headerText],
   table:{headerText,rowText,notes:[note]},contentHash:String(ordinal).padStart(64,'c'),headingPath:[],location:{kind:'text'}})),
  ...extraChunks.map((content,index)=>({_id:ticket+String(rowTexts.length+index+1).padStart(62,'x'),projectId,documentId:doc._id,
   parsingRevisionId:parsing._id,artifactHash:'b'.repeat(64),ordinal:rowTexts.length+index,content,
   contentHash:String(200+index).padStart(64,'c'),headingPath:[],location:{kind:'text'}})),
 ]);
 return doc.id;
}
async function wordTableFixture(headerCells:string[],rows:string[][]){
 const ticket=String(++counter).padStart(2,'0');
 const doc=await models.KnowledgeDocument.create({projectId,kind:'project_document',originalName:'word-'+ticket+'.docx',extension:'docx',
  mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:100,sha256:ticket.repeat(32),uploadedBy:new Types.ObjectId(actor.id),source:'word.docx',category:'pending'});
 const parsing=await models.KnowledgeParsing.create({projectId,documentId:doc._id,requestedBy:new Types.ObjectId(actor.id),revision:1,parserVersion:'fixture',
  configHash:'x',state:'succeeded',artifactHash:'b'.repeat(64),chunkCount:rows.length,warnings:[]});
 await models.KnowledgeChunk.insertMany(rows.map((cells,ordinal)=>({_id:ticket+String(ordinal+1).padStart(62,'w'),projectId,documentId:doc._id,
  parsingRevisionId:parsing._id,artifactHash:'b'.repeat(64),ordinal,content:headerCells.join(' | ')+'\n'+cells.join(' | '),
  table:{headers:headerCells,rows:[cells],notes:[]},contentHash:String(ordinal).padStart(64,'c'),headingPath:[],location:{kind:'word',paragraph:ordinal}})));
 return {id:doc.id,name:'word-'+ticket};
}
before(async()=>{
 memory=await MongoMemoryServer.create({instance:{dbName:'collection_fixture'}});
 mongoose=await import('mongoose');await mongoose.connect(memory.getUri());
 models=await import('../src/models/KnowledgeDocument');knowledge=await import('../src/models/AgentKnowledge');
 service=await import('../src/services/knowledge/document.service');
 await Promise.all(Object.values(models).map(m=>m.init()));
 await knowledge.AgentKnowledge.init();
});
after(async()=>{if(mongoose)await mongoose.disconnect();await memory?.stop();});

test('a parsed file becomes one reviewable entry, not one per paragraph',async()=>{
 const id=await fixture(['# 01 heading','first section','second section','---','third section']);
 const preview=await service.previewCollection(id,actor);
 assert.equal(preview.title,'01 heading');
 assert.equal(preview.parts.length,1);
 assert.match(preview.parts[0].content,/first section\n\nsecond section/);
 assert.doesNotMatch(preview.parts[0].content,/---/);
 const result=await service.collectDocument(id,{publish:false},actor);
 assert.equal(result.count,1);
 const saved=await knowledge.AgentKnowledge.findOne({projectId,importKey:/^document-collection:/});
 assert.ok(saved);assert.equal(saved!.approvedVersion,0);
 assert.equal(saved!.revisions[0].category,'reference');
 assert.equal((saved!.revisions[0].sourceRefs??[]).length,4);
 // Provenance points at the real document and parsing revision, not undefined virtuals.
 const refs=saved!.revisions[0].sourceRefs as {documentId:string;parsingRevisionId:string}[];
 assert.ok(refs.every(ref=>ref.documentId===id));
 assert.match(refs[0].parsingRevisionId,/^[a-f0-9]{24}$/);
 // Repeating the request reuses the same entry instead of duplicating it.
 const again=await service.collectDocument(id,{publish:false},actor);
 assert.deepEqual(again.ids,result.ids);
});

test('publishing from the sheet makes the entry usable immediately',async()=>{
 const id=await fixture(['# pricing','MOQ 100 pcs','FOB Shanghai']);
 const result=await service.collectDocument(id,{publish:true,title:'pricing note',category:'trade',source:'isolated test'},actor);
 const saved=await knowledge.AgentKnowledge.findById(result.ids[0]);
 assert.equal(saved!.approvedVersion,1);
 assert.equal(saved!.revisions[0].title,'pricing note');
 assert.equal(saved!.revisions[0].category,'trade');
 assert.equal(saved!.revisions[0].source,'isolated test');
});

test('spreadsheet rows become readable sections instead of pipe-separated text',async()=>{
 const id=await tableFixture('csv',['id','question','answer'],[['q1','最小起订量是多少？','标准款 100 件起订'],['q2','生产交期一般多久？','标准款 20 个工作日']]);
 const preview=await service.previewCollection(id,actor);
 const text=preview.parts[0].content;
 assert.match(text,/### 最小起订量是多少？/);
 assert.match(text,/- id：q1/);
 assert.match(text,/- answer：标准款 100 件起订/);
 assert.doesNotMatch(text,/\|/);
});

test('a markdown table split into one-row chunks is rebuilt as one table',async()=>{
 const header='| # | 品类 |';
 const id=await markdownTableFixture(header,['| 1 | 绒布袋 |','| 2 | 缎面袋 |'],'通用规则：每款独立 SKU');
 const text=(await service.previewCollection(id,actor)).parts[0].content;
 assert.equal(text.split(header).length-1,1);
 assert.match(text,/\| 1 \| 绒布袋 \|[\s\S]*\| 2 \| 缎面袋 \|/);
 // A blank line ends the table; otherwise GFM renders the note as a row.
 assert.match(text,/\| 2 \| 缎面袋 \|\n\n通用规则/);
 assert.equal(text.split('通用规则').length-1,1);
});

test('a note repeated as its own chunk is kept once, outside the table',async()=>{
 const header='| # | 品类 |';
 const note='**通用规则 / Universal rules：**\n- 每个尺寸+颜色视为独立 SKU';
 const id=await markdownTableFixture(header,['| 1 | 绒布袋 |','| 2 | 缎面袋 |'],note,[note]);
 const text=(await service.previewCollection(id,actor)).parts[0].content;
 assert.equal(text.split('**通用规则').length-1,1);
 assert.match(text,/\| 2 \| 缎面袋 \|\n\n\*\*通用规则/);
 assert.doesNotMatch(text,/\| 2 \| 缎面袋 \|\n\*\*通用规则/);
});

test('a Word table whose first column is "#" is merged and never used as the title',async()=>{
 const fixture=await wordTableFixture(['#','品类','MOQ'],[['1','绒布袋','100 pcs'],['2','缎面袋','100 pcs']]);
 const preview=await service.previewCollection(fixture.id,actor);
 assert.equal(preview.title,fixture.name);
 assert.equal(preview.parts[0].content.split('| # | 品类 | MOQ |').length-1,1);
 assert.match(preview.parts[0].content,/\| 1 \| 绒布袋 \| 100 pcs \|[\s\S]*\| 2 \| 缎面袋 \| 100 pcs \|/);
});

test('deleting a file removes its parsing records and the entries collected from it',async()=>{
 const id=await fixture(['# profile','who to contact','who to keep']);
 const result=await service.collectDocument(id,{publish:true},actor);
 await service.deleteDocument(id,actor);
 assert.equal(await models.KnowledgeDocument.findById(id),null);
 assert.equal(await models.KnowledgeParsing.countDocuments({documentId:id}),0);
 assert.equal(await models.KnowledgeChunk.countDocuments({documentId:id}),0);
 assert.equal(await knowledge.AgentKnowledge.findById(result.ids[0]),null);
});

test('an entry can be removed permanently, including an archived one',async()=>{
 const id=await fixture(['# note','one line']);
 const {ids}=await service.collectDocument(id,{publish:false},actor);
 const {deleteKnowledge,archiveKnowledge}=await import('../src/services/agent/knowledge.service');
 await archiveKnowledge(ids[0],1,actor);
 assert.ok(await knowledge.AgentKnowledge.findById(ids[0]));
 await deleteKnowledge(ids[0],actor);
 assert.equal(await knowledge.AgentKnowledge.findById(ids[0]),null);
});

test('a file still being parsed cannot be collected',async()=>{ const doc=await models.KnowledgeDocument.create({projectId,kind:'project_document',originalName:'pending.pdf',extension:'pdf',mime:'application/pdf',bytes:1,
  sha256:'d'.repeat(64),uploadedBy:new Types.ObjectId(actor.id),source:'pending.pdf',category:'pending'});
 await models.KnowledgeParsing.create({projectId,documentId:doc._id,requestedBy:new Types.ObjectId(actor.id),revision:1,parserVersion:'fixture',
  configHash:'x',state:'running',artifactHash:'e'.repeat(64)});
 await assert.rejects(service.collectDocument(doc.id,{publish:true},actor),/解析完成/);
});
