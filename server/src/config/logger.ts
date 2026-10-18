import {appendFileSync,statSync,renameSync,rmSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import env from './env';
type Level='debug'|'info'|'warn'|'error';
let windowAt=Date.now(),written=0,suppressed=0;
export function logStatus(){return {windowMs:1000,maxEventsPerWindow:100,maxLineBytes:1024,written,suppressed,privateText:false,fileLimitBytes:2097152,fileCopies:3};}
export function safeLog(level:Level,scope:string,meta?:unknown){
 if(level==='debug'&&env.isProd)return;
 if(Date.now()-windowAt>=1000){windowAt=Date.now();written=0;}if(written>=100){suppressed++;return;}written++;
 const data:Record<string,number|string|boolean>={};
 if(meta&&typeof meta==='object'){const obj=meta as Record<string,unknown>;for(const key of ['status','statusCode','durationMs','elapsedMs','attempt','attempts','count','total','done','inputTokens','outputTokens'])if(typeof obj[key]==='number'&&Number.isFinite(obj[key]))data[key]=obj[key] as number;
 // Error text, stack, URL, mailbox and document content deliberately have no logging channel.
 if(typeof obj.code==='string'&&new Set(['BAD_REQUEST','VALIDATION_ERROR','FORBIDDEN','NOT_FOUND','CONFLICT','INTERNAL_ERROR','RATE_LIMITED','OPENAI_TIMEOUT','OPENAI_UNREACHABLE','OPENAI_CIRCUIT_OPEN','OPENAI_CAPACITY','cancelled','timeout','index_stale','retrieval_failed']).has(obj.code))data.code=obj.code;
 }
 const line=JSON.stringify({at:new Date().toISOString(),level,scope:/^[a-zA-Z0-9_-]{1,48}$/.test(scope)?scope:'service',event:'service_'+level,...data});
 if(process.env.CRM_LOG_FILE){try{const file=resolve(process.env.CRM_LOG_FILE);for(const path of [file,file+'.1',file+'.2']){try{if(lstatSync(path).isSymbolicLink())throw Error('unsafe_log');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}let size=0;try{size=statSync(file).size;}catch{}if(size+Buffer.byteLength(line)+1>2097152){rmSync(file+'.2',{force:true});try{renameSync(file+'.1',file+'.2');}catch{}try{renameSync(file,file+'.1');}catch{}}appendFileSync(file,line+'\n',{mode:0o600});}catch{/* bounded console remains available; no raw OS error */}}
 (level==='error'?console.error:level==='warn'?console.warn:console.log)(line.slice(0,1024));
}
export const createLogger=(scope:string)=>({debug:(_msg:string,meta?:unknown)=>safeLog('debug',scope,meta),info:(_msg:string,meta?:unknown)=>safeLog('info',scope,meta),warn:(_msg:string,meta?:unknown)=>safeLog('warn',scope,meta),error:(_msg:string,meta?:unknown)=>safeLog('error',scope,meta)});
export const logger=createLogger('app');export default logger;
