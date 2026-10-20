import {createHash} from 'node:crypto';
import {AgentTask,type AgentTaskDocument} from '../../models/AgentTask';
import {ApiError} from '../../utils/ApiError';
export const workflowLabels:Record<string,string>={research_customer:'分析客户官网与经营线索',read_context:'读取授权往来',extract_requirements:'整理需求与已知信息',load_rules:'读取项目销售规则',retrieve_0:'检索业务依据',retrieve_1:'补查未回答问题',retrieve_2:'补查剩余依据',assess_evidence:'核对适用条件与缺口',generate_email:'生成邮件草稿',audit_claims:'逐项核对事实',handoff:'交给业务员审核'};
export const workflowHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface EvidenceWorkflow {epoch:number;check:()=>Promise<unknown>;run<T>(key:string,input:unknown,action:()=>Promise<T>,options?:{cache?:boolean;tool?:string}):Promise<T>}
export async function workflowStage<T>(workflow:EvidenceWorkflow|undefined,key:string,input:unknown,action:()=>Promise<T>,options?:{cache?:boolean;tool?:string}){return workflow?workflow.run(key,input,action,options):action();}
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
export function taskEvidenceWorkflow(task:AgentTaskDocument,token:string,check:()=>Promise<unknown>):EvidenceWorkflow{
 const epoch=task.workflowEpoch??0;const fence={_id:task._id,status:'running',leaseToken:token};
 return {epoch,check,async run<T>(key:string,input:unknown,action:()=>Promise<T>,options?:{cache?:boolean;tool?:string}){
  if(!workflowLabels[key])throw Error('UNKNOWN_WORKFLOW_STAGE');await check();const inputHash=workflowHash(input);
  const current=await AgentTask.findOne(fence);if(!current)throw Error('TASK_INTERRUPTED');
  const records=clone(current.workflowRecords??[]);let record=records.find(r=>r.epoch===epoch&&r.key===key);
  if(options?.cache&&record?.state==='completed'&&record.inputHash===inputHash&&record.payload!==undefined){
   record.reused++;const saved=await AgentTask.updateOne(fence,{$set:{workflowRecords:records},$inc:{version:1}});if(!saved.matchedCount)throw Error('TASK_INTERRUPTED');return clone(record.payload) as T;
  }
  // Bound all external work, including failed or interrupted attempts. Budgets never reset on retry.
  if((current.workflowCalls??0)>=30||(current.workflowActiveMs??0)>=600000)throw new ApiError(429,'任务处理已达上限，请缩小范围后新建任务','RATE_LIMITED',[{field:'agent',message:'TASK_WORKFLOW_LIMIT'}]);
  const attempts=(record?.attempts??0)+1;if(attempts>5)throw new ApiError(429,'该步骤已达重试上限','RATE_LIMITED',[{field:'agent',message:'TASK_WORKFLOW_LIMIT'}]);
  if(!record){if(records.length>=60)throw ApiError.conflict('任务检查点过多，请新建任务');record={key,epoch,inputHash,state:'running',startedAt:new Date().toISOString(),attempts,reused:0};records.push(record);}
  Object.assign(record,{inputHash,state:'running',startedAt:new Date().toISOString(),attempts,payload:undefined,tool:options?.tool,error:undefined});
  const reservationMs=options?.tool==='model'?120000:1000;
  const reserved=await AgentTask.updateOne(fence,{$set:{workflowRecords:records},$inc:{version:1,workflowCalls:1,workflowActiveMs:reservationMs}});if(!reserved.matchedCount)throw Error('TASK_INTERRUPTED');
  // Keep the full reservation if the process or lease is lost. A finished attempt
  // settles once against its exact running checkpoint; retries never reset totals.
  const settlementFence={...fence,workflowRecords:{$elemMatch:{key,epoch,inputHash,state:'running',attempts,startedAt:record.startedAt}}};
  const start=performance.now();const elapsed=()=>Math.max(1,Math.ceil(performance.now()-start));try{
   const result=await action();await check();const serialized=JSON.stringify(result);if(serialized.length>160000)throw new ApiError(413,'步骤证据超过单次保留范围，请缩小资料','PAYLOAD_TOO_LARGE');
   Object.assign(record,{state:'completed',completedAt:new Date().toISOString(),durationMs:elapsed(),payload:clone(result)});
   const saved=await AgentTask.updateOne(settlementFence,{$set:{workflowRecords:records},$inc:{version:1,workflowActiveMs:record.durationMs!-reservationMs}});if(!saved.matchedCount)throw Error('TASK_INTERRUPTED');return result;
  }catch(error){record.state='failed';record.durationMs=elapsed();record.error='步骤未完成，结果未交付';delete record.payload;await AgentTask.updateOne(settlementFence,{$set:{workflowRecords:records},$inc:{version:1,workflowActiveMs:record.durationMs-reservationMs}});throw error;}
 }};
}
