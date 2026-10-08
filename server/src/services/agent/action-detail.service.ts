import { Types } from 'mongoose';
import { AgentAction, AgentRun } from '../../models';
import type { AuthUser } from '../../types/express';
import { requireProjectId } from '../../utils/access';
import { ApiError } from '../../utils/ApiError';
import { getCustomerAnalysis } from './customer-analysis.service';
import { getMailThreadAnalysis } from './mail-thread-analysis.service';
import { getScratchpadCustomerPreview } from './scratchpad-customer.service';

const customerTools = new Set(['analyze_customer_and_draft_email', 'edit_customer_analysis_draft', 'save_agent_email_draft', 'schedule_agent_followup']);
const mailTools = new Set(['analyze_mail_thread', 'edit_mail_thread_approval', 'save_mail_reply_draft', 'apply_mail_customer_status', 'save_mail_followup_record']);
const previewTools = new Set(['extract_scratchpad_customer', 'extract_mail_customer', 'update_scratchpad_customer_preview', 'create_customer_from_scratchpad', 'cancel_scratchpad_customer_preview']);

export async function getAgentActionDetail(id: string, actor: AuthUser) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('记录 ID 格式不正确');
  const identifiers = { projectId: requireProjectId(actor), userId: new Types.ObjectId(actor.id) };
  const action = await AgentAction.findOne({ _id: id, ...identifiers }).lean();
  if (!action) throw ApiError.notFound('运行记录不存在或无权访问');
  const run = action.runId ? await AgentRun.findOne({ _id: action.runId, ...identifiers }).lean() : null;
  let workflow: { kind: 'customer-analysis' | 'mail-analysis' | 'customer-preview'; id: string; context?: { type: 'customer' | 'mail'; resourceId: string; direction?: 'inbound' | 'outbound' } } | null = null;
  if (action.workflowId) {
    const workflowId = String(action.workflowId);
    try {
      // Reuse live resource permissions; a cached result must not bypass an owner transfer.
      if (customerTools.has(action.toolName)) {
        const analysis = await getCustomerAnalysis(workflowId, actor);
        workflow = { kind: 'customer-analysis', id: analysis.id, context: { type: 'customer', resourceId: analysis.customerId } };
      } else if (mailTools.has(action.toolName)) {
        const analysis = await getMailThreadAnalysis(workflowId, actor);
        workflow = { kind: 'mail-analysis', id: analysis.id, context: { type: 'mail', resourceId: analysis.rootMailId, direction: analysis.rootDirection } };
      } else if (previewTools.has(action.toolName)) {
        const preview = await getScratchpadCustomerPreview(workflowId, actor);
        workflow = { kind: 'customer-preview', id: preview.id };
      }
    } catch (error) {
      if (!(error instanceof ApiError) || ![403, 404].includes(error.statusCode)) throw error;
    }
  }
  // Only documented business references/counts, never arbitrary stored prompts or secrets.
  const inputs: Record<string, string | number | boolean | string[]> = {};
  for (const key of ['customerId', 'mailId', 'direction', 'sourceCount', 'messageCount', 'fields', 'status', 'previewId', 'analysisId', 'inputTruncated']) {
    const value = action.arguments?.[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') inputs[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) inputs[key] = value;
  }
  return {
    id: String(action._id), toolName: action.toolName, riskLevel: action.riskLevel,
    requiresApproval: action.requiresApproval, approvalStatus: action.approvalStatus,
    executionStatus: action.executionStatus, resultSummary: action.resultSummary,
    createdAt: action.createdAt, executedAt: action.executedAt, approvedAt: action.approvedAt, inputs,
    hasWorkflow: Boolean(action.workflowId), workflow,
    run: run ? { model: run.model, provider: run.provider, status: run.status, durationMs: run.durationMs,
      inputTokens: run.inputTokens, outputTokens: run.outputTokens, totalTokens: run.totalTokens, errorCode: run.errorCode } : null,
  };
}
