/**
 * Integration API v1 业务服务
 * ------------------------------------------------------------------
 * customers/upsert  按 (projectId, sourceSystem, externalId) 幂等创建/关联客户
 * outcomes          游标式增量读取成交/流失事件（来自 CustomerEvent 状态变更）
 * stats/overview    项目级客户/漏斗/报价摘要
 * 客户状态/报价只读  阶段 5.2 Agent Tool 预留
 *
 * 更新边界：首次交接创建或关联；后续自动同步只补齐空字段，
 * 不覆盖销售人工维护的字段（负责人、阶段、跟进、报价、备注）。
 */
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import {
  CUSTOMER_STATUS,
  INTEGRATION_CONTRACT_VERSION,
  OUTCOME_STATUSES,
  QUOTATION_STATUS,
  type CustomerStatus,
} from '../constants';
import { ApiError } from '../utils/ApiError';
import {
  Customer,
  CustomerEvent,
  IntegrationIdempotency,
  Quotation,
  type CustomerDocument,
} from '../models';
import type { UpsertCustomerBody } from '../validators/integration.validator';

/* ------------------------------- customers/upsert ------------------------------- */

export interface UpsertResult {
  action: 'created' | 'linked' | 'unchanged';
  customerId: string;
  projectId: string;
  externalId: string;
  remoteUpdatedAt: string;
}

export function hashUpsertPayload(body: UpsertCustomerBody): string {
  // 稳定序列化：键排序，保证同载荷同哈希
  const stable = JSON.stringify(body, Object.keys(body).sort());
  return createHash('sha256').update(stable).digest('hex');
}

/** 自动同步只补齐这些「空字段」；人工维护字段（status/ownerId/notes 等）不在列 */
const FILLABLE_FIELDS = [
  'name',
  'company',
  'email',
  'phone',
  'country',
  'interestedProducts',
  'leadSource',
  'productModel',
  'productCategory',
  'expectedQuantity',
  'targetPrice',
  'moq',
  'requirementNotes',
] as const;

function fillEmptyFields(customer: CustomerDocument, body: UpsertCustomerBody): void {
  for (const field of FILLABLE_FIELDS) {
    const incoming = body[field as keyof UpsertCustomerBody];
    if (typeof incoming !== 'string' || incoming === '') continue;
    const current = customer.get(field);
    if (current === undefined || current === null || current === '') {
      customer.set(field, incoming);
    }
  }
  if (Array.isArray(body.tags) && body.tags.length > 0) {
    const merged = new Set([...(customer.tags ?? []), ...body.tags]);
    customer.tags = [...merged].slice(0, 30);
  }
}

function toUpsertResult(
  action: UpsertResult['action'],
  customer: CustomerDocument,
  externalId: string,
): UpsertResult {
  return {
    action,
    customerId: String(customer._id),
    projectId: String(customer.projectId),
    externalId,
    remoteUpdatedAt: customer.updatedAt.toISOString(),
  };
}

async function findByExternalRef(
  projectId: string,
  sourceSystem: string,
  externalId: string,
): Promise<CustomerDocument | null> {
  return Customer.findOne({ projectId, externalSystem: sourceSystem, externalId });
}

/**
 * 幂等 upsert：
 *  1. 请求级幂等（Idempotency-Key）：同键同载荷重放首次响应；同键不同载荷 409。
 *  2. 业务级幂等（externalRef）：已关联 → 补齐空字段，返回 unchanged；
 *     未关联但同项目邮箱存在 → 建立引用，返回 linked；否则创建，返回 created。
 */
export async function upsertCustomer(input: {
  credentialId: string;
  projectId: string;
  idempotencyKey: string;
  body: UpsertCustomerBody;
}): Promise<{ result: UpsertResult; statusCode: number }> {
  const { credentialId, projectId, idempotencyKey, body } = input;

  if (body.schemaVersion !== INTEGRATION_CONTRACT_VERSION) {
    throw ApiError.unsupportedContractVersion(body.schemaVersion);
  }

  /* ---- 1. 请求级幂等 ---- */
  const requestHash = hashUpsertPayload(body);
  const existingKey = await IntegrationIdempotency.findOne({ credentialId, key: idempotencyKey });
  if (existingKey) {
    if (existingKey.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key 已被不同载荷使用');
    }
    return {
      result: existingKey.response as unknown as UpsertResult,
      statusCode: existingKey.statusCode,
    };
  }

  /* ---- 2. 业务级幂等 ---- */
  let statusCode = 200;
  let result: UpsertResult;

  const linked = await findByExternalRef(projectId, body.sourceSystem, body.externalId);
  if (linked) {
    // 已关联：只补齐空字段，不覆盖人工维护字段
    fillEmptyFields(linked, body);
    if (linked.isModified()) await linked.save();
    result = toUpsertResult('unchanged', linked, body.externalId);
  } else {
    // 未关联：邮箱辅助判重（仅同项目）
    let customer: CustomerDocument | null = null;
    if (body.email) {
      customer = await Customer.findOne({ projectId, email: body.email });
    }

    if (customer) {
      // 关联已有客户：建立外部引用 + 补齐空字段
      customer.externalSystem = body.sourceSystem;
      customer.externalId = body.externalId;
      fillEmptyFields(customer, body);
      await customer.save();
      result = toUpsertResult('linked', customer, body.externalId);
    } else {
      // 创建新客户
      const fallbackName = body.name || body.company || `未命名询盘 ${body.externalId}`;
      try {
        customer = await Customer.create({
          projectId: new Types.ObjectId(projectId),
          name: fallbackName,
          company: body.company,
          email: body.email,
          phone: body.phone,
          country: body.country,
          interestedProducts: body.interestedProducts,
          leadSource: body.leadSource,
          productModel: body.productModel,
          productCategory: body.productCategory,
          expectedQuantity: body.expectedQuantity,
          targetPrice: body.targetPrice,
          moq: body.moq,
          requirementNotes: body.requirementNotes,
          tags: body.tags ?? [],
          status: (body.initialStatus ?? 'pending') as CustomerStatus,
          source: 'integration',
          externalSystem: body.sourceSystem,
          externalId: body.externalId,
        });
      } catch (error) {
        // 并发双写兜底：唯一索引冲突时按「已关联」路径收敛，保证 10 次并发只产生 1 个客户
        if ((error as { code?: number })?.code === 11000) {
          const winner = await findByExternalRef(projectId, body.sourceSystem, body.externalId);
          if (winner) {
            result = toUpsertResult('unchanged', winner, body.externalId);
            await persistIdempotency(credentialId, projectId, idempotencyKey, requestHash, result, 200);
            return { result, statusCode: 200 };
          }
        }
        throw error;
      }
      statusCode = 201;
      result = toUpsertResult('created', customer, body.externalId);
    }
  }

  await persistIdempotency(credentialId, projectId, idempotencyKey, requestHash, result, statusCode);
  return { result, statusCode };
}

async function persistIdempotency(
  credentialId: string,
  projectId: string,
  key: string,
  requestHash: string,
  result: UpsertResult,
  statusCode: number,
): Promise<void> {
  try {
    await IntegrationIdempotency.create({
      credentialId: new Types.ObjectId(credentialId),
      projectId: new Types.ObjectId(projectId),
      key,
      requestHash,
      response: result as unknown as Record<string, unknown>,
      statusCode,
    });
  } catch (error) {
    // 并发下两个相同 key 同时落库：忽略唯一索引冲突（先到先得，重放由下次请求完成）
    if ((error as { code?: number })?.code !== 11000) throw error;
  }
}

/* ------------------------------- outcomes 游标事件 ------------------------------- */

interface OutcomeCursor {
  at: string;
  id: string;
}

function encodeCursor(cursor: OutcomeCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): OutcomeCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OutcomeCursor;
    if (typeof parsed.at !== 'string' || typeof parsed.id !== 'string' || !Types.ObjectId.isValid(parsed.id)) {
      throw new Error('bad cursor');
    }
    if (Number.isNaN(Date.parse(parsed.at))) throw new Error('bad cursor');
    return parsed;
  } catch {
    throw ApiError.badRequest('非法的 outcome cursor');
  }
}

export interface OutcomeItem {
  eventId: string;
  cursor: string;
  customerId: string;
  externalId: string | null;
  fromStatus: string | null;
  toStatus: string;
  occurredAt: string;
}

export async function listOutcomes(input: {
  projectId: string;
  cursor?: string;
  limit: number;
}): Promise<{ items: OutcomeItem[]; nextCursor: string | null; hasMore: boolean }> {
  const { projectId, limit } = input;
  const filter: Record<string, unknown> = {
    projectId: new Types.ObjectId(projectId),
    type: 'status_changed',
    toStatus: { $in: OUTCOME_STATUSES },
  };
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    const at = new Date(cursor.at);
    const id = new Types.ObjectId(cursor.id);
    filter.$or = [{ at: { $gt: at } }, { at, _id: { $gt: id } }];
  }

  const events = await CustomerEvent.find(filter)
    .sort({ at: 1, _id: 1 })
    .limit(limit + 1);

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;

  // 批量取客户的外部引用（CRM 原生客户 externalId 为 null）
  const customerIds = [...new Set(page.map((e) => String(e.customerId)))].map(
    (id) => new Types.ObjectId(id),
  );
  const customers = await Customer.find({ _id: { $in: customerIds } })
    .select('externalId')
    .lean();
  const externalIdByCustomer = new Map(
    customers.map((c) => [String(c._id), (c.externalId as string | undefined) ?? null]),
  );

  const items: OutcomeItem[] = page.map((event) => {
    const cursor = encodeCursor({ at: event.at.toISOString(), id: String(event._id) });
    return {
      eventId: String(event._id),
      cursor,
      customerId: String(event.customerId),
      externalId: externalIdByCustomer.get(String(event.customerId)) ?? null,
      fromStatus: event.fromStatus ?? null,
      toStatus: String(event.toStatus),
      occurredAt: event.at.toISOString(),
    };
  });

  return {
    items,
    nextCursor: items.length > 0 ? items[items.length - 1].cursor : null,
    hasMore,
  };
}

/* ------------------------------- stats/overview ------------------------------- */

export async function getIntegrationStats(projectId: string): Promise<{
  projectId: string;
  totalCustomers: number;
  funnel: { status: string; count: number }[];
  wonCount: number;
  lostCount: number;
  quotations: { status: string; count: number }[];
  generatedAt: string;
}> {
  const pid = new Types.ObjectId(projectId);

  const byStatusRows = await Customer.aggregate<{ _id: string; count: number }>([
    { $match: { projectId: pid } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus = new Map(byStatusRows.map((row) => [row._id, row.count]));
  // 零初始化保证漏斗 8 段完整返回
  const funnel = CUSTOMER_STATUS.map((status) => ({ status, count: byStatus.get(status) ?? 0 }));
  const totalCustomers = funnel.reduce((sum, stage) => sum + stage.count, 0);

  const quotationRows = await Quotation.aggregate<{ _id: string; count: number }>([
    { $match: { projectId: pid } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const quotationByStatus = new Map(quotationRows.map((row) => [row._id, row.count]));
  const quotations = QUOTATION_STATUS.map((status) => ({
    status,
    count: quotationByStatus.get(status) ?? 0,
  }));

  return {
    projectId,
    totalCustomers,
    funnel,
    wonCount: byStatus.get('won') ?? 0,
    lostCount: byStatus.get('lost') ?? 0,
    quotations,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------- 阶段 5.2 预留只读 ------------------------------- */

export async function getCustomerStatusByExternalRef(input: {
  projectId: string;
  externalRef: string;
  sourceSystem?: string;
}): Promise<{
  customerId: string;
  externalId: string | null;
  name: string | null;
  company: string | null;
  status: string;
  ownerName: string | null;
  lastFollowUpAt: string | null;
  updatedAt: string;
}> {
  const customer = await Customer.findOne({
    projectId: input.projectId,
    externalSystem: input.sourceSystem ?? 'autoforce',
    externalId: input.externalRef,
  }).populate('ownerId', 'displayName username');
  if (!customer) throw ApiError.notFound('该外部 ID 尚未关联任何客户');

  const owner = customer.ownerId as unknown as { displayName?: string; username?: string } | null;
  return {
    customerId: String(customer._id),
    externalId: customer.externalId ?? null,
    name: customer.name ?? null,
    company: customer.company ?? null,
    status: customer.status,
    ownerName: owner?.displayName ?? owner?.username ?? null,
    lastFollowUpAt: customer.lastContactAt ? customer.lastContactAt.toISOString() : null,
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export async function getCustomerQuotationsByExternalRef(input: {
  projectId: string;
  externalRef: string;
  sourceSystem?: string;
}): Promise<{
  customerId: string;
  items: {
    quotationId: string;
    quotationNo: string | null;
    status: string;
    totalAmount: number | null;
    currency: string | null;
    updatedAt: string;
  }[];
}> {
  const customer = await Customer.findOne({
    projectId: input.projectId,
    externalSystem: input.sourceSystem ?? 'autoforce',
    externalId: input.externalRef,
  }).select('_id');
  if (!customer) throw ApiError.notFound('该外部 ID 尚未关联任何客户');

  const quotations = await Quotation.find({
    projectId: input.projectId,
    customerId: customer._id,
  })
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  return {
    customerId: String(customer._id),
    items: quotations.map((q) => ({
      quotationId: String(q._id),
      quotationNo: (q.quotationNo as string | undefined) ?? null,
      status: String(q.status),
      totalAmount: typeof q.totalAmount === 'number' ? q.totalAmount : null,
      currency: (q.currency as string | undefined) ?? null,
      updatedAt: (q.updatedAt as Date).toISOString(),
    })),
  };
}
