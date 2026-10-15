import {AgentTask} from '../../models/AgentTask';
import {ApiError} from '../../utils/ApiError';
// Reserve the maximum cost of the next call durably. Failed calls retain their charge;
// recovery can never accidentally replenish a task budget. Daily provider quota still applies.
export async function chargeTaskBudget(taskId:string|undefined,inputChars:number,maxOutputTokens:number){
 if(!taskId)return;const charge=Math.ceil(inputChars/4)+maxOutputTokens;
 const result=await AgentTask.updateOne({_id:taskId,status:'running',$expr:{$lte:[{$add:[{$ifNull:['$budgetCharged',0]},charge]},{$ifNull:['$tokenBudget',60000]}]}},{$inc:{budgetCharged:charge}});
 if(!result.matchedCount)throw new ApiError(429,'任务预算不足或任务已停止，请调整范围后新建任务。','RATE_LIMITED',[{field:'agent',message:'TASK_BUDGET_EXCEEDED'}]);
}
