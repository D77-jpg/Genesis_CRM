import { ApiError } from '../../utils/ApiError';
import { AgentProviderError } from './provider';

export function agentFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  const marker = error instanceof ApiError ? error.details?.find(item => item.field === 'agent')?.message : undefined;
  const code = error instanceof AgentProviderError ? error.code : marker
    ?? (error instanceof ApiError ? error.code : (error as { name?: string })?.name === 'ZodError' ? 'OPENAI_INVALID_STRUCTURED_OUTPUT' : 'AGENT_RUNTIME_ERROR');
  if(code==='TASK_INPUT_CHANGED')return {code,message:'准备期间资料发生变化，旧结果未继续交付。点击重新准备会重读权限和最新依据，已保存的原稿保留。',retryable:true};
  if(code==='TASK_WORKFLOW_LIMIT')return {code,message:'任务处理次数或累计时限已用完，已保存结果保留，请缩小范围后新建任务。',retryable:false};
  if(code==='AUTOMATION_REVOKED')return {code,message:'事件规则、客户归属或跟进时间已变化，本任务已停止，请核对后重新发起。',retryable:false};
  if(code==='MARKETING_BLOCKED')return {code,message:'客户已退订、拒绝或退信，已阻断营销草稿；其余客户继续处理。',retryable:false};
  if (code === 'TASK_BUDGET_EXCEEDED') return {code,message:'本任务的模型预算已用完。已完成结果保留，请缩小资料范围后新建任务。',retryable:false};
  if (code === 'RATE_LIMITED') return { code, message: '本日 Agent 使用额度已达上限，请稍后或调整额度后继续。', retryable: false };
  if (['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'].includes(code)) return { code, message: '客户、会话或账号权限已变化，请重新选择有权访问的客户。', retryable: false };
  if (code === 'PAYLOAD_TOO_LARGE') return { code, message: '本次资料超过处理上限，请减少范围后重试。', retryable: false };
  if (/NOT_CONFIGURED/.test(code)) return { code, message: 'AI 模型尚未配置，请先由管理员完成配置。', retryable: false };
  if (/INCOMPLETE|INVALID_STRUCTURED|UNVERIFIED_SOURCES/.test(code)) return { code, message: '模型返回的内容不完整、格式不合规或依据不足，请重试；未执行未确认的业务操作。', retryable: true };
  if (/TIMEOUT|ABORT/.test(code)) return { code, message: '模型请求超时，可以稍后重试；已完成的任务步骤会保留。', retryable: true };
  if (code === 'CONFLICT') return {code,message:'草稿或业务记录状态已变化，请打开已有结果核对后重新发起任务。',retryable:false};
  if (code === 'VALIDATION_ERROR') return { code, message: '资料或建议未通过业务校验，请核对信息后继续。', retryable: false };
  return { code: code.slice(0, 80), message: 'Agent 暂时无法完成这一步，可以稍后重试；请查看任务中保留的已完成结果。', retryable: true };
}
