const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {buildSync}=require('esbuild');
const build=buildSync({entryPoints:[path.resolve(__dirname,'../src/lib/knowledge-upload.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const compiled={exports:{}};
new Function('module','exports',build.outputFiles[0].text)(compiled,compiled.exports);
const {validateKnowledgeFiles,knowledgeUploadMetadata}=compiled.exports;

test('file-only upload omits optional fields rather than inventing a source or policy category',()=>{
 assert.deepEqual(knowledgeUploadMetadata('  ',''),{});
 assert.deepEqual(knowledgeUploadMetadata('  Fictional handbook  ','trade'),{source:'Fictional handbook',category:'trade'});
});
test('accepts the implemented local formats and rejects unsupported, empty, oversized and over-batch selections',()=>{
 for(const ext of ['TXT','md','markdown','pdf','docx','xlsx','csv','png','jpg','jpeg'])assert.equal(validateKnowledgeFiles([{name:'Fictional.'+ext,size:1}]),null);
 assert.match(validateKnowledgeFiles([{name:'macro.xlsm',size:10}]),/暂不支持/);
 assert.match(validateKnowledgeFiles([{name:'empty.pdf',size:0}]),/文件为空/);
 assert.equal(validateKnowledgeFiles([{name:'limit.pdf',size:15*1024**2}]),null);
 assert.match(validateKnowledgeFiles([{name:'large.pdf',size:15*1024**2+1}]),/15MB/);
 assert.match(validateKnowledgeFiles(Array.from({length:11},()=>({name:'file.txt',size:1}))),/10/);
});
