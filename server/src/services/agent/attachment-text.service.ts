import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {AgentAttachmentText} from '../../models/AgentKnowledge';
import {CustomerAttachment} from '../../models';
import {getAttachmentForDownload} from '../attachment.service';
import {getCustomerByIdOrThrow} from '../customer.service';
import {requireProjectId} from '../../utils/access';
import type {AuthUser} from '../../types/express';
// Extraction runs off the API thread, with a memory bound and a hard deadline.
const workerSource=String.raw`
process.once('message',workerData=>{
const parentPort={postMessage:value=>process.send(value,()=>process.exit(0))};
(async()=>{
 const data=Buffer.from(workerData.data,'base64');let text='';let truncated=false;
 if(workerData.ext==='pdf'){
  const {PDFParse}=require(workerData.pdf);const parser=new PDFParse({data:new Uint8Array(data),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
  try{const info=await parser.getInfo();const result=await parser.getText({first:30});text=result.text;truncated=info.total>30;}finally{await parser.destroy();}
 }else if(workerData.ext==='docx'){
  // Reject zip bombs before handing the document to the parser; no external references are loaded.
  let end=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){if(data.readUInt32LE(i)===0x06054b50){end=i;break;}}
  if(end<0)throw Error('ZIP');const count=data.readUInt16LE(end+10);let at=data.readUInt32LE(end+16),total=0;
  if(count>2000)throw Error('ZIP_LIMIT');for(let i=0;i<count;i++){if(data.readUInt32LE(at)!==0x02014b50)throw Error('ZIP');total+=data.readUInt32LE(at+24);if(total>16000000)throw Error('ZIP_LIMIT');at+=46+data.readUInt16LE(at+28)+data.readUInt16LE(at+30)+data.readUInt16LE(at+32);}
  text=(await require(workerData.mammoth).extractRawText({buffer:data})).value;
 }else text=data.toString('utf8');
 truncated=truncated||text.length>24000;parentPort.postMessage({text:text.slice(0,24000).replace(/\x00/g,''),truncated});
})().catch(()=>parentPort.postMessage({failed:true}));});`;
export async function extractAttachmentText(buffer:Buffer,name:string):Promise<{text:string;truncated:boolean;failed?:boolean}>{
 const ext=name.split('.').pop()?.toLowerCase();if(!['pdf','docx','txt','md'].includes(ext||''))return {text:'',truncated:false,failed:true};
 if(buffer.length>5*1024*1024)return {text:'',truncated:true,failed:true};
 return new Promise(resolve=>{
  const worker=spawn(process.execPath,['--max-old-space-size=192','-e',workerSource],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP}});
  worker.send({data:buffer.toString('base64'),ext,pdf:require.resolve('pdf-parse'),mammoth:require.resolve('mammoth')});
  let finished=false;const done=(result:{text:string;truncated:boolean;failed?:boolean})=>{if(finished)return;finished=true;clearTimeout(timer);worker.kill();resolve(result);};
  const timer=setTimeout(()=>done({text:'',truncated:false,failed:true}),12000);
  worker.once('message',(raw)=>{const data=raw as {text:string;truncated:boolean;failed?:boolean};done(data.failed?{text:'',truncated:false,failed:true}:data);});worker.once('error',()=>done({text:'',truncated:false,failed:true}));worker.once('exit',()=>{if(!finished)done({text:'',truncated:false,failed:true});});
 });
}
export async function readAgentAttachment(customerId:string,id:string,actor:AuthUser,force=false){
 await getCustomerByIdOrThrow(customerId,actor);
 const download=await getAttachmentForDownload(customerId,id,actor.projectId);const hash=createHash('sha256').update(download.buffer).digest('hex');
 const filter={projectId:requireProjectId(actor),customerId,attachmentId:id};
 const cached=await AgentAttachmentText.findOne(filter);if(cached?.hash===hash&&!force)return {sourceId:`attachment:${id}:${hash.slice(0,12)}`,name:download.originalName,status:cached.status,text:cached.text??'',reason:cached.reason??'',truncated:cached.truncated,hash};
 const supported=/\.(pdf|docx|txt|md)$/i.test(download.originalName);const result=supported?await extractAttachmentText(download.buffer,download.originalName):{text:'',truncated:false,failed:true};
 const status=!supported?'unsupported':result.failed?'failed':result.text.trim()?'ready':'no_text';
 const reason=status==='ready'?'客户提供的附件内容，不能作为我方已确认供货承诺。':status==='unsupported'?'该文件类型暂不能提取正文。':status==='no_text'?'没有可提取文字，扫描件或图片请先提供文字版。':'文件过大、受保护、损坏或解析超时，请提供 5MB 内的文字版。';
 await AgentAttachmentText.findOneAndUpdate(filter,{$set:{hash,status,text:result.text,reason,truncated:result.truncated}},{upsert:true,new:true});
 await getCustomerByIdOrThrow(customerId,actor);return {sourceId:`attachment:${id}:${hash.slice(0,12)}`,name:download.originalName,status,text:result.text,reason,truncated:result.truncated,hash};
}
export async function customerAttachmentEvidence(customerId:string,actor:AuthUser){
 await getCustomerByIdOrThrow(customerId,actor);const docs=await CustomerAttachment.find({projectId:requireProjectId(actor),customerId}).sort({createdAt:-1}).limit(3).select('_id originalName');
 const results=[];for(const doc of docs){try{results.push({id:doc.id,...await readAgentAttachment(customerId,doc.id,actor)});}catch{results.push({id:doc.id,sourceId:`attachment:${doc.id}:unavailable`,name:doc.originalName,status:'failed',text:'',reason:'附件已移除或无法读取。',truncated:false});}}
 return results;
}
