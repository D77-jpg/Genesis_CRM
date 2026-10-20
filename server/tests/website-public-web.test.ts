import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {RequestOptions,IncomingHttpHeaders,IncomingMessage} from 'node:http';
import {fetchWebsite} from '../src/services/website/public-web';
const dns=require('node:dns/promises') as typeof import('node:dns/promises');
const https=require('node:https') as typeof import('node:https');
type Response={status?:number;location?:string;mime?:string;body?:Buffer|string;encoding?:string};
function transport(replies:Response[],addresses=['93.184.215.14']){
 let resolutions=0;const calls:{url:URL;headers:Record<string,string>}[]=[];
 mock.method(dns,'lookup',(async()=>[{address:addresses[Math.min(resolutions++,addresses.length-1)],family:4}]) as unknown as typeof dns.lookup);
 mock.method(https,'request',((url:URL,options:RequestOptions,callback:(message:IncomingMessage)=>void)=>{
  const next=replies[calls.length]??{};calls.push({url,headers:options.headers as Record<string,string>});
  options.lookup!(url.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.215.14');assert.equal(family,4);});
  class ResponseStream extends PassThrough {statusCode=next.status??200;headers:IncomingHttpHeaders={'content-type':next.mime??'text/html; charset=utf-8',...(next.location?{location:next.location}:{}),...(next.encoding?{'content-encoding':next.encoding}:{})};}
  class Request extends EventEmitter {
   end(){queueMicrotask(()=>{const stream=new ResponseStream();callback(stream as unknown as IncomingMessage);if(!stream.destroyed)stream.end(next.body??'<html><p>Fictional public page.</p></html>');this.emit('close');});return this;}
   destroy(error?:Error){if(error)this.emit('error',error);this.emit('close');return this;}
  }return new Request();
 }) as unknown as typeof https.request);
 return calls;
}
test('HTTP adapter pins validated DNS, omits credentials and requests bounded uncompressed HTML',async()=>{
 try{const calls=transport([{}]);const result=await fetchWebsite('https://example.com/');assert.match(result.text,/Fictional public page/);assert.equal(calls.length,1);assert.equal(calls[0].headers['Accept-Encoding'],'identity');assert.equal(calls[0].headers.Cookie,undefined);assert.equal(calls[0].headers.Authorization,undefined);}finally{mock.restoreAll();}
});
test('redirects cannot reach private IPs, foreign hosts or downgrade HTTPS',async()=>{
 for(const destination of ['https://127.0.0.1/','https://other-company.com/','http://example.com/'])try{const calls=transport([{status:302,location:destination}]);await assert.rejects(fetchWebsite('https://example.com/'));assert.equal(calls.length,1);}finally{mock.restoreAll();}
});
test('DNS is revalidated on each redirect, blocking a public-to-private rebinding answer',async()=>{
 try{const calls=transport([{status:302,location:'/contact'}],['93.184.215.14','127.0.0.1']);await assert.rejects(fetchWebsite('https://example.com/'),/受限地址/);assert.equal(calls.length,1);}finally{mock.restoreAll();}
});
test('HTML size, MIME, charset, compression and redirect limits reject instead of parsing arbitrary bytes',async()=>{
 for(const response of [{body:Buffer.alloc(2*1024*1024+1)},{mime:'application/octet-stream'},{mime:'text/html; charset=gbk'},{encoding:'gzip'}])try{transport([response]);await assert.rejects(fetchWebsite('https://example.com/'));}finally{mock.restoreAll();}
 try{const calls=transport(Array.from({length:4},()=>({status:302,location:'/again'})));await assert.rejects(fetchWebsite('https://example.com/'),/跳转次数/);assert.equal(calls.length,4);}finally{mock.restoreAll();}
});
test('robots absence is distinguished from forbidden or unsupported responses',async()=>{
 try{transport([{status:404}]);assert.equal((await fetchWebsite('https://example.com/robots.txt','robots')).text,'');}finally{mock.restoreAll();}
 try{transport([{status:403}]);await assert.rejects(fetchWebsite('https://example.com/robots.txt','robots'),/限制访问/);}finally{mock.restoreAll();}
});
