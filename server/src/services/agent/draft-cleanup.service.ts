import { Types } from 'mongoose';
import { Customer, DevelopmentLetter } from '../../models';
import { bulkDeleteLetters } from '../letter.service';
import { customerScope, requireProjectId } from '../../utils/access';
import type { AuthUser } from '../../types/express';
import type { OutreachStep } from '../project-profile';

const SENT_STATUSES = new Set(['sent', 'opened']);
const DRAFT_STATUS = 'draft';
const STEPS: OutreachStep[] = [1, 2, 3];

interface LetterLike {
  _id: Types.ObjectId;
  status?: string;
  outreachStep?: number;
  subject?: string;
  createdAt?: Date;
  updatedAt?: Date;
  sentAt?: Date;
  needsReview?: boolean;
  review?: { decision?: string };
}

export interface DraftCleanupItem {
  id: string;
  subject: string;
  step: OutreachStep;
  reason?: string;
}

export interface DraftCleanupPlan {
  customerId: string;
  name: string;
  draftCount: number;
  keepCount: number;
  removeCount: number;
  relabelCount: number;
  sentStepUpdates: number;
  keep: DraftCleanupItem[];
  remove: DraftCleanupItem[];
  skipReason?: string;
}

export interface DraftCleanupPreview {
  requested: number;
  customers: number;
  totalDrafts: number;
  kept: number;
  removed: number;
  relabeled: number;
  sentStepUpdates: number;
  plans: DraftCleanupPlan[];
}

export interface DraftCleanupResult extends DraftCleanupPreview {
  deleted: number;
  updated: number;
  failed: { customerId: string; message: string }[];
}

function stepOf(value: unknown): OutreachStep | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function timeOf(letter: LetterLike): number {
  const value = letter.sentAt ?? letter.createdAt ?? letter.updatedAt;
  return value ? new Date(value).getTime() : 0;
}

/**
 * Legacy records predate outreachStep. Sent records are numbered in sending
 * order; old drafts are treated as first-email drafts. This mirrors the
 * pre-three-step product behaviour and lets every remaining draft get a badge.
 */
function numberSentLetters(sent: LetterLike[]): Map<string, OutreachStep> {
  const result = new Map<string, OutreachStep>();
  const used = new Set<OutreachStep>();
  for (const letter of sent) {
    const step = stepOf(letter.outreachStep);
    if (step) {
      result.set(String(letter._id), step);
      used.add(step);
    }
  }
  let next: OutreachStep | undefined = 1;
  for (const letter of sent) {
    if (result.has(String(letter._id))) continue;
    while (next && used.has(next)) next = STEPS.find((step) => !used.has(step));
    if (!next) break;
    result.set(String(letter._id), next);
    used.add(next);
    next = STEPS.find((step) => !used.has(step));
  }
  return result;
}

function planForCustomer(
  customer: { _id: Types.ObjectId; name?: string },
  letters: LetterLike[],
): DraftCleanupPlan {
  const sent = letters.filter((letter) => SENT_STATUSES.has(String(letter.status))).sort((a, b) => timeOf(a) - timeOf(b));
  const drafts = letters
    .filter((letter) => String(letter.status) === DRAFT_STATUS)
    .sort((a, b) => timeOf(b) - timeOf(a));
  const sentSteps = numberSentLetters(sent);
  const sentStepsSet = new Set(sentSteps.values());
  const sentUpdates = sent.filter((letter) => !stepOf(letter.outreachStep) && sentSteps.has(String(letter._id))).length;

  const groups = new Map<OutreachStep, LetterLike[]>();
  for (const draft of drafts) {
    // All old drafts without a step are first-email drafts. Explicit steps
    // from the three-step flow are trusted as-is.
    const step = stepOf(draft.outreachStep) ?? 1;
    const group = groups.get(step) ?? [];
    group.push(draft);
    groups.set(step, group);
  }

  const keep: DraftCleanupItem[] = [];
  const remove: DraftCleanupItem[] = [];
  for (const [step, group] of groups) {
    if (sentStepsSet.has(step)) {
      for (const draft of group) {
        if (draft.needsReview) {
          keep.push({
            id: String(draft._id),
            subject: draft.subject || '（无主题）',
            step,
            reason: '待核实草稿，暂不删除',
          });
        } else {
          remove.push({
            id: String(draft._id),
            subject: draft.subject || '（无主题）',
            step,
            reason: `第 ${step} 封已发送，删除重复草稿`,
          });
        }
      }
      continue;
    }

    // Prefer a reviewed draft, then the most recently updated one. This keeps
    // the version the user already checked instead of an older retry.
    const sorted = [...group].sort((a, b) => {
      const aApproved = a.review?.decision === 'approved' ? 1 : 0;
      const bApproved = b.review?.decision === 'approved' ? 1 : 0;
      if (aApproved !== bApproved) return bApproved - aApproved;
      return timeOf(b) - timeOf(a);
    });
    const keeper = sorted[0];
    if (keeper) {
      keep.push({
        id: String(keeper._id),
        subject: keeper.subject || '（无主题）',
        step,
        reason: group.length > 1 ? '保留这一封，其余为重复草稿' : undefined,
      });
    }
    for (const draft of sorted.slice(1)) {
      if (draft.needsReview) {
        keep.push({
          id: String(draft._id),
          subject: draft.subject || '（无主题）',
          step,
          reason: '待核实草稿，暂不删除',
        });
      } else {
        remove.push({
          id: String(draft._id),
          subject: draft.subject || '（无主题）',
          step,
          reason: `第 ${step} 封重复草稿`,
        });
      }
    }
  }

  const relabelCount = keep.filter((item) => {
    const source = drafts.find((draft) => String(draft._id) === item.id);
    return source && !stepOf(source.outreachStep);
  }).length;
  const skipReason = drafts.length === 0 && sentUpdates === 0 ? '没有需要整理的草稿' : undefined;

  return {
    customerId: String(customer._id),
    name: customer.name || '未命名客户',
    draftCount: drafts.length,
    keepCount: keep.length,
    removeCount: remove.length,
    relabelCount,
    sentStepUpdates: sentUpdates,
    keep,
    remove,
    skipReason,
  };
}

async function loadPlans(actor: AuthUser, ids: string[]): Promise<DraftCleanupPlan[]> {
  const projectId = requireProjectId(actor);
  const uniqueIds = [...new Set(ids)];
  const objectIds = uniqueIds.map((id) => new Types.ObjectId(id));
  const customers = await Customer.find({ _id: { $in: objectIds }, ...customerScope(actor) })
    .select({ _id: 1, name: 1 })
    .lean();
  const found = new Map(customers.map((customer) => [String(customer._id), customer]));
  const letters = await DevelopmentLetter.find({
    projectId,
    customerId: { $in: customers.map((customer) => customer._id) },
    status: { $in: [...SENT_STATUSES, DRAFT_STATUS] },
  })
    .select({ _id: 1, customerId: 1, status: 1, outreachStep: 1, subject: 1, createdAt: 1, updatedAt: 1, sentAt: 1, needsReview: 1, review: 1 })
    .lean();

  const byCustomer = new Map<string, LetterLike[]>();
  for (const letter of letters as unknown as (LetterLike & { customerId: Types.ObjectId })[]) {
    const key = String(letter.customerId);
    const list = byCustomer.get(key) ?? [];
    list.push(letter);
    byCustomer.set(key, list);
  }

  return uniqueIds
    .map((id) => found.get(id))
    .filter((customer): customer is NonNullable<typeof customer> => Boolean(customer))
    .map((customer) => planForCustomer(customer, byCustomer.get(String(customer._id)) ?? []));
}

function summarize(plans: DraftCleanupPlan[], requested: number): DraftCleanupPreview {
  return {
    requested,
    customers: plans.length,
    totalDrafts: plans.reduce((sum, plan) => sum + plan.draftCount, 0),
    kept: plans.reduce((sum, plan) => sum + plan.keepCount, 0),
    removed: plans.reduce((sum, plan) => sum + plan.removeCount, 0),
    relabeled: plans.reduce((sum, plan) => sum + plan.relabelCount, 0),
    sentStepUpdates: plans.reduce((sum, plan) => sum + plan.sentStepUpdates, 0),
    plans,
  };
}

export async function previewDraftCleanup(actor: AuthUser, ids: string[]): Promise<DraftCleanupPreview> {
  if (ids.length === 0) return summarize([], 0);
  return summarize(await loadPlans(actor, ids), new Set(ids).size);
}

/**
 * Apply the cleanup plan: remove duplicate drafts and fill missing step
 * numbers on kept drafts / sent records. Sent records themselves are never
 * deleted or modified beyond the missing step label.
 */
export async function applyDraftCleanup(actor: AuthUser, ids: string[]): Promise<DraftCleanupResult> {
  const plans = await loadPlans(actor, ids);
  const projectId = requireProjectId(actor);
  const keepSteps = new Map<OutreachStep, Types.ObjectId[]>();
  const sentSteps = new Map<OutreachStep, Types.ObjectId[]>();
  const removeIds: string[] = [];
  const failed: { customerId: string; message: string }[] = [];

  for (const plan of plans) {
    for (const item of plan.keep) {
      const source = item as DraftCleanupItem & { step: OutreachStep };
      const list = keepSteps.get(source.step) ?? [];
      list.push(new Types.ObjectId(source.id));
      keepSteps.set(source.step, list);
    }
    for (const item of plan.remove) removeIds.push(item.id);
  }

  // Re-query sent records to find the missing labels (the preview plan does
  // not expose sent IDs to the client; keep this update server-side only).
  const sentLetters = await DevelopmentLetter.find({
    projectId,
    customerId: { $in: plans.map((plan) => new Types.ObjectId(plan.customerId)) },
    status: { $in: [...SENT_STATUSES] },
  })
    .select({ _id: 1, customerId: 1, status: 1, outreachStep: 1, createdAt: 1, sentAt: 1, updatedAt: 1 })
    .lean();
  const byCustomer = new Map<string, LetterLike[]>();
  for (const letter of sentLetters as unknown as (LetterLike & { customerId: Types.ObjectId })[]) {
    const key = String(letter.customerId);
    const list = byCustomer.get(key) ?? [];
    list.push(letter);
    byCustomer.set(key, list);
  }
  for (const plan of plans) {
    const numbered = numberSentLetters((byCustomer.get(plan.customerId) ?? []).sort((a, b) => timeOf(a) - timeOf(b)));
    for (const [id, step] of numbered) {
      const list = sentSteps.get(step) ?? [];
      list.push(new Types.ObjectId(id));
      sentSteps.set(step, list);
    }
  }

  let updated = 0;
  for (const [step, stepIds] of [...keepSteps, ...sentSteps]) {
    if (stepIds.length === 0) continue;
    const result = await DevelopmentLetter.updateMany(
      { _id: { $in: stepIds }, projectId, outreachStep: null },
      { $set: { outreachStep: step } },
    );
    updated += result.modifiedCount ?? 0;
  }

  let deleted = 0;
  if (removeIds.length > 0) {
    try {
      const result = await bulkDeleteLetters(removeIds, actor);
      deleted = result.deleted;
    } catch (error) {
      failed.push({ customerId: '', message: error instanceof Error ? error.message : '删除重复草稿失败' });
    }
  }

  return {
    ...summarize(plans, new Set(ids).size),
    deleted,
    updated,
    failed,
  };
}
