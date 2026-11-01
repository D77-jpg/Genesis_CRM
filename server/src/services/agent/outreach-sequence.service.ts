import { randomUUID } from 'node:crypto';
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
const IN_PROGRESS_TASK_STATUSES = new Set(['queued', 'running', 'waiting_input', 'paused']);
const CANCELLED_TASK_STATUS = 'cancelled';
const BACKFILL_STATUSES = new Set(['pending', 'contacted']);
const STEPS: OutreachStep[] = [1, 2, 3];

type SequenceLetter = { _id: Types.ObjectId; status?: string; outreachStep?: number };
type SequenceTask = { _id: Types.ObjectId; draftId?: Types.ObjectId; status?: string; outreachStep?: number; error?: { message?: string } };

export interface OutreachSequencePlan {
  customerId: string;
  name: string;
  status: string;
  email?: string;
  sentCount: number;
  draftSteps: number[];
  missingSteps: OutreachStep[];
  skipReason?: string;
  lastError?: string;
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
export function planForCustomer(
  customer: { _id: Types.ObjectId; name?: string; status?: string; email?: string },
  letters: SequenceLetter[],
  activeTasks: SequenceTask[],
): OutreachSequencePlan {
  const customerId = String(customer._id);
  const liveDraftIds = new Set(letters.map((letter) => String(letter._id)));
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

  // A failed task is retryable and must not freeze the step forever. An
  // awaiting-review task only owns its step while the linked draft still
  // exists; deleting that draft is an explicit request to prepare it again.
  // Occupied steps are excluded above; other missing steps remain eligible
  // even when a different step already has a live draft/task (for example,
  // the first draft was deleted while drafts 2 and 3 remain).
  for (const task of activeTasks) {
    const step = stepOf(task.outreachStep);
    if (!step) continue;
    const status = String(task.status ?? '');
    const hasLiveDraft = Boolean(task.draftId && liveDraftIds.has(String(task.draftId)));
    if (IN_PROGRESS_TASK_STATUSES.has(status) || hasLiveDraft) occupied.add(step);
  }

  const missingSteps = STEPS.filter((step) => !occupied.has(step));
  let skipReason: string | undefined;
  if (!customer.email) {
    skipReason = '缺少收件邮箱';
  } else if (!BACKFILL_STATUSES.has(String(customer.status))) {
    skipReason = '客户已进入回复/成交/流失阶段，不再补开发信';
  } else if (missingSteps.length === 0) {
    skipReason = '三封开发信步骤已齐全';
  }
  const failedTask = activeTasks.find((task) => {
    const step = stepOf(task.outreachStep);
    if (!step || String(task.status ?? '') !== 'failed' || !task.error?.message) return false;
    return !occupied.has(step);
  });

  return {
    customerId,
    name: customer.name?.trim() || '未命名客户',
    status: String(customer.status ?? ''),
    email: customer.email,
    sentCount: sent.length,
    draftSteps: [...draftSteps].sort(),
    missingSteps: skipReason ? [] : missingSteps,
    skipReason,
    lastError: failedTask?.error?.message,
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
      .select('_id customerId status outreachStep')
      .lean(),
    AgentTask.find({
      projectId,
      userId: new Types.ObjectId(actor.id),
      customerId: { $in: customers.map((customer) => customer._id) },
      outreachStep: { $in: STEPS },
      status: { $ne: CANCELLED_TASK_STATUS },
    })
      .select('_id draftId customerId outreachStep status error')
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
 * A draft deleted from the review list leaves its old task behind. Cancel only
 * those terminal tasks; queued/running tasks are never touched here.
 */
async function cancelStaleSequenceTasks(projectId: Types.ObjectId, userId: Types.ObjectId, plan: OutreachSequencePlan) {
  const tasks = await AgentTask.find({
    projectId,
    userId,
    customerId: new Types.ObjectId(plan.customerId),
    outreachStep: { $in: plan.missingSteps },
    status: { $in: ['awaiting_review', 'completed', 'failed'] },
  })
    .select('_id draftId status')
    .lean();
  if (tasks.length === 0) return;

  const draftIds = tasks
    .map((task) => task.draftId)
    .filter((id): id is Types.ObjectId => Boolean(id));
  const liveDrafts = draftIds.length
    ? await DevelopmentLetter.find({
        _id: { $in: draftIds },
        projectId,
        status: { $in: [...OCCUPIED_LETTER_STATUSES] },
      })
        .select('_id')
        .lean()
    : [];
  const liveIds = new Set(liveDrafts.map((letter) => String(letter._id)));
  const staleIds = tasks
    .filter((task) => !task.draftId || !liveIds.has(String(task.draftId)))
    .map((task) => task._id);
  if (staleIds.length === 0) return;

  await AgentTask.updateMany(
    { _id: { $in: staleIds }, projectId, userId, status: { $in: ['awaiting_review', 'completed', 'failed'] } },
    {
      $set: { status: 'cancelled' },
      $push: {
        events: {
          $each: [{ at: new Date(), message: '原草稿已删除，旧任务已取消；补齐将重新生成。' }],
          $slice: -100,
        },
      },
    },
  );
}

async function requestKeyForStep(projectId: Types.ObjectId, customerId: string, step: OutreachStep) {
  const base = `sequence-backfill:${customerId}:step${step}`;
  const existing = await AgentTask.exists({ projectId, customerId: new Types.ObjectId(customerId), requestKey: base });
  return existing ? `${base}:retry-${randomUUID()}` : base;
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

  const projectId = requireProjectId(actor);
  const project = await Project.findById(projectId)
    .select('code slug name companyName industry website mailFrom senderName')
    .lean();
  const salesProfile = resolveProjectSalesProfile(project);

  for (const plan of eligiblePlans) {
    try {
      await cancelStaleSequenceTasks(projectId, new Types.ObjectId(actor.id), plan);
      const session = await createAgentSession({
        context: { type: 'customer', resourceId: plan.customerId },
        title: `补齐开发信 · ${plan.name} · 三封`,
      }, actor);
      for (const step of plan.missingSteps) {
        try {
          const task = await createAgentTask({
            sessionId: session.id,
            goal: outreachStepGoal(salesProfile, step),
            requestKey: await requestKeyForStep(projectId, plan.customerId, step),
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
