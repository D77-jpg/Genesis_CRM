import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {z} from 'zod';
import type {KnowledgeBundle,KnowledgeSource,KnowledgeTerm} from '../../src/services/agent/knowledge-types';
import {factScopeInput} from '../../src/services/agent/conditional-facts';
import {checkSemanticResults,providerFactVerifier,evidenceForCheck} from '../../src/services/agent/fact-verifier';
const caseInput=z.object({id:z.string(),split:z.enum(['dev','holdout']),kind:z.enum(['ordinary','critical']),source:z.string().min(1),claim:z.string().min(1),supported:z.boolean()}).strict();
export function loadFactCases(directory=join(__dirname,'facts')){
 const bytes=readFileSync(join(directory,'cases.json'));const lock=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')) as {sha256:string;cases:number};
 if(createHash('sha256').update(bytes).digest('hex')!==lock.sha256)throw Error('Frozen S4 fixture hash mismatch');
 const data=z.object({schemaVersion:z.literal(1),fictional:z.literal(true),cases:z.array(caseInput).length(44)}).strict().parse(JSON.parse(bytes.toString('utf8')));
 if(lock.cases!==data.cases.length||new Set(data.cases.map(c=>c.id)).size!==data.cases.length)throw Error('Duplicate/missing S4 fixture');
 for(const split of ['dev','holdout']){const cases=data.cases.filter(c=>c.split===split);if(cases.length!==22||cases.filter(c=>c.kind==='ordinary'&&c.supported).length!==8||cases.filter(c=>c.kind==='critical').length!==6)throw Error('Unbalanced S4 split');}
 return {cases:data.cases,sha256:lock.sha256};
}
export function factCaseBundle(row:z.infer<typeof caseInput>):KnowledgeBundle{
 const term:KnowledgeTerm={topic:'moq',value:'73',unit:'pcs',conditions:'standard product',mode:'confirmed',scope:factScopeInput.parse({reviewed:true,products:[]})};
 const source:KnowledgeSource={sourceId:'knowledge:'+row.id+':v1',title:'Fictional '+row.id,version:1,kind:'knowledge',category:row.kind==='ordinary'?'company':'trade',content:row.source,source:'fixture://s4/'+row.id,applicability:row.kind==='critical'?'standard product':'fictional independent evaluation only',products:[],validFrom:'2020-01-01T00:00:00Z',validUntil:'2099-01-01T00:00:00Z',terms:row.kind==='critical'?[term]:[]};
 return {projectId:'fictional-s4',status:'ready',sources:[source],topics:[],issues:[],factContext:{}};
}
async function main(){
 const args=process.argv.slice(2);const value=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
 const fixture=loadFactCases();
 if(!args.includes('--live')){console.log(JSON.stringify({validated:true,fictional:true,cases:fixture.cases.length,dev:22,holdout:22,sha256:fixture.sha256,live:false}));return;}
 const split=value('--split');if(split!=='dev'&&split!=='holdout')throw Error('Select dev or holdout explicitly');
 const destination=value('--authorized-origin'),expectedHash=value('--dataset-sha256');
 const env=(await import('../../src/config/env')).default;
 if(!destination||new URL(env.OPENAI_BASE_URL).origin!==new URL(destination).origin||expectedHash!==fixture.sha256)throw Error('Explicit authorized origin and frozen dataset SHA-256 required');
 const out=value('--out');if(!out)throw Error('Explicit output report path required');
 // Never overwrite the first independent measurement, even after a failed gate.
 try{readFileSync(out);throw Error('Report already exists; preserve first measurement');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const {MongoMemoryServer}=await import('mongodb-memory-server');const db=await MongoMemoryServer.create({instance:{dbName:'s4_live_fictional_eval'}});
 const mongoose=await import('mongoose');await mongoose.connect(db.getUri());
 const {OpenAIResponsesProvider}=await import('../../src/services/agent/openai-provider');const {Types}=mongoose;
 const provider=new OpenAIResponsesProvider();const verifier=providerFactVerifier(provider,{id:String(new Types.ObjectId()),projectId:String(new Types.ObjectId()),username:'s4-eval-fixture',displayName:'Fictional evaluator',role:'admin'});if(!verifier)throw Error('Live provider unavailable');
 const startHashes=Object.fromEntries(['src/services/agent/fact-verifier.ts','src/services/agent/conditional-facts.ts','src/services/agent/knowledge-grounding.ts','evaluation/knowledge/fact-evaluation.ts'].map(path=>[path,createHash('sha256').update(readFileSync(join(__dirname,'../../',path))).digest('hex')]));
 const rows=[];
 try{
  for(const row of fixture.cases.filter(c=>c.split===split)){
   const bundle=factCaseBundle(row);const evidence=evidenceForCheck(bundle);
   const started=Date.now();let checked;let modelChecks;let error:string|undefined;
   try{modelChecks=await verifier.check({segments:[{id:'s0',text:row.claim}],evidence});checked=checkSemanticResults(row.claim,bundle,modelChecks)[0];}catch(e){const code=(e as {code?:unknown})?.code;error=typeof code==='string'&&/^[A-Z0-9_]{1,80}$/.test(code)?code:'verification_failed';}
   const supported=checked?.status==='supported';const correct=!error&&supported===row.supported;
   rows.push({id:row.id,kind:row.kind,expectedSupported:row.supported,observed:checked?.status??'unverifiable',correct,error,durationMs:Date.now()-started,check:checked,modelChecks});
   console.log(JSON.stringify({id:row.id,correct,observed:checked?.status??error}));
  }
  const ordinary=rows.filter(r=>r.kind==='ordinary'),critical=rows.filter(r=>r.kind==='critical');
  const judged=ordinary.filter(r=>!r.error);const accuracy=judged.length?judged.filter(r=>r.correct).length/judged.length:null;
  const unsupportedReleased=critical.filter(r=>!r.expectedSupported&&r.observed==='supported').length;
  const criticalCovered=critical.filter(r=>r.expectedSupported&&r.observed==='supported').length;
  const sourceUnchanged=Object.entries(startHashes).every(([path,sha])=>createHash('sha256').update(readFileSync(join(__dirname,'../../',path))).digest('hex')===sha);
  const pass=accuracy!==null&&accuracy>=.95&&unsupportedReleased===0&&criticalCovered===critical.filter(r=>r.expectedSupported).length&&sourceUnchanged&&rows.every(r=>!r.error);
  const report={contract:'s4-eval-v1',fictional:true,split,independentHoldout:split==='holdout',datasetSha256:fixture.sha256,measuredAt:new Date().toISOString(),model:provider.model,destination:new URL(env.OPENAI_BASE_URL).origin,sourceHashes:Object.entries(startHashes).map(([path,sha256])=>({path,sha256})),sourceUnchanged,metrics:{ordinaryAccuracy:accuracy,unsupportedCriticalReleased:unsupportedReleased,criticalPositiveCoverage:criticalCovered/critical.filter(r=>r.expectedSupported).length,verificationFailures:rows.filter(r=>r.error).length},gatesPassed:pass,rows};
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({split,metrics:report.metrics,gatesPassed:pass}));if(!pass)process.exitCode=1;
 }finally{await mongoose.disconnect();await db.stop();}
}
if(require.main===module)void main().catch(()=>{console.error('S4 evaluation failed safely; no real customer or email operation was performed.');process.exitCode=1;});
