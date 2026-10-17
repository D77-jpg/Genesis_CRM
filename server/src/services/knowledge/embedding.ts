import {spawn} from 'node:child_process';
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
 return {id:sha(raw+sha(await readFile(join(root,'runtime.py')))),model:lock.model,revision:lock.revision,weightHash:lock.files[lock.weight],dimension:lock.dimension,adapter:lock.adapter,maxTokens:lock.maxTokens};
}
const output=z.object({identity:z.string(),dimension:z.number().int(),adapter:z.string(),elapsedMs:z.number().finite(),rssMiB:z.number().finite(),
 vectors:z.array(z.array(z.number().finite()).min(1).max(4096)).max(16).optional(),
 count:z.number().int().optional(),checksum:z.string().optional(),embedded:z.number().int().optional(),reused:z.number().int().optional(),
 hits:z.array(z.object({id:z.string(),distance:z.number().finite()})).max(30).optional(),queryDimension:z.number().int().optional(),removed:z.number().optional()}).strict();
export type LocalResult=z.infer<typeof output>;
export interface EmbeddingAdapter {embed(texts:string[],identity:IndexIdentity,signal?:AbortSignal):Promise<{vectors:number[][];identity:string;dimension:number}>}
export interface SemanticAdapter {run(command:Record<string,unknown>,identity:IndexIdentity,signal?:AbortSignal):Promise<LocalResult>}
let running=0;const waiting:(()=>void)[]=[];
async function acquire(){if(running<2){running++;return;}if(waiting.length>=8)throw new IndexError('capacity_busy','本地语义服务繁忙，请稍后重试');await new Promise<void>(resolve=>waiting.push(resolve));}
function release(){const next=waiting.shift();if(next)next();else running--;}
// Only this real local adapter is wired in production. Unit doubles must be passed explicitly by tests.
export const localEmbedding:EmbeddingAdapter&SemanticAdapter={async embed(texts,identity,signal){
 const result=await localEmbedding.run({command:'embed',projectId:'embedding-adapter-probe',texts},identity,signal);
 if(!result.vectors||result.vectors.length!==texts.length||result.vectors.some(v=>v.length!==identity.dimension))throw new IndexError('invalid_vector','模型向量维度无效');
 return {vectors:result.vectors,identity:result.identity,dimension:result.dimension};
},async run(command,identity,signal){
 const python=process.env.KNOWLEDGE_EMBEDDING_PYTHON||process.env.KNOWLEDGE_PYTHON;
 if(!python||!process.env.KNOWLEDGE_MODEL_DIR||!process.env.KNOWLEDGE_INDEX_DIR)throw new IndexError('runtime_unavailable','本地语义环境未配置，请管理员安装模型和索引组件后重试');
 await acquire();try{return await new Promise((resolveResult,reject)=>{
  const env:NodeJS.ProcessEnv={PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4',
   KNOWLEDGE_MODEL_DIR:process.env.KNOWLEDGE_MODEL_DIR,KNOWLEDGE_INDEX_DIR:process.env.KNOWLEDGE_INDEX_DIR};
  for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH'])if(process.env[key])env[key]=process.env[key];
  const child=spawn(python,['-I',join(root,'runtime.py')],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let text='',failure:IndexError|undefined;
  const stop=()=>{failure??=new IndexError('cancelled','索引任务已停止或权限已变化');child.kill();};
  signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(()=>{failure=new IndexError('timeout','本地语义处理超时，请检查资源后重试');child.kill();},120000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',(s:string)=>{text+=s;if(Buffer.byteLength(text)>2*1024**2){failure=new IndexError('output_limit','索引输出超过限制');child.kill();}});
  child.stderr.on('data',()=>undefined);child.stdin.on('error',()=>undefined);
  child.on('error',()=>{failure=new IndexError('runtime_unavailable','无法启动本地语义进程');});
  child.on('close',()=>{
   clearTimeout(timer);signal?.removeEventListener('abort',stop);
   if(failure){reject(failure);return;}
   try{const parsed=JSON.parse(text);if(!parsed.ok)throw new IndexError(String(parsed.code).slice(0,80),String(parsed.message).slice(0,400));
    const result=output.parse(parsed.result);if(result.identity!==identity.id||result.dimension!==identity.dimension||result.adapter!==identity.adapter)throw new Error();resolveResult(result);
   }catch(e){reject(e instanceof IndexError?e:new IndexError('invalid_result','语义组件返回结果无效，未使用旧索引'));}
  });
  child.stdin.end(JSON.stringify({...command,identity:identity.id,dimension:identity.dimension})+'\n');if(signal?.aborted)stop();
 });}finally{release();}
}};
