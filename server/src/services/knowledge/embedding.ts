import {LocalProcessPool,RuntimeFailure} from './process-pool';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {z} from 'zod';
import type {IndexIdentity} from '../../models/KnowledgeIndex';
export const sha=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
export class IndexError extends Error { constructor(public code:string,message:string){super(message);} }
const root=resolve(__dirname,'../../../semantic');
export async function embeddingIdentity():Promise<IndexIdentity>{
 const raw=await readFile(join(root,'model.json'),'utf8');
 const lock=JSON.parse(raw) as {model:string;revision:string;files:Record<string,string>;weight:string;dimension:number;maxTokens:number;adapter:string};
 return {id:sha(raw+sha(await readFile(join(root,'runtime.py')))+sha(await readFile(join(root,'retrieval.py')))+sha(await readFile(join(root,'reranker.json')))),model:lock.model,revision:lock.revision,weightHash:lock.files[lock.weight],dimension:lock.dimension,adapter:lock.adapter,maxTokens:lock.maxTokens};
}
const output=z.object({identity:z.string(),dimension:z.number().int(),adapter:z.string(),elapsedMs:z.number().finite(),rssMiB:z.number().finite(),
 vectors:z.array(z.array(z.number().finite()).min(1).max(4096)).max(16).optional(),
 count:z.number().int().optional(),checksum:z.string().optional(),embedded:z.number().int().optional(),reused:z.number().int().optional(),
 segments:z.array(z.object({key:z.string(),text:z.string(),start:z.number().int(),end:z.number().int(),tokens:z.number().int()})).max(4096).optional(),
 trace:z.object({mode:z.string(),queryParts:z.number(),allowedItems:z.number(),candidates:z.number(),timings:z.record(z.number()),reranker:z.object({model:z.string(),revision:z.string(),pairs:z.number()}).nullable(),degraded:z.object({code:z.string(),message:z.string()}).nullable(),diagnostics:z.array(z.object({code:z.string(),sourceId:z.string(),title:z.string()}))}).optional(),
 hits:z.array(z.object({id:z.string(),distance:z.number().finite(),accepted:z.boolean().optional(),scores:z.record(z.number()).optional()})).max(50).optional(),queryDimension:z.number().int().optional(),removed:z.number().optional()}).strict();
export type LocalResult=z.infer<typeof output>;
export interface EmbeddingAdapter {embed(texts:string[],identity:IndexIdentity,signal?:AbortSignal):Promise<{vectors:number[][];identity:string;dimension:number}>}
export interface SemanticAdapter {run(command:Record<string,unknown>,identity:IndexIdentity,signal?:AbortSignal,guard?:()=>Promise<void>):Promise<LocalResult>}
function configuration(){
 const python=process.env.KNOWLEDGE_EMBEDDING_PYTHON||process.env.KNOWLEDGE_PYTHON;
 if(!python||!process.env.KNOWLEDGE_MODEL_DIR||!process.env.KNOWLEDGE_INDEX_DIR)throw new IndexError('runtime_unavailable','本地语义环境未配置，请管理员安装固定组件');
 const env:NodeJS.ProcessEnv={PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4',KNOWLEDGE_RERANKER_DIR:process.env.KNOWLEDGE_RERANKER_DIR,KNOWLEDGE_MODEL_DIR:process.env.KNOWLEDGE_MODEL_DIR,KNOWLEDGE_INDEX_DIR:process.env.KNOWLEDGE_INDEX_DIR};
 for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH'])if(process.env[key])env[key]=process.env[key];
 return {key:sha(JSON.stringify([python,env])),python,script:join(root,'runtime.py'),env};
}
export const semanticPool=new LocalProcessPool(configuration);
process.once('beforeExit',()=>semanticPool.close());
export const localEmbedding:EmbeddingAdapter&SemanticAdapter={async embed(texts,identity,signal){
 const result=await localEmbedding.run({command:'embed',projectId:'embedding-adapter-probe',texts},identity,signal);
 if(!result.vectors||result.vectors.length!==texts.length||result.vectors.some(v=>v.length!==identity.dimension))throw new IndexError('invalid_vector','模型向量维度无效');
 return {vectors:result.vectors,identity:result.identity,dimension:result.dimension};
},async run(command,identity,signal,guard){
 try{
  const raw=await semanticPool.run({...command,identity:identity.id,dimension:identity.dimension},signal,guard) as {ok:boolean;code?:string;result?:unknown};
  if(!raw.ok)throw new IndexError(raw.code??'local_runtime_failure','本地模型或索引处理失败，请检查固定组件和存储');
  const result=output.parse(raw.result);if(result.identity!==identity.id||result.dimension!==identity.dimension||result.adapter!==identity.adapter)throw new IndexError('invalid_result','本地组件身份无效，未使用旧索引');return result;
 }catch(e){if(e instanceof IndexError)throw e;throw new IndexError(e instanceof RuntimeFailure?e.code:'invalid_result','本地语义服务未完成，请稍后重试或检查运行环境');}
}};
