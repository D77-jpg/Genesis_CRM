import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {termInput} from '../../src/services/agent/knowledge.service';

const clause=z.object({id:z.string().min(1),quote:z.string().min(1),location:z.object({kind:z.literal('text'),start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict(),matchAll:z.array(z.string().min(1)).optional()}).strict();
const source=z.object({id:z.string().min(1),project:z.enum(['pack','gym']),kind:z.enum(['knowledge','quotation']),language:z.enum(['en','zh']),title:z.string(),category:z.enum(['company','product','trade','compliance','sales_rules','faq']),content:z.string().min(1),tags:z.array(z.string()),products:z.array(z.string()),state:z.enum(['active','expired','disabled','future','draft']),version:z.literal(1),source:z.string().startsWith('fixture://'),clauses:z.array(clause).min(1),terms:z.array(termInput),draftContent:z.string().optional()}).strict();
export const caseSchema=z.object({id:z.string().min(1),split:z.enum(['dev','holdout']),project:z.enum(['pack','gym']),actor:z.enum(['u1','u2','admin']),customer:z.enum(['c1','c2','cGym','cPool']).nullable(),operation:z.enum(['bundle','customer','mail','tool']),query:z.string().min(1),language:z.enum(['en','zh']),crossLanguage:z.boolean(),category:z.string().min(1),expected:z.enum(['answerable','no_match','expired','disabled','not_effective','draft_only','conflict','forbidden','retrieval_failed']),required:z.array(z.string()),forbidden:z.array(z.string()),forbiddenClaims:z.array(z.string()).min(1),conditions:z.string().min(1),foreignIds:z.array(z.string()).optional(),mail:z.enum(['private-other','private-reassigned','private-deleted','private-foreign']).optional(),toolArguments:z.record(z.unknown()).optional(),fault:z.literal('knowledge_find').optional()}).strict();
export type EvaluationCase=z.infer<typeof caseSchema>;
export type FixtureSource=z.infer<typeof source>;
export function validateFixtures(rawCorpus:unknown,rawCases:unknown,rawProbe:unknown){
 const corpus=z.object({schemaVersion:z.literal(1),license:z.literal('CC0-1.0'),fictional:z.literal(true),asOf:z.string().datetime({offset:true}),sources:z.array(source).min(20)}).strict().parse(rawCorpus);
 const cases=z.array(caseSchema).length(120).parse(rawCases);
 const probe=z.object({schemaVersion:z.literal(1),caseIds:z.array(z.string()).min(8),note:z.string()}).strict().parse(rawProbe);
 const unique=(values:string[],label:string)=>{if(new Set(values).size!==values.length)throw Error('Duplicate '+label);};
 unique(corpus.sources.map(s=>s.id),'source');unique(cases.map(c=>c.id),'case');unique(probe.caseIds,'probe');
 unique(cases.map(c=>[c.project,c.actor,c.customer,c.operation,c.query.trim().toLowerCase().replace(/\s+/g,' ')].join('|')),'scoped query');
 const clauses=new Map<string,{source:FixtureSource;quote:string}>();
 for(const s of corpus.sources)for(const c of s.clauses){
  if(clauses.has(c.id))throw Error('Duplicate clause');
  // Python fixture offsets use Unicode code points; JavaScript UTF-16 cannot silently reinterpret them.
  if(Array.from(s.content).slice(c.location.start,c.location.end).join('')!==c.quote)throw Error('Invalid source location '+c.id);
  clauses.set(c.id,{source:s,quote:c.quote});
 }
 for(const split of ['dev','holdout']){
  const rows=cases.filter(c=>c.split===split);
  if(rows.length!==60||rows.filter(c=>c.expected==='answerable').length!==40)throw Error('Unbalanced split '+split);
 }
 for(const c of cases){
  unique(c.required,'required reference');
  if((c.expected==='answerable')!==(c.required.length>0))throw Error('Answer label requires evidence '+c.id);
  for(const id of [...c.required,...c.forbidden])if(!clauses.has(id))throw Error('Unknown reference '+id);
  for(const id of c.required){const s=clauses.get(id)!.source;if(s.project!==c.project||s.state!=='active')throw Error('Invalid expected authority '+c.id);}
  if(c.crossLanguage!==c.required.some(id=>clauses.get(id)!.source.language!==c.language))throw Error('Incorrect cross-language label '+c.id);
  if(c.expected==='draft_only'&&c.actor!=='admin')throw Error('Unpublished diagnostics require admin scope');
  if(c.expected==='retrieval_failed'&&!c.fault)throw Error('Missing explicit fault injection');
  if(c.operation==='mail'&&!c.mail)throw Error('Missing mail fixture');
 }
 for(const id of probe.caseIds)if(cases.find(c=>c.id===id)?.split!=='dev')throw Error('Holdout used in component selection');
 return {corpus,cases,probe};
}
export function loadFixtures(directory=__dirname){
 const json=(name:string)=>JSON.parse(readFileSync(join(directory,name),'utf8')) as unknown;
 const sha=z.string().regex(/^[a-f0-9]{64}$/);
 const lock=z.object({schemaVersion:z.literal(1),datasetVersion:z.literal('s0-fixtures-v1'),frozenAt:z.string(),baseCommit:z.string().regex(/^[a-f0-9]{40}$/),fictional:z.literal(true),holdoutPolicy:z.string().min(20),sha256:z.object({'corpus.json':sha,'cases.dev.json':sha,'cases.holdout.json':sha,'probe-set.json':sha}).strict()}).strict().parse(json('manifest.json'));
 for(const [file,sha] of Object.entries(lock.sha256)){if(createHash('sha256').update(readFileSync(join(directory,file))).digest('hex')!==sha)throw Error('Frozen fixture hash mismatch '+file);}
 return validateFixtures(json('corpus.json'),[...(json('cases.dev.json') as unknown[]),...(json('cases.holdout.json') as unknown[])],json('probe-set.json'));
}
if(require.main===module){const f=loadFixtures();console.log(JSON.stringify({valid:true,sources:f.corpus.sources.length,cases:f.cases.length,dev:60,holdout:60,probes:f.probe.caseIds.length}));}
