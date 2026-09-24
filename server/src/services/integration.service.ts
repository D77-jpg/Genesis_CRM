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
import { createHash, randomUUID } from 'node:crypto';
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
  computeQuotationTotals,
  IntegrationIdempotency,
  Quotation,
  type CustomerDocument,
  type QuotationDocument,
} from '../models';
import type {
  CreateQuotationDraftBody,
  UpsertCustomerBody,
} from '../validators/integration.validator';

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

const IDEMPOTENCY_LEASE_MS = 30_000;
const IDEMPOTENCY_WAIT_MS = 10_000;
const IDEMPOTENCY_POLL_MS = 20;

type IdempotencyReservation<T> =
  | { kind: 'replay'; result: T; statusCode: number }
  | { kind: 'owner'; id: Types.ObjectId; owner: string };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function replayFrom<T>(record: {
  state?: string;
  response?: Record<string, unknown> | null;
  statusCode?: number | null;
}): IdempotencyReservation<T> | null {
  // state 缺失兼容 v1 已完成记录；它们原本强制包含 response/statusCode。
  const completed = record.state === 'completed' || Boolean(record.response && record.statusCode);
  if (!completed || !record.response || !record.statusCode) return null;
  return {
    kind: 'replay',
    result: record.response as unknown as T,
    statusCode: record.statusCode,
  };
}

async function reserveIdempotency<T>(
  credentialId: string,
  projectId: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyReservation<T>> {
  const owner = randomUUID();
  const credentialObjectId = new Types.ObjectId(credentialId);
  const projectObjectId = new Types.ObjectId(projectId);

  try {
    const created = await IntegrationIdempotency.create({
      credentialId: credentialObjectId,
      projectId: projectObjectId,
      key,
      requestHash,
      state: 'processing',
      owner,
      leaseExpiresAt: new Date(Date.now() + IDEMPOTENCY_LEASE_MS),
    });
    return { kind: 'owner', id: created._id, owner };
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
  }

  const deadline = Date.now() + IDEMPOTENCY_WAIT_MS;
  while (Date.now() < deadline) {
    const current = await IntegrationIdempotency.findOne({ credentialId: credentialObjectId, key });
    if (!current) {
      // 极少数清理竞争：回到调用方重试更安全，不在这里无界循环。
      throw ApiError.conflict('Idempotency-Key 状态变化，请重试');
    }
    if (current.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key 已被不同载荷使用');
    }
    const replay = replayFrom<T>(current);
    if (replay) return replay;

    const now = new Date();
    if (!current.leaseExpiresAt || current.leaseExpiresAt <= now) {
      const acquired = await IntegrationIdempotency.findOneAndUpdate(
        {
          _id: current._id,
          requestHash,
          state: 'processing',
          $or: [{ leaseExpiresAt: { $lte: now } }, { leaseExpiresAt: null }],
        },
        {
          $set: {
            owner,
            leaseExpiresAt: new Date(Date.now() + IDEMPOTENCY_LEASE_MS),
          },
        },
        { new: true },
      );
      if (acquired) return { kind: 'owner', id: acquired._id, owner };
    }
    await wait(IDEMPOTENCY_POLL_MS);
  }
  throw ApiError.conflict('同一 Idempotency-Key 的请求仍在处理中，请稍后重试');
}

async function completeIdempotency<T extends object>(
  reservation: Extract<IdempotencyReservation<T>, { kind: 'owner' }>,
  result: T,
  statusCode: number,
): Promise<{ result: T; statusCode: number }> {
  const completed = await IntegrationIdempotency.findOneAndUpdate(
    { _id: reservation.id, state: 'processing', owner: reservation.owner },
    {
      $set: { state: 'completed', response: result, statusCode },
      $unset: { owner: 1, leaseExpiresAt: 1 },
    },
    { new: true },
  );
  if (!completed) {
    throw ApiError.conflict('幂等处理租约已被接管，请重试原请求');
  }
  return { result, statusCode };
}

async function abandonIdempotency(
  reservation: Extract<IdempotencyReservation<unknown>, { kind: 'owner' }>,
): Promise<void> {
  await IntegrationIdempotency.updateOne(
    { _id: reservation.id, state: 'processing', owner: reservation.owner },
    { $set: { leaseExpiresAt: new Date(0) } },
  ).catch(() => undefined);
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
  const reservation = await reserveIdempotency<UpsertResult>(credentialId, projectId, idempotencyKey, requestHash);
  if (reservation.kind === 'replay') {
    return { result: reservation.result, statusCode: reservation.statusCode };
  }

  /* ---- 2. 业务级幂等 ---- */
  try {
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
          statusCode = 201;
          result = toUpsertResult('created', customer, body.externalId);
        } catch (error) {
          // 不同幂等键并发写同一 externalRef：业务唯一索引仍负责最终收敛。
          if ((error as { code?: number })?.code === 11000) {
            const winner = await findByExternalRef(projectId, body.sourceSystem, body.externalId);
            if (winner) {
              result = toUpsertResult('unchanged', winner, body.externalId);
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }
      }
    }
    return await completeIdempotency(reservation, result, statusCode);
  } catch (error) {
    await abandonIdempotency(reservation);
    throw error;
  }
}

/* -------------------------- quotation-draft.v1 -------------------------- */

export interface IntegrationQuotationResult {
  quotationId: string;
  quotationNo: string;
  customerId: string;
  externalRef: string;
  title: string;
  items: {
    productName: string;
    model?: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
  currency: string;
  totalAmount: number;
  validityDate: string | null;
  paymentTerms: string | null;
  leadTime: string | null;
  moq: string | null;
  notes: string | null;
  status: string;
  version: number;
  proposalTrace: NonNullable<CreateQuotationDraftBody['proposalTrace']> | null;
  createdAt: string;
  updatedAt: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashQuotationDraftPayload(body: CreateQuotationDraftBody): string {
  return createHash('sha256').update(stableJson(body)).digest('hex');
}

function toIntegrationQuotation(
  quotation: QuotationDocument,
  externalRef: string,
): IntegrationQuotationResult {
  return {
    quotationId: String(quotation._id),
    quotationNo: quotation.quotationNo,
    customerId: String(quotation.customerId),
    externalRef,
    title: quotation.title,
    items: quotation.items.map((item) => ({
      productName: item.productName,
      ...(item.model ? { model: item.model } : {}),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
    })),
    currency: quotation.currency,
    totalAmount: quotation.totalAmount,
    validityDate: quotation.validityDate?.toISOString() ?? null,
    paymentTerms: quotation.paymentTerms ?? null,
    leadTime: quotation.leadTime ?? null,
    moq: quotation.moq ?? null,
    notes: quotation.notes ?? null,
    status: quotation.status,
    version: quotation.version ?? 1,
    proposalTrace: quotation.proposalTrace
      ? {
          proposalId: quotation.proposalTrace.proposalId,
          generatedBy: quotation.proposalTrace.generatedBy,
          ...(quotation.proposalTrace.model ? { model: quotation.proposalTrace.model } : {}),
          sources: quotation.proposalTrace.sources.map((source) => ({
            kind: source.kind,
            referenceId: source.referenceId,
            ...(source.title ? { title: source.title } : {}),
          })),
        }
      : null,
    createdAt: quotation.createdAt.toISOString(),
    updatedAt: quotation.updatedAt.toISOString(),
  };
}

async function generateIntegrationQuotationNo(projectId: Types.ObjectId): Promise<string> {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const base = await Quotation.countDocuments({ projectId, createdAt: { $gte: startOfToday } });

  for (let offset = 1; offset <= 500; offset += 1) {
    const candidate = `QT-${ymd}-${String(base + offset).padStart(3, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await Quotation.exists({ projectId, quotationNo: candidate }))) return candidate;
  }
  return `QT-${ymd}-${now.getTime().toString(36).toUpperCase()}`;
}

async function markCustomerQuoting(
  projectId: Types.ObjectId,
  customerId: Types.ObjectId,
): Promise<void> {
  const changed = await Customer.findOneAndUpdate(
    {
      _id: customerId,
      projectId,
      status: { $in: ['pending', 'contacted', 'replied', 'interested'] },
    },
    { $set: { status: 'quoting' } },
  ).select('status');
  if (!changed) return;
  await CustomerEvent.create({
    projectId,
    customerId,
    type: 'status_changed',
    at: new Date(),
    fromStatus: changed.status,
    toStatus: 'quoting',
  });
}

/** 用户确认后，为已同步客户幂等创建一份 Genesis 权威 draft。 */
export async function createQuotationDraft(input: {
  credentialId: string;
  projectId: string;
  externalRef: string;
  idempotencyKey: string;
  body: CreateQuotationDraftBody;
}): Promise<{ result: IntegrationQuotationResult; statusCode: number }> {
  const { credentialId, externalRef, idempotencyKey, body } = input;
  const projectId = new Types.ObjectId(input.projectId);
  // 现有唯一索引是 (credentialId, key)；把 project + operation 纳入摘要，
  // 在不迁移线上索引的前提下实现契约要求的四维幂等作用域。
  const internalRequestKey = `qd:${createHash('sha256')
    .update(`${input.projectId}:${idempotencyKey}`)
    .digest('hex')}`;
  const requestHash = hashQuotationDraftPayload(body);
  const reservation = await reserveIdempotency<IntegrationQuotationResult>(
    credentialId,
    input.projectId,
    internalRequestKey,
    requestHash,
  );
  if (reservation.kind === 'replay') {
    return { result: reservation.result, statusCode: 200 };
  }

  try {
    const customer = await Customer.findOne({
      projectId,
      externalSystem: body.sourceSystem,
      externalId: externalRef,
    }).select('_id status');
    if (!customer) throw ApiError.notFound('该外部 ID 尚未关联任何客户');

    const integrationIdempotencyKey = createHash('sha256')
      .update(`${credentialId}:${input.projectId}:${idempotencyKey}`)
      .digest('hex');
    let quotation = await Quotation.findOne({ projectId, integrationIdempotencyKey })
      .select('+integrationIdempotencyKey');
    const recovered = Boolean(quotation);

    if (!quotation) {
      const { items, totalAmount } = computeQuotationTotals(body.items);
      for (let attempt = 0; attempt < 5 && !quotation; attempt += 1) {
        const quotationNo = await generateIntegrationQuotationNo(projectId);
        try {
          // eslint-disable-next-line no-await-in-loop
          quotation = await Quotation.create({
            projectId,
            quotationNo,
            customerId: customer._id,
            title: body.title,
            items,
            currency: body.currency,
            totalAmount,
            validityDate: body.validityDate ? new Date(body.validityDate) : undefined,
            paymentTerms: body.paymentTerms,
            leadTime: body.leadTime,
            moq: body.moq,
            notes: body.notes,
            status: 'draft',
            version: 1,
            proposalTrace: body.proposalTrace,
            integrationIdempotencyKey,
          });
        } catch (error) {
          if ((error as { code?: number })?.code !== 11000) throw error;
          // 进程在“业务写入成功、幂等记录完成”之间中断时，接管者找回首次结果。
          // eslint-disable-next-line no-await-in-loop
          quotation = await Quotation.findOne({ projectId, integrationIdempotencyKey })
            .select('+integrationIdempotencyKey');
        }
      }
    }
    if (!quotation) throw ApiError.conflict('报价编号生成冲突，请重试');

    if (body.markCustomerAsQuoting) {
      await markCustomerQuoting(projectId, customer._id);
    }
    const result = toIntegrationQuotation(quotation, externalRef);
    await completeIdempotency(reservation, result, 201);
    return { result, statusCode: recovered ? 200 : 201 };
  } catch (error) {
    await abandonIdempotency(reservation);
    throw error;
  }
}

/** 按项目隔离读取报价权威详情；原生未关联报价不暴露给跨系统接口。 */
export async function getIntegrationQuotation(input: {
  projectId: string;
  quotationId: string;
}): Promise<IntegrationQuotationResult> {
  const quotation = await Quotation.findOne({
    _id: new Types.ObjectId(input.quotationId),
    projectId: new Types.ObjectId(input.projectId),
  });
  if (!quotation) throw ApiError.notFound('报价不存在或不属于当前项目');

  const customer = await Customer.findOne({
    _id: quotation.customerId,
    projectId: new Types.ObjectId(input.projectId),
  }).select('externalId');
  if (!customer?.externalId) throw ApiError.notFound('报价未关联外部客户引用');
  return toIntegrationQuotation(quotation, customer.externalId);
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
