/**
 * 仪表盘「销售工作区」聚合
 * ------------------------------------------------------------------
 * 面向销售日常动作：今天要跟进谁、谁已逾期、今天发了几封信、加了几个客户、
 * 最近跟进 / 开发了哪些客户。全部为只读聚合，供 GET /api/stats/overview 使用。
 *
 * 跟进时间的「今天 / 已逾期 / 未来」口径与客户列表筛选完全一致：
 * 以本地时区「今天 0 点」为分界（见 customer.service.buildCustomerFilter），
 * 保证 Dashboard 的数字和点进列表看到的结果对得上。
 */
import { Customer, DevelopmentLetter, FollowUp, type CustomerDocument } from '../models';
import type { CustomerStatus, FollowUpMethod, FollowUpResult } from '../constants';
import { customerRefScope, customerScope } from '../utils/access';
import type { AuthUser } from '../types/express';

/** 工作区里可点击跳转的客户摘要（只取列表 / 卡片需要的字段） */
export interface CustomerBrief {
  id: string;
  name: string;
  company?: string;
  status: CustomerStatus;
  grade?: string;
  nextFollowUpAt?: Date | null;
  createdAt: Date;
}

/** 最近跟进记录（带客户名，便于在 Dashboard 直接展示） */
export interface RecentFollowUpItem {
  id: string;
  customerId: string;
  customerName: string;
  customerCompany?: string;
  method: FollowUpMethod;
  result: FollowUpResult;
  content: string;
  followUpAt: Date;
}

export interface SalesWorkspace {
  /** 今日待跟进客户数 */
  followUpToday: number;
  /** 已逾期客户数 */
  followUpOverdue: number;
  /** 未来（即将跟进）客户数 */
  followUpUpcoming: number;
  /** 今日新增客户数 */
  newCustomersToday: number;
  /** 今日发送开发信数 */
  lettersSentToday: number;
  /** 已逾期客户（最久逾期在前，最多 8 位） */
  overdueCustomers: CustomerBrief[];
  /** 今日待跟进客户（最多 8 位） */
  todayFollowUpCustomers: CustomerBrief[];
  /** 最近跟进记录（最多 6 条） */
  recentFollowUps: RecentFollowUpItem[];
  /** 最近开发（新增）客户（最多 6 位） */
  recentCustomers: CustomerBrief[];
}

/** 工作区客户摘要只查这几列，减小投影 */
const BRIEF_FIELDS = 'name company status grade nextFollowUpAt createdAt';

function toBrief(doc: CustomerDocument): CustomerBrief {
  return {
    id: doc.id,
    name: doc.name,
    company: doc.company,
    status: doc.status,
    grade: doc.grade,
    nextFollowUpAt: doc.nextFollowUpAt ?? null,
    createdAt: doc.createdAt,
  };
}

/** 汇总销售工作区所需的全部只读数据（尽量并行） */
export async function getSalesWorkspace(actor?: AuthUser): Promise<SalesWorkspace> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  // 严格分配制：业务员的工作区只覆盖自己名下客户（及其开发信 / 跟进）
  const scope = customerScope(actor);
  const refScope = await customerRefScope(actor);

  const [
    followUpToday,
    followUpOverdue,
    followUpUpcoming,
    newCustomersToday,
    lettersSentToday,
    overdueDocs,
    todayDocs,
    recentCustomerDocs,
    recentFollowUpDocs,
  ] = await Promise.all([
    Customer.countDocuments({ ...scope, nextFollowUpAt: { $gte: startOfToday, $lt: startOfTomorrow } }),
    Customer.countDocuments({ ...scope, nextFollowUpAt: { $lt: startOfToday } }),
    Customer.countDocuments({ ...scope, nextFollowUpAt: { $gte: startOfTomorrow } }),
    Customer.countDocuments({ ...scope, createdAt: { $gte: startOfToday } }),
    DevelopmentLetter.countDocuments({ ...refScope, status: 'sent', sentAt: { $gte: startOfToday } }),
    // 逾期：越早的越紧急，升序排在最前
    Customer.find({ ...scope, nextFollowUpAt: { $lt: startOfToday } })
      .select(BRIEF_FIELDS)
      .sort({ nextFollowUpAt: 1 })
      .limit(8),
    Customer.find({ ...scope, nextFollowUpAt: { $gte: startOfToday, $lt: startOfTomorrow } })
      .select(BRIEF_FIELDS)
      .sort({ nextFollowUpAt: 1 })
      .limit(8),
    Customer.find({ ...scope }).select(BRIEF_FIELDS).sort({ createdAt: -1 }).limit(6),
    FollowUp.find({ ...refScope }).sort({ followUpAt: -1, createdAt: -1 }).limit(6),
  ]);

  // 跟进记录补客户名：一次性批量查，避免 N+1
  const followUpCustomerIds = Array.from(new Set(recentFollowUpDocs.map((doc) => String(doc.customerId))));
  const followUpCustomers = followUpCustomerIds.length
    ? await Customer.find({ _id: { $in: followUpCustomerIds } }).select('name company').lean()
    : [];
  const customerMap = new Map(followUpCustomers.map((doc) => [String(doc._id), doc]));

  const recentFollowUps: RecentFollowUpItem[] = recentFollowUpDocs.map((doc) => {
    const customer = customerMap.get(String(doc.customerId));
    return {
      id: doc.id,
      customerId: String(doc.customerId),
      customerName: customer?.name ?? '（客户已删除）',
      customerCompany: customer?.company,
      method: doc.method,
      result: doc.result,
      content: doc.content,
      followUpAt: doc.followUpAt,
    };
  });

  return {
    followUpToday,
    followUpOverdue,
    followUpUpcoming,
    newCustomersToday,
    lettersSentToday,
    overdueCustomers: overdueDocs.map(toBrief),
    todayFollowUpCustomers: todayDocs.map(toBrief),
    recentFollowUps,
    recentCustomers: recentCustomerDocs.map(toBrief),
  };
}
