import { prepareMailDeletion, purgeCustomerMail } from './mail-cleanup.service';
/**
 * 客户业务逻辑
 * ------------------------------------------------------------------
 * 所有数据库访问都收敛在这里，controller 只做「参数 → 调用 → 响应」。
 */
import { Types, type AnyKeys, type FilterQuery } from 'mongoose';
import { AgentCustomerAnalysis, AgentMailThreadAnalysis, Customer, CustomerEvent, DevelopmentLetter, FollowUp, Quotation, User, type CustomerDocument, type ICustomer } from '../models';
import { CUSTOMER_STATUS, type CustomerStatus, type CustomerSource } from '../constants';
import { ApiError } from '../utils/ApiError';
import { buildPaginated, parsePagination, sortableFields, type Paginated } from '../utils/pagination';
import { escapeRegExp } from '../utils/text';
import { assertCustomerAccess, customerScope, isAdmin, projectScope, requireProjectId } from '../utils/access';
import { createLogger } from '../config/logger';
import { importRowSchema } from '../validators/customer.validator';
import { recordCustomerChanges } from './timeline.service';
import { purgeCustomerAttachments } from './attachment.service';
import type { AuthUser } from '../types/express';
import type {
  CreateCustomerInput,
  ImportCustomersInput,
  ImportRow,
  ListCustomersQuery,
  UpdateCustomerInput,
} from '../validators/customer.validator';

const logger = createLogger('customer-service');

/** 负责人摘要（populate 后转出的对外结构） */
export interface OwnerDto {
  id: string;
  name: string;
}

/** 对外输出的客户 DTO：id 为字符串，ownerId 扁平化，附带 owner 摘要 */
export interface CustomerDto extends Omit<ICustomer, 'ownerId'> {
  id: string;
  ownerId?: string;
  owner?: OwnerDto | null;
}

/** 把 lean() 查询结果（可能 populate 了 ownerId）转换成对外 DTO */
function toCustomerDto(raw: Record<string, unknown>): CustomerDto {
  const { _id, ownerId, ...rest } = raw as Record<string, unknown> & { _id: Types.ObjectId };

  let ownerIdStr: string | undefined;
  let owner: OwnerDto | null = null;

  if (ownerId && typeof ownerId === 'object') {
    const populated = ownerId as { _id?: Types.ObjectId; displayName?: string; username?: string };
    if (populated._id) {
      ownerIdStr = populated._id.toString();
      owner = { id: ownerIdStr, name: populated.displayName?.trim() || populated.username || '未命名用户' };
    }
  } else if (ownerId) {
    ownerIdStr = String(ownerId);
  }

  return { ...rest, id: _id.toString(), ownerId: ownerIdStr, owner } as CustomerDto;
}

/* ------------------------------------------------------------------ */
/* 查询构造                                                            */
/* ------------------------------------------------------------------ */

/** 由列表查询参数构造 Mongo filter */
export function buildCustomerFilter(query: ListCustomersQuery): FilterQuery<ICustomer> {
  // 内部用宽松类型构造，最后统一断言，避开 FilterQuery 在 $and/$or 上的苛刻推导
  const filter: Record<string, unknown> = {};

  if (query.search) {
    // 转义用户输入，避免正则注入 / ReDoS
    const regex = new RegExp(escapeRegExp(query.search.trim()), 'i');
    filter.$or = [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }, { industry: regex }];
  }

  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }
  if (query.industry) {
    filter.industry = new RegExp(escapeRegExp(query.industry.trim()), 'i');
  }
  if (query.grade) {
    filter.grade = query.grade.trim();
  }
  if (query.source) {
    filter.source = query.source;
  }
  // 业务来源筛选：'all' / 空 = 不限；其余精确匹配（兼容 Excel 导入的自定义来源）
  if (query.leadSource && query.leadSource !== 'all') {
    filter.leadSource = query.leadSource.trim();
  }
  // 优先级筛选：'all' = 不限
  if (query.priority && query.priority !== 'all') {
    filter.priority = query.priority;
  }
  if (query.hasEmail === true) {
    filter.email = { $exists: true, $nin: [null, ''] };
  } else if (query.hasEmail === false) {
    const existingAnd = (filter.$and as Record<string, unknown>[] | undefined) ?? [];
    filter.$and = [...existingAnd, { $or: [{ email: { $exists: false } }, { email: null }, { email: '' }] }];
  }
  if (query.createdFrom || query.createdTo) {
    filter.createdAt = {
      ...(query.createdFrom ? { $gte: query.createdFrom } : {}),
      ...(query.createdTo ? { $lte: query.createdTo } : {}),
    };
  }

  // 标签精确匹配（tags 为数组，Mongo 会自动匹配数组内元素）
  if (query.tag) {
    filter.tags = query.tag.trim();
  }

  // 负责人筛选：all / 空 = 不限；unassigned = 未分配；其余为具体用户 id
  if (query.ownerId && query.ownerId !== 'all' && query.ownerId !== '') {
    if (query.ownerId === 'unassigned') {
      const existingAnd = (filter.$and as Record<string, unknown>[] | undefined) ?? [];
      filter.$and = [...existingAnd, { $or: [{ ownerId: { $exists: false } }, { ownerId: null }] }];
    } else {
      filter.ownerId = new Types.ObjectId(query.ownerId);
    }
  }

  // 跟进时间筛选：以本地时区「今天 0 点」为分界
  if (query.followUp && query.followUp !== 'all') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    if (query.followUp === 'overdue') {
      filter.nextFollowUpAt = { $lt: startOfToday };
    } else if (query.followUp === 'today') {
      filter.nextFollowUpAt = { $gte: startOfToday, $lt: startOfTomorrow };
    } else if (query.followUp === 'upcoming') {
      filter.nextFollowUpAt = { $gte: startOfTomorrow };
    }
  }

  return filter as FilterQuery<ICustomer>;
}

/* ------------------------------------------------------------------ */
/* 列表 / 详情                                                         */
/* ------------------------------------------------------------------ */

export async function listCustomers(query: ListCustomersQuery, actor?: AuthUser): Promise<Paginated<CustomerDto>> {
  const { page, limit, skip, sortBy, sortOrder } = parsePagination(
    query as unknown as Record<string, unknown>,
    { allowedSortFields: sortableFields.customer, defaultSortBy: 'updatedAt' },
  );

  // 严格分配制：业务员只在「自己名下客户」范围内检索
  const filter = { ...buildCustomerFilter(query), ...customerScope(actor) } as FilterQuery<ICustomer>;

  // 排序规格显式声明，避免 TS 把字面量 -1 推导成 number
  const sortSpec: Record<string, 1 | -1> = {};
  sortSpec[sortBy] = sortOrder;
  sortSpec._id = -1;

  const [rawItems, total] = await Promise.all([
    Customer.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .populate('ownerId', 'displayName username')
      .lean(),
    Customer.countDocuments(filter),
  ]);

  // lean() 不走 toJSON transform，这里手动补 id、去掉 _id，并把 populate 出的负责人转为 owner 摘要
  const items = rawItems as unknown as Record<string, unknown>[];
  const normalized = items.map((item) => toCustomerDto(item));

  return buildPaginated(normalized, total, page, limit);
}

/** 取单个客户，不存在直接抛 404 */
export async function getCustomerByIdOrThrow(id: string, actor?: AuthUser): Promise<CustomerDocument> {
  if (!Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  const customer = await Customer.findOne({ _id: id, ...projectScope(actor) });
  if (!customer) {
    throw ApiError.notFound(`客户不存在或已被删除（id=${id}）`);
  }
  // 业务员访问非自己名下客户 → 404（不泄露存在性）
  assertCustomerAccess(actor, customer.ownerId, customer.projectId);
  return customer as CustomerDocument;
}

export async function getCustomer(id: string, actor?: AuthUser): Promise<CustomerDto> {
  if (!Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }
  const raw = await Customer.findOne({ _id: id, ...projectScope(actor) }).populate('ownerId', 'displayName username').lean();
  if (!raw) {
    throw ApiError.notFound(`客户不存在或已被删除（id=${id}）`);
  }
  const record = raw as unknown as Record<string, unknown>;
  // populate 后 ownerId 为对象，assertCustomerAccess 内部已兼容两种形态
  assertCustomerAccess(actor, record.ownerId, record.projectId);
  return toCustomerDto(record);
}

/* ------------------------------------------------------------------ */
/* 增删改                                                              */
/* ------------------------------------------------------------------ */

export async function createCustomer(
  input: CreateCustomerInput,
  actor?: AuthUser,
  options?: { agentCreationKey?: string },
): Promise<CustomerDto> {
  const payload: Record<string, unknown> = {
    ...input,
    projectId: requireProjectId(actor),
    source: 'manual' as CustomerSource,
    createdBy: actor ? new Types.ObjectId(actor.id) : undefined,
    ...(options?.agentCreationKey ? { agentCreationKey: options.agentCreationKey } : {}),
  };
  // 严格分配制：业务员新建的客户强制归自己，忽略传入 ownerId；管理员可自由指定
  if (actor && !isAdmin(actor)) {
    payload.ownerId = new Types.ObjectId(actor.id);
  }
  const customer = await Customer.create(payload as AnyKeys<ICustomer>);
  logger.info(`新建客户: ${customer.name} (${customer.id})`);
  // 重新读取以带出负责人摘要，保持与列表 / 详情一致的响应结构
  return getCustomer(customer.id, actor);
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
  actor?: AuthUser,
): Promise<CustomerDto> {
  if (!Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('客户 ID 格式不正确');
  }

  // 先取改动前的快照，用于对比出「状态变化 / 下一次跟进时间变化」并写入活动时间线
  const before = await Customer.findOne({ _id: id, ...projectScope(actor) }).select('status nextFollowUpAt ownerId projectId').lean();
  if (!before) throw ApiError.notFound('客户不存在或已被删除');
  // 业务员只能改自己名下客户
  assertCustomerAccess(actor, (before as { ownerId?: unknown }).ownerId, (before as { projectId?: unknown }).projectId);

  // 过滤掉 undefined，避免 $set 把字段清空；null 保留（用于清除负责人 / 跟进时间）
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  // 严格分配制：业务员不能转移客户归属（负责人仅管理员可调整）
  if (actor && !isAdmin(actor)) delete patch.ownerId;

  const customer = await Customer.findOneAndUpdate({ _id: id, ...projectScope(actor) }, { $set: patch }, { new: true, runValidators: true });
  if (!customer) throw ApiError.notFound('客户不存在或已被删除');

  // 记录活动事件（best-effort，内部已 try/catch，不会阻断更新）
  await recordCustomerChanges(
    id,
    { status: before.status, nextFollowUpAt: before.nextFollowUpAt },
    { status: customer.status, nextFollowUpAt: customer.nextFollowUpAt },
    actor?.id,
    actor?.projectId,
  );

  // 重新读取以带出负责人摘要
  return getCustomer(id, actor);
}

/** 删除客户，同时级联清理其开发信 / 跟进记录 / 活动事件 / 报价单 */
export async function deleteCustomer(id: string, actor?: AuthUser): Promise<{ id: string; deletedLetters: number }> {
  const customer = await getCustomerByIdOrThrow(id, actor);
  const childScope = { projectId: customer.projectId, customerId: customer._id };
  // 先级联清理附件（DB 记录 + 磁盘文件），再删其余从属资源与客户本身
  await prepareMailDeletion([customer._id], customer.projectId);
  await purgeCustomerMail([customer._id], customer.projectId);
  await purgeCustomerAttachments(customer._id);
  const [letterResult] = await Promise.all([
    DevelopmentLetter.deleteMany(childScope),
    FollowUp.deleteMany(childScope),
    CustomerEvent.deleteMany(childScope),
    // 报价单追加在末尾，letterResult 仍为 index 0
    Quotation.deleteMany(childScope),
    AgentCustomerAnalysis.deleteMany(childScope),
    AgentMailThreadAnalysis.deleteMany(childScope),
  ]);
  await Customer.deleteOne({ _id: customer._id, projectId: customer.projectId });
  logger.info(`删除客户: ${customer.name}，级联删除 ${letterResult.deletedCount ?? 0} 封开发信及其跟进记录 / 活动事件 / 报价单 / 附件`);
  return { id, deletedLetters: letterResult.deletedCount ?? 0 };
}

/** 批量修改状态 */
export async function bulkUpdateStatus(
  ids: string[],
  status: CustomerStatus,
  actor?: AuthUser,
): Promise<{ matched: number; modified: number }> {
  const objectIds = ids.map((id) => new Types.ObjectId(id));
  // 严格分配制：只操作业务员自己名下的客户
  const result = await Customer.updateMany(
    { _id: { $in: objectIds }, ...customerScope(actor) },
    { $set: { status } },
    { runValidators: true },
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/** 批量删除（含开发信 / 跟进记录 / 活动事件级联） */
export async function bulkDelete(ids: string[], actor?: AuthUser): Promise<{ deleted: number; deletedLetters: number }> {
  const objectIds = ids.map((id) => new Types.ObjectId(id));
  // 严格分配制：先把范围收敛到「业务员可见的客户」，避免级联误删他人的开发信 / 跟进 / 事件
  const visible = await Customer.find({ _id: { $in: objectIds }, ...customerScope(actor) })
    .select('_id')
    .lean();
  const deletableIds = (visible as unknown as { _id: Types.ObjectId }[]).map((d) => d._id);
  if (deletableIds.length === 0) {
    return { deleted: 0, deletedLetters: 0 };
  }
  // 先级联清理这些客户的附件（DB 记录 + 磁盘文件）
  const projectId = requireProjectId(actor);
  await prepareMailDeletion(deletableIds, projectId);
  await purgeCustomerMail(deletableIds, projectId);
  await purgeCustomerAttachments(deletableIds);
  const childScope = { ...projectScope(actor), customerId: { $in: deletableIds } };
  // 级联删除开发信 / 跟进记录 / 活动事件 / 客户本身 / 报价单。
  // Promise.all 结果按数组顺序对应，用「空位」跳过跟进(index 1)与事件(index 2)的结果，
  // 只取开发信(index 0)与客户(index 3)的删除数——避免解构错位（曾把跟进删除数
  // 误当成客户删除数返回，导致删除无跟进记录的客户时 bulk/delete 误报 NOT_FOUND）。
  // 报价单删除追加在末尾(index 4)，不参与解构，故不影响上述位置。
  const [letterResult, , , customerResult] = await Promise.all([
    DevelopmentLetter.deleteMany(childScope),
    FollowUp.deleteMany(childScope),
    CustomerEvent.deleteMany(childScope),
    Customer.deleteMany({ _id: { $in: deletableIds }, ...projectScope(actor) }),
    Quotation.deleteMany(childScope),
    AgentCustomerAnalysis.deleteMany(childScope),
    AgentMailThreadAnalysis.deleteMany(childScope),
  ]);
  return {
    deleted: customerResult.deletedCount ?? 0,
    deletedLetters: letterResult.deletedCount ?? 0,
  };
}

/**
 * 批量添加标签：$addToSet + $each 自动跳过已存在的标签，不会产生重复。
 * runValidators 保证标签数量上限（≤ 30）等模型约束仍然生效。
 */
export async function bulkAddTags(
  ids: string[],
  tags: string[],
  actor?: AuthUser,
): Promise<{ matched: number; modified: number }> {
  const objectIds = ids.map((id) => new Types.ObjectId(id));
  const result = await Customer.updateMany(
    { _id: { $in: objectIds }, ...customerScope(actor) },
    { $addToSet: { tags: { $each: tags } } },
    { runValidators: true },
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/** 批量删除标签：$pull 移除命中的标签，客户没有该标签时为无操作 */
export async function bulkRemoveTags(
  ids: string[],
  tags: string[],
  actor?: AuthUser,
): Promise<{ matched: number; modified: number }> {
  const objectIds = ids.map((id) => new Types.ObjectId(id));
  const result = await Customer.updateMany(
    { _id: { $in: objectIds }, ...customerScope(actor) },
    { $pull: { tags: { $in: tags } } },
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/**
 * 批量设置负责人；ownerId 为 null 表示清除（未分配）。
 * 未分配筛选同时匹配 null 与字段缺失，故这里统一写 null。
 */
export async function bulkAssignOwner(
  ids: string[],
  ownerId: string | null,
  actor?: AuthUser,
): Promise<{ matched: number; modified: number }> {
  const objectIds = ids.map((id) => new Types.ObjectId(id));
  // 分配负责人是管理员专属操作（路由已 requireRole('admin') 守卫），并入 scope 作纵深防御
  const result = await Customer.updateMany(
    { _id: { $in: objectIds }, ...customerScope(actor) },
    { $set: { ownerId: ownerId ? new Types.ObjectId(ownerId) : null } },
    { runValidators: true },
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/**
 * 批量设置下一次跟进时间；null 表示清除。
 * 清除后该客户不再命中「今天 / 逾期 / 未来」任一筛选（依赖 Mongo 的类型分段比较）。
 */
export async function bulkSetFollowUp(
  ids: string[],
  nextFollowUpAt: Date | null,
  actor?: AuthUser,
): Promise<{ matched: number; modified: number }> {
  const objectIds = ids.map((id) => new Types.ObjectId(id));
  const result = await Customer.updateMany(
    { _id: { $in: objectIds }, ...customerScope(actor) },
    { $set: { nextFollowUpAt } },
    { runValidators: true },
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/* ------------------------------------------------------------------ */
/* Excel 批量导入                                                      */
/* ------------------------------------------------------------------ */

export interface ImportFailure {
  /** Excel 中的行号（从 1 开始，含表头） */
  row?: number;
  name?: string;
  email?: string;
  reason: string;
}

export interface ImportResult {
  /** 提交总行数 */
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failures: ImportFailure[];
  /** 是否只是预检（dryRun） */
  dryRun: boolean;
}

/**
 * 把「行号」附加到失败信息里，前端可以在导入结果弹窗中精确提示第几行出错。
 * 参数故意只要求 __row，因为校验失败的行可能连基本字段类型都不对。
 */
function rowLabel(row: { __row?: number }, index: number): number {
  return row.__row ?? index + 2; // +2：表头占第 1 行，数据从第 2 行开始
}

/** 行定位信息（不含失败原因），用于拼接最终的 ImportFailure */
type RowLabel = Omit<ImportFailure, 'reason'>;

/** 通过逐行校验的数据，保留原始下标以便 __row 缺失时仍能推算行号 */
type ValidRow = { row: ImportRow; index: number };

/**
 * 逐行做业务校验：非法行进 failures，合法行才继续参与后续判定。
 *
 * 这一步刻意放在服务层而不是 HTTP 入口（入口用的是宽松 schema），
 * 目的是让「一批里混了几行脏数据」时仍然能导入其余行，而不是整批报错。
 */
function validateRows(customers: ImportCustomersInput['customers'], failures: ImportFailure[]): ValidRow[] {
  const valid: ValidRow[] = [];

  customers.forEach((rawRow, index) => {
    const parsed = importRowSchema.safeParse(rawRow);

    if (parsed.success) {
      valid.push({ row: parsed.data, index });
      return;
    }

    // 把 zod 的多条字段错误合并成一句人话，前端一行就能显示清楚
    const reasons = [
      ...new Set(
        parsed.error.issues.map((issue) => {
          const path = issue.path.filter((segment) => segment !== '__row');
          return `${path.length > 0 ? path.join('.') : '该行'}：${issue.message}`;
        }),
      ),
    ];

    failures.push({
      row: rowLabel(rawRow, index),
      name: rawRow.name,
      email: rawRow.email,
      reason: `数据校验未通过（${reasons.join('；')}）`,
    });
  });

  return valid;
}

export async function importCustomers(input: ImportCustomersInput, actor?: AuthUser): Promise<ImportResult> {
  const { customers, onDuplicate, defaultStatus, dryRun } = input;

  const failures: ImportFailure[] = [];
  const toInsert: Partial<ICustomer>[] = [];
  const toUpdate: { id: Types.ObjectId; patch: Partial<ICustomer>; label: RowLabel }[] = [];

  // 0) 行级校验，过滤掉脏数据
  const validRows = validateRows(customers, failures);

  // 1) 先把库里已存在的邮箱捞出来，构建 email -> _id 映射
  const emails = validRows
    .map(({ row }) => row.email)
    .filter((e): e is string => Boolean(e))
    .map((e) => e.toLowerCase());

  const existingByEmail = new Map<string, Types.ObjectId>();
  if (emails.length > 0) {
    // 分批查询，避免 $in 数组过大；并入可见范围，业务员只与「自己名下客户」判重
    const CHUNK = 500;
    for (let i = 0; i < emails.length; i += CHUNK) {
      const chunk = [...new Set(emails.slice(i, i + CHUNK))];
      const docs = await Customer.find({ email: { $in: chunk }, ...customerScope(actor) })
        .select({ _id: 1, email: 1 })
        .lean();
      (docs as unknown as { _id: Types.ObjectId; email: string }[]).forEach((d) =>
        existingByEmail.set(String(d.email).toLowerCase(), d._id),
      );
    }
  }

  // 2) 逐行判定：新增 / 更新 / 跳过；同时处理「批次内重复」
  const seenInBatch = new Map<string, number>(); // key -> 首次出现的行号

  validRows.forEach(({ row, index }) => {
    const label: RowLabel = { row: rowLabel(row, index), name: row.name, email: row.email };
    const email = row.email?.toLowerCase();
    const dedupeKey = email ?? `${row.name}__${row.company ?? ''}__${row.phone ?? ''}`.toLowerCase();

    if (seenInBatch.has(dedupeKey)) {
      failures.push({ ...label, reason: `与第 ${seenInBatch.get(dedupeKey)} 行数据重复，已跳过` });
      return;
    }
    seenInBatch.set(dedupeKey, label.row as number);

    const existingId = email ? existingByEmail.get(email) : undefined;

    if (existingId) {
      if (onDuplicate === 'update') {
        toUpdate.push({
          id: existingId,
          patch: buildPatchFromRow(row, defaultStatus),
          label,
        });
      } else {
        failures.push({ ...label, reason: '邮箱已存在于客户库（策略：跳过）' });
      }
      return;
    }

    toInsert.push({
      ...buildPatchFromRow(row, defaultStatus),
      projectId: requireProjectId(actor),
      source: 'excel' as CustomerSource,
      createdBy: actor ? new Types.ObjectId(actor.id) : undefined,
      // 严格分配制：业务员导入的客户直接归自己名下
      ...(actor && !isAdmin(actor) ? { ownerId: new Types.ObjectId(actor.id) } : {}),
    });
  });

  if (dryRun) {
    return {
      total: customers.length,
      created: toInsert.length,
      updated: toUpdate.length,
      skipped: failures.length,
      failures,
      dryRun: true,
    };
  }

  // 3) 落库。ordered:false 让单条失败不影响其余数据
  let created = 0;
  if (toInsert.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      try {
        const docs = await Customer.insertMany(chunk as AnyKeys<ICustomer>[], { ordered: false });
        created += Array.isArray(docs) ? docs.length : 0;
      } catch (error) {
        // insertMany(ordered:false) 抛出的 AggregateError 上挂着 writeErrors
        const writeErrors = (error as { writeErrors?: { index: number; errmsg?: string }[] }).writeErrors;
        if (writeErrors?.length) {
          writeErrors.forEach((we) => {
            const failedRow = chunk[we.index];
            failures.push({
              name: failedRow?.name,
              email: failedRow?.email,
              reason: we.errmsg ?? '写入失败',
            });
          });
          created += chunk.length - writeErrors.length;
        } else {
          // 非批量写入错误（如连接中断）：整批标记失败并中断
          const message = error instanceof Error ? error.message : String(error);
          chunk.forEach((row) => failures.push({ name: row.name, email: row.email, reason: message }));
          logger.error('批量导入中断', message);
          break;
        }
      }
    }
  }

  // 4) 更新已存在的客户
  let updated = 0;
  if (toUpdate.length > 0) {
    const ops = toUpdate.map((item) => ({
      updateOne: {
        filter: { _id: item.id, ...projectScope(actor) },
        update: { $set: item.patch },
      },
    }));
    try {
      const result = await Customer.bulkWrite(ops, { ordered: false });
      updated = result.modifiedCount ?? 0;
      // matched 但未 modify 的（内容完全一致）也算成功处理，不计入 failures
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toUpdate.forEach((item) => failures.push({ ...item.label, reason: message }));
      logger.error('批量更新失败', message);
    }
  }

  const result: ImportResult = {
    total: customers.length,
    created,
    updated,
    skipped: failures.length,
    failures: failures.slice(0, 100), // 最多回传 100 条错误，避免响应体过大
    dryRun: false,
  };

  logger.info(
    `Excel 导入完成: 提交 ${result.total} 条，新增 ${result.created}，更新 ${result.updated}，跳过/失败 ${result.skipped}`,
  );
  return result;
}

/** 把导入行转换成模型 patch（去掉空值、统一状态） */
function buildPatchFromRow(row: ImportRow, defaultStatus: CustomerStatus): Partial<ICustomer> {
  const patch: Partial<ICustomer> = { status: row.status ?? defaultStatus };
  const fields: (keyof ImportRow)[] = [
    'name',
    'company',
    'email',
    'phone',
    'title',
    'industry',
    'address',
    'country',
    'website',
    'grade',
    'notes',
    // 联系渠道
    'whatsapp',
    'skype',
    'linkedin',
    'facebook',
    'instagram',
    // 客户产品 / 需求信息
    'interestedProducts',
    'productModel',
    'productCategory',
    'expectedQuantity',
    'targetPrice',
    'moq',
    'requirementNotes',
    // 业务来源（自由字符串）
    'leadSource',
  ];
  fields.forEach((field) => {
    const value = row[field];
    if (typeof value === 'string' && value.trim() !== '') {
      // 上面 fields 都是字符串字段，断言安全
      (patch as Record<string, unknown>)[field] = value.trim();
    }
  });
  // 优先级已在导入校验层归一化为 high/medium/low，这里直接透传
  if (row.priority) patch.priority = row.priority;
  if (row.tags && row.tags.length > 0) patch.tags = row.tags;
  return patch;
}

/* ------------------------------------------------------------------ */
/* 导出 / 统计                                                         */
/* ------------------------------------------------------------------ */

/** 导出用：不分页拉取（有硬上限保护） */
export async function exportCustomers(query: ListCustomersQuery, actor?: AuthUser, hardLimit = 20000): Promise<ICustomer[]> {
  const filter = { ...buildCustomerFilter(query), ...customerScope(actor) };
  const docs = await Customer.find(filter).sort({ updatedAt: -1 }).limit(hardLimit).lean();
  return docs as unknown as ICustomer[];
}

export interface CustomerStats {
  total: number;
  pending: number;
  /** 向后兼容：离开「待开发」状态的客户数（= total - pending） */
  developed: number;
  withEmail: number;
  withoutEmail: number;
  contacted7d: number;
  byIndustry: { _id: string; count: number }[];
  byGrade: { _id: string; count: number }[];
  /** 8 种销售状态各自的数量，供 Dashboard 漏斗 / 分布使用 */
  byStatus: Record<CustomerStatus, number>;
}

/** 仪表盘统计数据（若干 aggregation + countDocuments 并行） */
export async function getCustomerStats(actor?: AuthUser): Promise<CustomerStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  // 严格分配制：业务员的仪表盘只统计自己名下客户
  const scope = customerScope(actor);

  const [total, withEmail, contacted7d, byIndustry, byGrade, statusRows] = await Promise.all([
    Customer.countDocuments({ ...scope }),
    Customer.countDocuments({ ...scope, email: { $exists: true, $nin: [null, ''] } }),
    Customer.countDocuments({ ...scope, lastContactAt: { $gte: sevenDaysAgo } }),
    Customer.aggregate<{ _id: string; count: number }>([
      { $match: { ...scope, industry: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: '$industry', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    Customer.aggregate<{ _id: string; count: number }>([
      { $match: { ...scope, grade: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: '$grade', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
    Customer.aggregate<{ _id: string; count: number }>([{ $match: { ...scope } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  // 按 8 种状态归零初始化，再填入聚合结果（避免前端拿到缺字段）
  const byStatus = CUSTOMER_STATUS.reduce(
    (acc, status) => {
      acc[status] = 0;
      return acc;
    },
    {} as Record<CustomerStatus, number>,
  );
  statusRows.forEach((row) => {
    if (row._id && (CUSTOMER_STATUS as readonly string[]).includes(row._id)) {
      byStatus[row._id as CustomerStatus] = row.count;
    }
  });

  const pending = byStatus.pending;
  // 「已开发」向后兼容：离开「待开发」即视为已开发，供旧仪表盘 / 开发率继续使用
  const developed = Math.max(0, total - pending);

  return {
    total,
    pending,
    developed,
    withEmail,
    withoutEmail: total - withEmail,
    contacted7d,
    byIndustry,
    byGrade,
    byStatus,
  };
}

/** 获取去重后的行业列表，供前端筛选下拉使用 */
export async function listIndustries(actor?: AuthUser): Promise<string[]> {
  const rows = (await Customer.distinct('industry', customerScope(actor))) as unknown[];
  return rows
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** 获取去重后的标签列表，作为「可复用系统标签」词汇表供前端下拉与筛选 */
export async function listTags(actor?: AuthUser): Promise<string[]> {
  const rows = (await Customer.distinct('tags', customerScope(actor))) as unknown[];
  return rows
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** 负责人下拉选项（复用 User 集合；单用户环境下即为 admin） */
export interface OwnerOption {
  id: string;
  name: string;
  username: string;
}

export async function listOwners(actor?: AuthUser): Promise<OwnerOption[]> {
  const projectId = requireProjectId(actor);
  const users = await User.find({ status: { $ne: 'disabled' }, $or: [{ role: 'admin' }, { projectIds: projectId }] }).sort({ createdAt: 1 }).lean();
  return (users as unknown as { _id: Types.ObjectId; username: string; displayName?: string }[]).map((u) => ({
    id: u._id.toString(),
    name: u.displayName?.trim() || u.username,
    username: u.username,
  }));
}

/**
 * 兼容迁移：把历史数据的旧状态值 'developed' 改写为 'contacted'。
 * 服务启动时调用一次；updateMany 默认不跑 enum 校验，可安全改写旧值。
 */
export async function migrateLegacyCustomerStatus(): Promise<number> {
  const result = await Customer.updateMany({ status: 'developed' }, { $set: { status: 'contacted' } });
  const modified = result.modifiedCount ?? 0;
  if (modified > 0) {
    logger.info(`兼容迁移：已将 ${modified} 个旧「developed」客户状态迁移为「contacted」`);
  }
  return modified;
}
