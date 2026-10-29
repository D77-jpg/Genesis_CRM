import { Types } from 'mongoose';
import { Customer, DevelopmentLetter, Project } from '../../models';
import { AgentTask } from '../../models/AgentTask';
import { requireProjectId, customerScope } from '../../utils/access';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../types/express';
import { createAgentSession } from './agent.service';
import { createAgentTask } from './task.service';
import { outreachStepGoal, resolveProjectSalesProfile, type OutreachStep } from '../project-profile';

const SENT_STATUSES = new Set(['sent', 'opened']);
const OCCUPIED_LETTER_STATUSES = new Set(['draft', 'queued', 'scheduled', 'sending', 'retrying']);
const CANCELLED_TASK_STATUS = 'cancelled';
const BACKFILL_STATUSES = new Set(['pending', 'contacted']);
const STEPS: OutreachStep[] = [1, 2, 3];

export interface OutreachSequencePlan {
  customerId: string;
  name: string;
  status: string;
  email?: string;
  sentCount: number;
  draftSteps: number[];
  missingSteps: OutreachStep[];
  skipReason?: string;
}

export interface OutreachSequencePreview {
  requested: number;
  eligible: number;
  skipped: number;
  totalDrafts: number;
  plans: OutreachSequencePlan[];
}

export interface OutreachSequenceCreated {
  customerId: string;
  step: OutreachStep;
  taskId: string;
}

export interface OutreachSequenceResult extends OutreachSequencePreview {
  created: OutreachSequenceCreated[];
  failed: { customerId: string; step: OutreachStep; message: string }[];
}

function stepOf(value: unknown): OutreachStep | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

/**
 * Work out which sequence steps are genuinely missing from a legacy customer.
 *
 * Old letters predate `outreachStep`, so a sent letter without that field is
 * treated as progress by count. Any old draft is treated as an existing first
 * draft; this avoids generating a duplicate first email just because the old
 * record cannot identify its step.
 */
function planForCustomer(
  customer: { _id: Types.ObjectId; name?: string; status?: string; email?: string },
  letters: { status?: string; outreachStep?: number }[],
  activeTasks: { outreachStep?: number; status?: string }[],
): OutreachSequencePlan {
  const customerId = String(customer._id);
  const sent = letters.filter((letter) => SENT_STATUSES.has(String(letter.status)));
  const drafts = letters.filter((letter) => OCCUPIED_LETTER_STATUSES.has(String(letter.status)));
  const sentSteps = new Set<number>();
  const draftSteps = new Set<number>();
  for (const letter of sent) {
    const step = stepOf(letter.outreachStep);
    if (step) sentSteps.add(step);
  }
  for (const letter of drafts) {
    const step = stepOf(letter.outreachStep);
    if (step) draftSteps.add(step);
  }

  // Legacy sent letters may not have a step. Count them as 1..N; when a
  // customer has explicit steps, trust the highest explicit step as progress.
  const progress = Math.min(3, Math.max(sent.length, ...sentSteps));
  const occupied = new Set<number>();
  for (let step = 1; step <= progress; step += 1) occupied.add(step);
  for (const step of sentSteps) occupied.add(step);
  for (const step of draftSteps) occupied.add(step);
  // No step on an old draft: it is nearly always a first-email draft.
  if (drafts.some((letter) => !stepOf(letter.outreachStep)) && sent.length === 0) occupied.add(1);

  for (const task of activeTasks) {
    const step = stepOf(task.outreachStep);
    if (step) occupied.add(step);
  }

  const missingSteps = STEPS.filter((step) => !occupied.has(step));
  const taskSteps = activeTasks
    .map((task) => stepOf(task.outreachStep))
    .filter((step): step is OutreachStep => Boolean(step));
  let skipReason: string | undefined;
  if (!customer.email) {
    skipReason = '缺少收件邮箱';
  } else if (!BACKFILL_STATUSES.has(String(customer.status))) {
    skipReason = '客户已进入回复/成交/流失阶段，不再补开发信';
  } else if (missingSteps.length === 0) {
    skipReason = '三封开发信步骤已齐全';
  } else if (taskSteps.length > 0) {
    skipReason = `已有第 ${taskSteps.join('、')} 封任务，请先到任务里处理`;
  }

  return {
    customerId,
    name: customer.name?.trim() || '未命名客户',
    status: String(customer.status ?? ''),
    email: customer.email,
    sentCount: sent.length,
    draftSteps: [...draftSteps].sort(),
    missingSteps: skipReason ? [] : missingSteps,
    skipReason,
  };
}

async function loadPlans(actor: AuthUser, ids: string[]) {
  const projectId = requireProjectId(actor);
  const uniqueIds = [...new Set(ids)];
  const objectIds = uniqueIds.map((id) => {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('客户 ID 格式不正确');
    return new Types.ObjectId(id);
  });
  const customers = await Customer.find({
    _id: { $in: objectIds },
    ...customerScope(actor),
  })
    .select('name status email')
    .lean();
  const found = new Map(customers.map((customer) => [String(customer._id), customer]));
  if (found.size === 0) throw ApiError.notFound('所选客户不存在或无权访问');

  const [letters, tasks] = await Promise.all([
    DevelopmentLetter.find({
      projectId,
      customerId: { $in: customers.map((customer) => customer._id) },
    })
      .select('customerId status outreachStep')
      .lean(),
    AgentTask.find({
      projectId,
      customerId: { $in: customers.map((customer) => customer._id) },
      outreachStep: { $in: STEPS },
      status: { $ne: CANCELLED_TASK_STATUS },
    })
      .select('customerId outreachStep status')
      .lean(),
  ]);

  const lettersByCustomer = new Map<string, typeof letters>();
  for (const letter of letters) {
    const key = String(letter.customerId);
    const rows = lettersByCustomer.get(key) ?? [];
    rows.push(letter);
    lettersByCustomer.set(key, rows);
  }
  const tasksByCustomer = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const key = String(task.customerId);
    const rows = tasksByCustomer.get(key) ?? [];
    rows.push(task);
    tasksByCustomer.set(key, rows);
  }

  return uniqueIds
    .map((id) => found.get(id))
    .filter((customer): customer is NonNullable<typeof customer> => Boolean(customer))
    .map((customer) =>
      planForCustomer(
        customer,
        lettersByCustomer.get(String(customer._id)) ?? [],
        tasksByCustomer.get(String(customer._id)) ?? [],
      ),
    );
}

/** Preview what a batch backfill would create, without touching the queue. */
export async function previewOutreachSequence(actor: AuthUser, ids: string[]): Promise<OutreachSequencePreview> {
  const plans = await loadPlans(actor, ids);
  const eligiblePlans = plans.filter((plan) => !plan.skipReason);
  return {
    requested: new Set(ids).size,
    eligible: eligiblePlans.length,
    skipped: plans.length - eligiblePlans.length,
    totalDrafts: eligiblePlans.reduce((total, plan) => total + plan.missingSteps.length, 0),
    plans,
  };
}

/**
 * Queue only the missing steps. Every task goes through the same draft-only
 * agent workflow as a newly converted prospect; nothing is sent automatically.
 */
export async function queueOutreachSequence(actor: AuthUser, ids: string[]): Promise<OutreachSequenceResult> {
  const preview = await previewOutreachSequence(actor, ids);
  const eligiblePlans = preview.plans.filter((plan) => !plan.skipReason);
  const created: OutreachSequenceCreated[] = [];
  const failed: OutreachSequenceResult['failed'] = [];
  if (eligiblePlans.length === 0) return { ...preview, created, failed };

  const project = await Project.findById(requireProjectId(actor))
    .select('code slug name companyName industry website mailFrom senderName')
    .lean();
  const salesProfile = resolveProjectSalesProfile(project);

  for (const plan of eligiblePlans) {
    try {
      const session = await createAgentSession({
        context: { type: 'customer', resourceId: plan.customerId },
        title: `补齐开发信 · ${plan.name} · 三封`,
      }, actor);
      for (const step of plan.missingSteps) {
        try {
          const task = await createAgentTask({
            sessionId: session.id,
            goal: outreachStepGoal(salesProfile, step),
            requestKey: `sequence-backfill:${plan.customerId}:step${step}`,
            customerId: plan.customerId,
            outreachStep: step,
          }, actor);
          created.push({ customerId: plan.customerId, step, taskId: task.id });
        } catch (error) {
          failed.push({
            customerId: plan.customerId,
            step,
            message: error instanceof Error ? error.message : '任务创建失败',
          });
        }
      }
    } catch (error) {
      for (const step of plan.missingSteps) {
        failed.push({
          customerId: plan.customerId,
          step,
          message: error instanceof Error ? error.message : '任务创建失败',
        });
      }
    }
  }

  return {
    ...preview,
    eligible: eligiblePlans.length,
    totalDrafts: created.length,
    created,
    failed,
  };
}
