import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export class RuntimeFailure extends Error {constructor(public code:string){super(code);}}
interface Config {key:string;python:string;script:string;env:NodeJS.ProcessEnv}
interface Pending {id:string;data:Record<string,unknown>;resolve:(v:unknown)=>void;reject:(e:Error)=>void;signal?:AbortSignal;guard?:()=>Promise<void>;timer:NodeJS.Timeout;abort:()=>void;started:number}
interface Slot {child:ChildProcessWithoutNullStreams;key:string;calls:number;pending?:Pending;buffer:string;rssMiB:number}
export class LocalProcessPool {
 private slots:Slot[]=[];private queue:Pending[]=[];private failures=0;private openedAt=0;private stopped=false;private dispatching=0;
 readonly counters={completed:0,failed:0,cancelled:0,restarts:0,queuePeak:0,queueWaitMs:0};
 constructor(private config:()=>Config,private limits={workers:2,queue:8,queueTimeoutMs:30000,timeoutMs:120000,cooldownMs:30000,maxCalls:32}){}
 status(){return {running:this.slots.filter(s=>s.pending).length,queued:this.queue.length,dispatching:this.dispatching,workers:this.slots.map(s=>({pid:s.child.pid,calls:s.calls,rssMiB:s.rssMiB})),circuitOpen:this.openedAt>0&&Date.now()-this.openedAt<this.limits.cooldownMs,...this.counters};}
 async run(data:Record<string,unknown>,signal?:AbortSignal,guard?:()=>Promise<void>):Promise<unknown>{
  if(this.stopped)throw new RuntimeFailure('runtime_stopped');if(signal?.aborted)throw new RuntimeFailure('cancelled');
  if(this.openedAt&&Date.now()-this.openedAt<this.limits.cooldownMs)throw new RuntimeFailure('circuit_open');
  if(this.queue.length>=this.limits.queue)throw new RuntimeFailure('capacity_busy');
  if(Buffer.byteLength(JSON.stringify(data))>8*1024**2)throw new RuntimeFailure('input_limit');
  return new Promise((resolve,reject)=>{const p:Pending={id:randomUUID(),data,resolve,reject,signal,guard,timer:setTimeout(()=>this.cancel(p,'queue_timeout'),this.limits.queueTimeoutMs),abort:()=>this.cancel(p,'cancelled'),started:Date.now()};signal?.addEventListener('abort',p.abort,{once:true});this.queue.push(p);this.counters.queuePeak=Math.max(this.counters.queuePeak,this.queue.length);this.pump();});
 }
 private references(slot:Slot,ref:boolean){for(const stream of [slot.child.stdin,slot.child.stdout,slot.child.stderr]){const handle=stream as unknown as {ref?:()=>void;unref?:()=>void};if(ref)handle.ref?.();else handle.unref?.();}if(ref)slot.child.ref();else slot.child.unref();}
 private spawn(config:Config){
  const child=spawn(config.python,['-I',config.script,'--worker'],{env:config.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const slot:Slot={child,key:config.key,calls:0,buffer:'',rssMiB:0};this.slots.push(slot);this.counters.restarts++;
  child.stdout.setEncoding('utf8');child.stdout.on('data',(part:string)=>{slot.buffer+=part;if(Buffer.byteLength(slot.buffer)>2*1024**2){this.fail(slot,'output_limit');return;}let end:number;while((end=slot.buffer.indexOf('\n'))>=0){const line=slot.buffer.slice(0,end);slot.buffer=slot.buffer.slice(end+1);if(!line.trim())continue;try{const value=JSON.parse(line);if(!slot.pending||value.requestId!==slot.pending.id)throw new Error();if(value.result?.rssMiB)slot.rssMiB=Number(value.result.rssMiB);this.finish(slot,value);}catch{this.fail(slot,'invalid_result');}}});
  child.stderr.on('data',()=>undefined);child.stdin.on('error',()=>this.fail(slot,'local_runtime_failure'));child.on('error',()=>this.fail(slot,'runtime_unavailable'));child.on('close',()=>{if(this.slots.includes(slot))this.fail(slot,'local_runtime_failure');});return slot;
 }
 private pump(){
  if(this.stopped)return;
  while(this.queue.length&&this.slots.filter(s=>s.pending).length+this.dispatching<this.limits.workers){
   const p=this.queue.shift()!;clearTimeout(p.timer);this.dispatching++;
   p.timer=setTimeout(()=>this.cancel(p,'queue_timeout'),this.limits.queueTimeoutMs);
   void (async()=>{try{await p.guard?.();if(p.signal?.aborted||!this.dispatchingPending.has(p.id))throw new RuntimeFailure('cancelled');
    if(this.openedAt&&Date.now()-this.openedAt<this.limits.cooldownMs)throw new RuntimeFailure('circuit_open');
    const config=this.config();config.key+=':'+String(p.data.identity??'');let slot=this.slots.find(s=>!s.pending&&s.key===config.key);for(const old of [...this.slots])if(!old.pending&&old!==slot)this.retire(old);
    slot??=this.spawn(config);slot.pending=p;slot.calls++;this.references(slot,true);this.counters.queueWaitMs+=Date.now()-p.started;clearTimeout(p.timer);p.timer=setTimeout(()=>this.fail(slot!,'timeout'),this.limits.timeoutMs);slot.child.stdin.write(JSON.stringify({...p.data,requestId:p.id})+'\n');
   }catch(e){this.cleanup(p);p.reject(e instanceof Error?e:new RuntimeFailure('runtime_unavailable'));}finally{this.dispatchingPending.delete(p.id);this.dispatching--;this.pump();}})();this.dispatchingPending.set(p.id,p);
  }
 }
 private dispatchingPending=new Map<string,Pending>();
 private cleanup(p:Pending){clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);}
 private cancel(p:Pending,code:string){
  const slot=this.slots.find(s=>s.pending===p);if(slot){this.fail(slot,code);return;}
  const i=this.queue.indexOf(p);if(i>=0)this.queue.splice(i,1);else if(!this.dispatchingPending.delete(p.id))return;
  this.cleanup(p);this.counters.cancelled++;p.reject(new RuntimeFailure(code));this.pump();
 }
 private finish(slot:Slot,value:unknown){const p=slot.pending;if(!p)return;this.cleanup(p);slot.pending=undefined;
  const ok=(value as {ok?:boolean}).ok;if(ok){this.failures=0;this.openedAt=0;this.counters.completed++;}else {this.counters.failed++;if(['local_runtime_failure','model_files','model_integrity','runtime_unavailable','reranker_integrity'].includes(String((value as {code?:string}).code))&&++this.failures>=3)this.openedAt=Date.now();}
  p.resolve(value);if(!ok||slot.calls>=this.limits.maxCalls||slot.rssMiB>1100)this.retire(slot);else this.references(slot,false);this.pump();
 }
 private fail(slot:Slot,code:string){if(!this.slots.includes(slot))return;const p=slot.pending;slot.pending=undefined;this.retire(slot);if(p){this.cleanup(p);this.counters.failed++;if(['cancelled','runtime_stopped'].includes(code))this.counters.cancelled++;else if(++this.failures>=3)this.openedAt=Date.now();p.reject(new RuntimeFailure(code));}this.pump();}
 private retire(slot:Slot){this.slots=this.slots.filter(s=>s!==slot);slot.child.kill();}
 close(){this.stopped=true;for(const p of [...this.queue,...this.dispatchingPending.values()])this.cancel(p,'runtime_stopped');for(const slot of [...this.slots])this.fail(slot,'runtime_stopped');}
}
