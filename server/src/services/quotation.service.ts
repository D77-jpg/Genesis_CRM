/**
 * 报价单业务逻辑（V2 报价管理）
 * ------------------------------------------------------------------
 * 权限隔离沿用 V1 规则：
 *   - 业务员只能访问「自己名下客户」的报价单，管理员可访问全部；
 *   - 越权一律 404（assertCustomerAccess），不泄露资源存在性；
 *   - 单条更新 / 删除使用「_id + customerId」双条件，杜绝跨客户越权。
 *
 * 金额可信性：items[].amount 与 totalAmount 一律由 computeQuotationTotals 重算，
 * 前端传入的金额在校验层已被剥离，服务层不会采信。
 *
 * 客户状态联动：仅在「显式确认」（markCustomerAsQuoting=true）时，把处于
 * 报价中之前阶段的客户推进到「报价中」，复用 customer.service.updateCustomer
 * （内含改动快照 + Timeline 事件记录）；普通编辑绝不改动客户销售状态。
 */
import { Types, type FilterQuery } from 'mongoose';
import {
  Customer,
  Quotation,
  computeQuotationTotals,
  type IQuotation,
  type QuotationDocument,
} from '../models';
import type { CustomerStatus, QuotationCurrency, QuotationStatus } from '../constants';
import { ApiError } from '../utils/ApiError';
import { buildPaginated, parsePagination, sortableFields, type Paginated } from '../utils/pagination';
import { escapeRegExp } from '../utils/text';
import { assertCustomerAccess, customerRefScope, projectScope, requireProjectId } from '../utils/access';
import { createLogger } from '../config/logger';
import { updateCustomer } from './customer.service';
import type { AuthUser } from '../types/express';
import type {
  CreateQuotationInput,
  ListQuotationsQuery,
  UpdateQuotationInput,
  UpdateQuotationStatusInput,
} from '../validators/quotation.validator';

const logger = createLogger('quotation-service');

/** 只有处于这些阶段的客户，显式联动时才推进到「报价中」（避免降级谈判中 / 成交 / 流失） */
const QUOTING_LINKABLE_FROM: CustomerStatus[] = ['pending', 'contacted', 'replied', 'interested'];

/** 报价单列表 / 详情中附带的客户摘要 */
export interface QuotationCustomerSummary {
  id: string;
  name: string;
  company?: string;
  email?: string;
  status: CustomerStatus;
}

/** 对外输出的报价明细行 */
export interface QuotationItemDto {
  productName: string;
  model?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/** 对外输出的报价单 DTO（id / customerId 均为字符串） */
export interface QuotationDto {
  id: string;
  quotationNo: string;
  customerId: string;
  customer?: QuotationCustomerSummary;
  title: string;
  items: QuotationItemDto[];
  currency: QuotationCurrency;
  totalAmount: number;
  validityDate?: Date | null;
  paymentTerms?: string;
  leadTime?: string;
  moq?: string;
  notes?: string;
  status: QuotationStatus;
  version: number;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/* ------------------------------------------------------------------ */
/* DTO 转换                                                            */
/* ------------------------------------------------------------------ */

interface PopulatedCustomer {
  _id: Types.ObjectId | string;
  name: string;
  company?: string;
  email?: string;
  status: CustomerStatus;
}

function asPopulatedCustomer(value: unknown): PopulatedCustomer | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!('_id' in record) || !('name' in record)) return null;
  return value as PopulatedCustomer;
}

function toCustomerSummary(value: unknown): QuotationCustomerSummary | undefined {
  const populated = asPopulatedCustomer(value);
  if (!populated) return undefined;
  return {
    id: String(populated._id),
    name: populated.name,
    company: populated.company,
    email: populated.email,
    status: populated.status,
  };
}

/** 把 Mongo 文档（lean 或 hydrated 均可）转换成对外 DTO */
function toQuotationDto(doc: Record<string, unknown>): QuotationDto {
  const rawCustomerId = doc.customerId;
  const summary = toCustomerSummary(rawCustomerId);
  const customerId = summary?.id ?? String(rawCustomerId ?? '');

  const rawItems = (doc.items as Record<string, unknown>[] | undefined) ?? [];
  const items: QuotationItemDto[] = rawItems.map((it) => ({
    productName: String(it.productName ?? ''),
    ...(it.model ? { model: String(it.model) } : {}),
    quantity: Number(it.quantity ?? 0),
    unitPrice: Number(it.unitPrice ?? 0),
    amount: Number(it.amount ?? 0),
  }));

  return {
    id: String((doc._id ?? doc.id ?? '').toString()),
    quotationNo: String(doc.quotationNo ?? ''),
    customerId,
    ...(summary ? { customer: summary } : {}),
    title: String(doc.title ?? ''),
    items,
    currency: (doc.currency as QuotationCurrency) ?? 'USD',
    totalAmount: Number(doc.totalAmount ?? 0),
    validityDate: doc.validityDate ? new Date(doc.validityDate as Date) : null,
    ...(doc.paymentTerms ? { paymentTerms: String(doc.paymentTerms) } : {}),
    ...(doc.leadTime ? { leadTime: String(doc.leadTime) } : {}),
    ...(doc.moq ? { moq: String(doc.moq) } : {}),
    ...(doc.notes ? { notes: String(doc.notes) } : {}),
    status: (doc.status as QuotationStatus) ?? 'draft',
    version: Number(doc.version ?? 1),
    ...(doc.createdBy ? { createdBy: String(doc.createdBy) } : {}),
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

function toDto(doc: QuotationDocument): QuotationDto {
  return toQuotationDto(doc.toObject({ virtuals: false, depopulate: false }) as unknown as Record<string, unknown>);
}

/* ------------------------------------------------------------------ */
/* 报价编号                                                            */
/* ------------------------------------------------------------------ */

function isDuplicateKeyError(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  return code === 11000;
}

/** 把底层写入错误映射成业务错误：编号重复 → 409，其余原样抛出 */
function mapWriteError(err: unknown): never {
  if (isDuplicateKeyError(err)) {
    throw ApiError.conflict('报价单编号已存在，请更换一个编号');
  }
  throw err;
}

/**
 * 生成报价编号：QT-YYYYMMDD-NNN（NNN 为当天序号，从 001 起）。
 * 用「当天已有数量」作为起点并逐个探测是否被占用，配合唯一索引兜底，简单可靠、无需额外依赖。
 */
async function generateQuotationNo(actor?: AuthUser): Promise<string> {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const base = await Quotation.countDocuments({ ...projectScope(actor), createdAt: { $gte: startOfToday } });

  for (let seq = base + 1; seq <= base + 500; seq += 1) {
    const candidate = `QT-${ymd}-${String(seq).padStart(3, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Quotation.findOne({ ...projectScope(actor), quotationNo: candidate }).select('_id');
    if (!exists) return candidate;
  }
  // 极端兜底（同一天生成上千份）：附加时间戳片段，保证唯一
  return `QT-${ymd}-${now.getTime().toString(36).toUpperCase()}`;
}

/** 解析最终使用的报价编号：用户自定义则查重，未提供则自动生成 */
async function resolveQuotationNo(provided?: string, excludeId?: string, actor?: AuthUser): Promise<string> {
  if (provided) {
    const dupFilter: FilterQuery<IQuotation> = { ...projectScope(actor), quotationNo: provided };
    if (excludeId) dupFilter._id = { $ne: new Types.ObjectId(excludeId) };
    const dup = await Quotation.findOne(dupFilter).select('_id');
    if (dup) throw ApiError.conflict(`报价单编号已存在：${provided}`);
    return provided;
  }
  return generateQuotationNo(actor);
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

function buildQuotationFilter(query: ListQuotationsQuery): FilterQuery<IQuotation> {
  const filter: Record<string, unknown> = {};
  if (query.customerId) filter.customerId = new Types.ObjectId(query.customerId);
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.currency) filter.currency = query.currency;
  if (query.search) {
    const regex = new RegExp(escapeRegExp(query.search.trim()), 'i');
    filter.$or = [{ quotationNo: regex }, { title: regex }];
  }
  return filter as FilterQuery<IQuotation>;
}

/** 顶层报价单列表（分页 / 筛选）；未指定 customerId 时按可见范围收敛 */
export async function listQuotations(query: ListQuotationsQuery, actor?: AuthUser): Promise<Paginated<QuotationDto>> {
  const { page, limit, skip, sortBy, sortOrder } = parsePagination(query as unknown as Record<string, unknown>, {
    allowedSortFields: sortableFields.quotation,
    defaultSortBy: 'createdAt',
  });

  const filter = { $and: [buildQuotationFilter(query), await customerRefScope(actor)] } as FilterQuery<IQuotation>;
  const sortSpec: Record<string, 1 | -1> = {};
  sortSpec[sortBy] = sortOrder;
  sortSpec._id = -1;

  const [rawItems, total] = await Promise.all([
    Quotation.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .populate('customerId', 'name company email status')
      .lean(),
    Quotation.countDocuments(filter),
  ]);

  const items = rawItems as unknown as Record<string, unknown>[];
  return buildPaginated(items.map(toQuotationDto), total, page, limit);
}

/** 某客户的报价单（按创建时间倒序），供客户详情页展示 */
export async function listCustomerQuotations(customerId: string, limit = 200, actor?: AuthUser): Promise<QuotationDto[]> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  const docs = await Quotation.find({ customerId: new Types.ObjectId(customerId), ...projectScope(actor) })
    .sort({ createdAt: -1 })
    .limit(limit);
  return docs.map(toDto);
}

/** 顶层查看单份报价单详情（业务员仅限自己名下客户） */
export async function getQuotation(id: string, actor?: AuthUser): Promise<QuotationDto> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('报价单 ID 格式不正确');
  const doc = await Quotation.findOne({ _id: id, ...projectScope(actor) }).populate('customerId', 'name company email status ownerId projectId');
  if (!doc) throw ApiError.notFound(`报价单不存在或已被删除（id=${id}）`);
  const customer = doc.customerId as unknown as { ownerId?: unknown } | null;
  assertCustomerAccess(actor, customer?.ownerId, doc.projectId);
  return toDto(doc);
}

/** 嵌套查看：某客户下的单份报价单（客户归属校验在控制器 getCustomerByIdOrThrow 完成） */
export async function getCustomerQuotation(customerId: string, quotationId: string, actor?: AuthUser): Promise<QuotationDto> {
  if (!Types.ObjectId.isValid(customerId)) throw ApiError.badRequest('客户 ID 格式不正确');
  if (!Types.ObjectId.isValid(quotationId)) throw ApiError.badRequest('报价单 ID 格式不正确');
  const doc = await Quotation.findOne({
    _id: new Types.ObjectId(quotationId),
    customerId: new Types.ObjectId(customerId),
    ...projectScope(actor),
  });
  if (!doc) throw ApiError.notFound('报价单不存在或无权访问');
  return toDto(doc);
}

/* ------------------------------------------------------------------ */
/* 增 / 改 / 删                                                        */
/* ------------------------------------------------------------------ */

/** 显式联动：把处于报价中之前阶段的客户推进到「报价中」（best-effort，失败不阻断主流程） */
async function linkCustomerToQuoting(
  customerId: string,
  currentStatus: CustomerStatus | undefined,
  actor?: AuthUser,
): Promise<void> {
  if (!currentStatus || !QUOTING_LINKABLE_FROM.includes(currentStatus)) return;
  try {
    // 复用成熟的状态更新逻辑：内部会做改动快照 + 写入 Timeline 状态变化事件
    await updateCustomer(customerId, { status: 'quoting' }, actor);
  } catch (error) {
    logger.warn(`联动客户状态为「报价中」失败（已忽略）: customer=${customerId} ${(error as Error).message}`);
  }
}

/** 新建报价单 */
export async function createQuotation(
  customerId: string,
  input: CreateQuotationInput,
  actor?: AuthUser,
): Promise<QuotationDto> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  const customer = await Customer.findOne({ _id: customerId, ...projectScope(actor) }).select('_id status ownerId projectId');
  if (!customer) {
    throw ApiError.notFound(`客户不存在或已被删除（id=${customerId}）`);
  }
  assertCustomerAccess(actor, customer.ownerId, customer.projectId);

  const quotationNo = await resolveQuotationNo(input.quotationNo, undefined, actor);
  const { items, totalAmount } = computeQuotationTotals(input.items);

  let doc: QuotationDocument;
  try {
    doc = await Quotation.create({
      projectId: requireProjectId(actor),
      quotationNo,
      customerId: customer._id,
      title: input.title,
      items,
      currency: input.currency,
      totalAmount,
      validityDate: input.validityDate,
      paymentTerms: input.paymentTerms,
      leadTime: input.leadTime,
      moq: input.moq,
      notes: input.notes,
      status: input.status,
      createdBy: actor ? new Types.ObjectId(actor.id) : undefined,
    } as Partial<IQuotation>);
  } catch (error) {
    mapWriteError(error);
  }

  if (input.markCustomerAsQuoting) {
    await linkCustomerToQuoting(String(customer._id), customer.status, actor);
  }

  logger.info(`新建报价单: ${doc.quotationNo} customer=${customerId} total=${totalAmount} ${input.currency}`);
  return toDto(doc);
}

/** 编辑报价单（不含客户状态联动）；只 $set 明确提供的字段 */
export async function updateQuotation(
  customerId: string,
  quotationId: string,
  input: UpdateQuotationInput,
  actor?: AuthUser,
): Promise<QuotationDto> {
  if (!Types.ObjectId.isValid(customerId)) throw ApiError.badRequest('客户 ID 格式不正确');
  if (!Types.ObjectId.isValid(quotationId)) throw ApiError.badRequest('报价单 ID 格式不正确');

  const customer = await Customer.findOne({ _id: customerId, ...projectScope(actor) }).select('_id ownerId projectId');
  if (!customer) throw ApiError.notFound(`客户不存在或已被删除（id=${customerId}）`);
  assertCustomerAccess(actor, customer.ownerId, customer.projectId);

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.paymentTerms !== undefined) patch.paymentTerms = input.paymentTerms;
  if (input.leadTime !== undefined) patch.leadTime = input.leadTime;
  if (input.moq !== undefined) patch.moq = input.moq;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.status !== undefined) patch.status = input.status;
  // validityDate：null = 显式清除，Date = 设置；未传（undefined）= 不改动
  if (input.validityDate !== undefined) patch.validityDate = input.validityDate;
  // 明细变更 → 后端重算每行金额与总金额（findOneAndUpdate 不触发模型钩子，故此处必须显式计算）
  if (input.items !== undefined) {
    const { items, totalAmount } = computeQuotationTotals(input.items);
    patch.items = items;
    patch.totalAmount = totalAmount;
  }
  if (input.quotationNo !== undefined) {
    patch.quotationNo = await resolveQuotationNo(input.quotationNo, quotationId, actor);
  }

  let doc: QuotationDocument | null;
  try {
    doc = await Quotation.findOneAndUpdate(
      { _id: new Types.ObjectId(quotationId), customerId: new Types.ObjectId(customerId), ...projectScope(actor) },
      { $set: patch, $inc: { version: 1 } },
      { new: true, runValidators: true },
    );
  } catch (error) {
    mapWriteError(error);
  }
  if (!doc) throw ApiError.notFound('报价单不存在或无权修改');

  logger.info(`编辑报价单: ${doc.quotationNo} customer=${customerId}`);
  return toDto(doc);
}

/** 更新报价单状态；可选显式联动客户状态到「报价中」 */
export async function updateQuotationStatus(
  customerId: string,
  quotationId: string,
  input: UpdateQuotationStatusInput,
  actor?: AuthUser,
): Promise<QuotationDto> {
  if (!Types.ObjectId.isValid(customerId)) throw ApiError.badRequest('客户 ID 格式不正确');
  if (!Types.ObjectId.isValid(quotationId)) throw ApiError.badRequest('报价单 ID 格式不正确');

  const customer = await Customer.findOne({ _id: customerId, ...projectScope(actor) }).select('_id status ownerId projectId');
  if (!customer) throw ApiError.notFound(`客户不存在或已被删除（id=${customerId}）`);
  assertCustomerAccess(actor, customer.ownerId, customer.projectId);

  const doc = await Quotation.findOneAndUpdate(
    { _id: new Types.ObjectId(quotationId), customerId: new Types.ObjectId(customerId), ...projectScope(actor) },
    { $set: { status: input.status }, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  if (!doc) throw ApiError.notFound('报价单不存在或无权修改');

  if (input.markCustomerAsQuoting) {
    await linkCustomerToQuoting(String(customer._id), customer.status, actor);
  }

  logger.info(`更新报价单状态: ${doc.quotationNo} -> ${input.status}`);
  return toDto(doc);
}

/** 删除报价单（必须属于该客户，双条件防越权） */
export async function deleteQuotation(
  customerId: string,
  quotationId: string,
  actor?: AuthUser,
): Promise<{ id: string; deleted: number }> {
  if (!Types.ObjectId.isValid(customerId)) throw ApiError.badRequest('客户 ID 格式不正确');
  if (!Types.ObjectId.isValid(quotationId)) throw ApiError.badRequest('报价单 ID 格式不正确');

  const customer = await Customer.findOne({ _id: customerId, ...projectScope(actor) }).select('_id ownerId projectId');
  if (!customer) throw ApiError.notFound(`客户不存在或已被删除（id=${customerId}）`);
  assertCustomerAccess(actor, customer.ownerId, customer.projectId);

  const { deletedCount } = await Quotation.deleteOne({
    _id: new Types.ObjectId(quotationId),
    customerId: new Types.ObjectId(customerId),
    ...projectScope(actor),
  });
  if (!deletedCount) throw ApiError.notFound('报价单不存在或已被删除');

  logger.info(`删除报价单: customer=${customerId} quotation=${quotationId}`);
  return { id: quotationId, deleted: deletedCount ?? 0 };
}
