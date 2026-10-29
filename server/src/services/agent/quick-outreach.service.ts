import { Types } from 'mongoose';
import { Project } from '../../models';
import { AgentTask } from '../../models/AgentTask';
import type { AuthUser } from '../../types/express';
import { requireProjectId } from '../../utils/access';
import { getCustomerByIdOrThrow } from '../customer.service';
import { createAgentSession } from './agent.service';
import { createAgentTask, getAgentTask } from './task.service';
import { firstOutreachGoal, resolveProjectSalesProfile } from '../project-profile';

/**
 * 从客户详情页一键准备首封开发信草稿。
 * 与自动转客户 / 官网调查准备共用同一个任务工作流：
 * 任务只负责生成并保存 draft，永远不会自动发送。
 */
export async function createQuickFirstOutreachTask(
  customerId: string,
  requestKey: string,
  actor: AuthUser,
) {
  const customer = await getCustomerByIdOrThrow(customerId, actor);
  const projectId = requireProjectId(actor);
  const active = await AgentTask.findOne({
    projectId: new Types.ObjectId(projectId),
    userId: new Types.ObjectId(actor.id),
    customerId: new Types.ObjectId(customerId),
    kind: 'first_outreach',
    $or: [{ outreachStep: 1 }, { outreachStep: { $exists: false } }],
    status: { $in: ['queued', 'running', 'awaiting_review'] },
  }).sort({ createdAt: -1 });
  if (active) return getAgentTask(active.id, actor);

  const project = await Project.findById(projectId)
    .select('code slug name companyName industry website mailFrom senderName')
    .lean();
  const salesProfile = resolveProjectSalesProfile(project);
  const session = await createAgentSession({
    context: { type: 'customer', resourceId: customerId },
    title: `快捷首封 · ${customer.name}`,
  }, actor);
  return createAgentTask({
    sessionId: session.id,
    customerId,
    requestKey: `quick-first-outreach:${customerId}:${requestKey}`,
    goal: firstOutreachGoal(salesProfile),
    outreachStep: 1,
  }, actor);
}
