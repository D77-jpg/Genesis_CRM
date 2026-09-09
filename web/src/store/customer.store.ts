/**
 * 客户列表状态（Zustand）
 * ------------------------------------------------------------------
 * 职责：
 *  - 持有筛选 / 分页 / 排序条件与列表数据
 *  - 封装所有写操作（新建、编辑、删除、批量、导入），成功后自动刷新列表
 *  - 维护表格的多选状态
 *
 * 数据获取策略：store 只负责「条件变更」，真正的请求由页面里的
 * useCustomerList() 监听条件变化后调用 fetchList()，避免重复请求。
 */
import { create } from 'zustand';
import { apiDelete, apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import { DEFAULT_PAGE_SIZE, STORAGE_KEYS } from '@/constants';
import { readStorage, writeStorage } from '@/lib/utils';
import type {
  BulkDeleteResult,
  BulkStatusResult,
  BulkUpdateResult,
  Customer,
  CustomerInput,
  CustomerListQuery,
  CustomerPriority,
  CustomerStatus,
  DeleteCustomerResult,
  FollowUpFilter,
  ImportPayload,
  ImportResult,
  OwnerOption,
  Paginated,
} from '@/types';

/** 邮箱筛选的三态：全部 / 有邮箱 / 无邮箱 */
export type HasEmailFilter = 'all' | 'yes' | 'no';

/** 可排序字段，需与后端 utils/pagination.ts 的白名单保持一致 */
export type CustomerSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'name'
  | 'company'
  | 'industry'
  | 'status'
  | 'letterCount'
  | 'lastContactAt'
  | 'nextFollowUpAt';

/** 负责人筛选的特殊值：全部 / 未分配（其余为具体用户 id） */
export const OWNER_FILTER_ALL = 'all';
export const OWNER_FILTER_UNASSIGNED = 'unassigned';

interface CustomerQueryState {
  search: string;
  status: CustomerStatus | 'all';
  industry: string;
  grade: string;
  /** 业务来源筛选（'' 表示不限） */
  leadSource: string;
  /** 跟进优先级筛选（'all' 表示不限） */
  priority: CustomerPriority | 'all';
  hasEmail: HasEmailFilter;
  /** 标签精确筛选（'' 表示不限） */
  tag: string;
  /** 负责人筛选：'all' / 'unassigned' / 具体用户 id */
  ownerId: string;
  /** 跟进时间筛选 */
  followUp: FollowUpFilter;
  page: number;
  limit: number;
  sortBy: CustomerSortField;
  sortOrder: 'asc' | 'desc';
}

interface CustomerState extends CustomerQueryState {
  items: Customer[];
  total: number;
  totalPages: number;
  loading: boolean;
  /** 写操作进行中（新建/编辑/删除/批量），用于按钮 loading */
  mutating: boolean;
  error: string | null;
  /** 当前页已勾选的客户 id */
  selectedIds: string[];
  /** 行业下拉数据 */
  industries: string[];
  /** 可复用标签词汇表（所有客户标签去重） */
  tags: string[];
  /** 负责人下拉数据（当前用户集合） */
  owners: OwnerOption[];

  /* 查询条件 */
  setFilters: (patch: Partial<Omit<CustomerQueryState, 'page' | 'limit' | 'sortBy' | 'sortOrder'>>) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSorting: (sortBy: CustomerSortField) => void;
  resetFilters: () => void;
  buildQuery: () => CustomerListQuery;

  /* 数据 */
  fetchList: () => Promise<void>;
  fetchIndustries: () => Promise<void>;
  fetchTags: () => Promise<void>;
  fetchOwners: () => Promise<void>;

  /* 选择 */
  toggleSelect: (id: string) => void;
  toggleSelectAll: (ids: string[]) => void;
  clearSelection: () => void;

  /* 写操作 */
  createCustomer: (input: CustomerInput) => Promise<Customer | null>;
  updateCustomer: (id: string, input: Partial<CustomerInput>) => Promise<Customer | null>;
  deleteCustomer: (id: string) => Promise<boolean>;
  bulkUpdateStatus: (ids: string[], status: CustomerStatus) => Promise<BulkStatusResult | null>;
  bulkDelete: (ids: string[]) => Promise<BulkDeleteResult | null>;
  /** 批量添加标签（自动去重） */
  bulkAddTags: (ids: string[], tags: string[]) => Promise<BulkUpdateResult | null>;
  /** 批量删除标签 */
  bulkRemoveTags: (ids: string[], tags: string[]) => Promise<BulkUpdateResult | null>;
  /** 批量分配负责人；ownerId 为 null 表示清除 */
  bulkAssignOwner: (ids: string[], ownerId: string | null) => Promise<BulkUpdateResult | null>;
  /** 批量设置下一次跟进时间（yyyy-MM-dd）；null 表示清除 */
  bulkSetFollowUp: (ids: string[], nextFollowUpAt: string | null) => Promise<BulkUpdateResult | null>;
  importCustomers: (payload: ImportPayload) => Promise<ImportResult | null>;
  /** 局部更新缓存，避免详情页返回列表时整表闪烁 */
  patchLocal: (id: string, patch: Partial<Customer>) => void;
}

const initialQuery: CustomerQueryState = {
  search: '',
  status: 'all',
  industry: '',
  grade: '',
  leadSource: '',
  priority: 'all',
  hasEmail: 'all',
  tag: '',
  ownerId: OWNER_FILTER_ALL,
  followUp: 'all',
  page: 1,
  limit: readStorage<number>(STORAGE_KEYS.pageSize, DEFAULT_PAGE_SIZE),
  sortBy: 'updatedAt',
  sortOrder: 'desc',
};

export const useCustomerStore = create<CustomerState>()((set, get) => ({
  ...initialQuery,
  items: [],
  total: 0,
  totalPages: 0,
  loading: false,
  mutating: false,
  error: null,
  selectedIds: [],
  industries: [],
  tags: [],
  owners: [],

  /* ---------------------------- 查询条件 ---------------------------- */

  setFilters: (patch) => set({ ...patch, page: 1, selectedIds: [] }),

  setPage: (page) => set({ page: Math.max(1, page) }),

  setLimit: (limit) => {
    writeStorage(STORAGE_KEYS.pageSize, limit);
    set({ limit, page: 1 });
  },

  setSorting: (sortBy) => {
    const state = get();
    // 再次点击同一列 → 反转排序方向
    set({
      sortBy,
      sortOrder: state.sortBy === sortBy && state.sortOrder === 'desc' ? 'asc' : 'desc',
      page: 1,
    });
  },

  resetFilters: () => set({ ...initialQuery, limit: get().limit, page: 1, selectedIds: [] }),

  /** 把 store 里的条件转成后端可接受的查询参数（去掉 all / 空值） */
  buildQuery: () => {
    const state = get();
    const query: CustomerListQuery = {
      page: state.page,
      limit: state.limit,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };
    if (state.search.trim()) query.search = state.search.trim();
    if (state.status !== 'all') query.status = state.status;
    if (state.industry) query.industry = state.industry;
    if (state.grade) query.grade = state.grade;
    if (state.leadSource) query.leadSource = state.leadSource.trim();
    if (state.priority !== 'all') query.priority = state.priority;
    if (state.hasEmail === 'yes') query.hasEmail = true;
    if (state.hasEmail === 'no') query.hasEmail = false;
    if (state.tag) query.tag = state.tag;
    if (state.ownerId && state.ownerId !== OWNER_FILTER_ALL) query.ownerId = state.ownerId;
    if (state.followUp !== 'all') query.followUp = state.followUp;
    return query;
  },

  /* ---------------------------- 数据 ---------------------------- */

  async fetchList() {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<Paginated<Customer>>('/customers', { params: get().buildQuery() });
      const items = data.items ?? [];
      set({
        items,
        total: data.total ?? 0,
        totalPages: data.totalPages ?? 0,
        loading: false,
        // 翻页后清掉不在当前页的选中项，避免「批量操作了看不见的行」
        selectedIds: get().selectedIds.filter((id) => items.some((item) => item.id === id)),
      });
    } catch (error) {
      set({ items: [], total: 0, totalPages: 0, loading: false, error: toErrorMessage(error, '客户列表加载失败') });
    }
  },

  async fetchIndustries() {
    try {
      const data = await apiGet<string[]>('/customers/industries');
      set({ industries: Array.isArray(data) ? data : [] });
    } catch {
      // 行业下拉是辅助信息，失败时保持为空即可
      set({ industries: [] });
    }
  },

  async fetchTags() {
    try {
      const data = await apiGet<string[]>('/customers/tags');
      set({ tags: Array.isArray(data) ? data : [] });
    } catch {
      // 标签词汇表是辅助信息，失败时保持为空即可
      set({ tags: [] });
    }
  },

  async fetchOwners() {
    try {
      const data = await apiGet<OwnerOption[]>('/customers/owners');
      set({ owners: Array.isArray(data) ? data : [] });
    } catch {
      // 负责人下拉是辅助信息，失败时保持为空即可
      set({ owners: [] });
    }
  },

  /* ---------------------------- 选择 ---------------------------- */

  toggleSelect: (id) => {
    const selected = get().selectedIds;
    set({
      selectedIds: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
    });
  },

  toggleSelectAll: (ids) => {
    const selected = new Set(get().selectedIds);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    if (allSelected) ids.forEach((id) => selected.delete(id));
    else ids.forEach((id) => selected.add(id));
    set({ selectedIds: Array.from(selected) });
  },

  clearSelection: () => set({ selectedIds: [] }),

  /* ---------------------------- 写操作 ---------------------------- */

  async createCustomer(input) {
    set({ mutating: true });
    try {
      const customer = await apiPost<Customer>('/customers', input);
      set({ mutating: false });
      // 新建可能引入新标签，同步刷新标签词汇表
      await Promise.all([get().fetchList(), get().fetchTags()]);
      return customer;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '新建客户失败'));
    }
  },

  async updateCustomer(id, input) {
    set({ mutating: true });
    try {
      const customer = await apiPut<Customer>(`/customers/${id}`, input);
      set({ mutating: false });
      get().patchLocal(id, customer);
      // 编辑可能增删标签，后台刷新词汇表（不阻塞保存）
      void get().fetchTags();
      return customer;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '保存客户信息失败'));
    }
  },

  async deleteCustomer(id) {
    set({ mutating: true });
    try {
      await apiDelete<DeleteCustomerResult>(`/customers/${id}`);
      set({
        mutating: false,
        items: get().items.filter((item) => item.id !== id),
        selectedIds: get().selectedIds.filter((item) => item !== id),
        total: Math.max(0, get().total - 1),
      });
      // 删掉当前页最后一条时往前翻一页，避免停在空白页
      const { page, totalPages, items } = get();
      if (items.length === 0 && page > 1) {
        set({ page: Math.min(page - 1, Math.max(1, totalPages)) });
      }
      return true;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '删除客户失败'));
    }
  },

  async bulkUpdateStatus(ids, status) {
    if (ids.length === 0) return null;
    set({ mutating: true });
    try {
      const result = await apiPost<BulkStatusResult>('/customers/bulk/status', { ids, status });
      // 乐观更新当前页，随后再拉一次保证与库一致
      set({
        mutating: false,
        items: get().items.map((item) => (ids.includes(item.id) ? { ...item, status } : item)),
        selectedIds: [],
      });
      await get().fetchList();
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '批量修改状态失败'));
    }
  },

  async bulkDelete(ids) {
    if (ids.length === 0) return null;
    set({ mutating: true });
    try {
      const result = await apiPost<BulkDeleteResult>('/customers/bulk/delete', { ids });
      set({ mutating: false, selectedIds: [] });
      await get().fetchList();
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '批量删除失败'));
    }
  },

  async bulkAddTags(ids, tags) {
    if (ids.length === 0 || tags.length === 0) return null;
    set({ mutating: true });
    try {
      const result = await apiPost<BulkUpdateResult>('/customers/bulk/tags/add', { ids, tags });
      // 乐观合并标签，随后重拉保证与库一致；标签变化会影响词汇表，同步刷新
      set({
        mutating: false,
        items: get().items.map((item) =>
          ids.includes(item.id) ? { ...item, tags: Array.from(new Set([...item.tags, ...tags])) } : item,
        ),
        selectedIds: [],
      });
      await Promise.all([get().fetchList(), get().fetchTags()]);
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '批量添加标签失败'));
    }
  },

  async bulkRemoveTags(ids, tags) {
    if (ids.length === 0 || tags.length === 0) return null;
    set({ mutating: true });
    try {
      const result = await apiPost<BulkUpdateResult>('/customers/bulk/tags/remove', { ids, tags });
      set({
        mutating: false,
        items: get().items.map((item) =>
          ids.includes(item.id) ? { ...item, tags: item.tags.filter((tag) => !tags.includes(tag)) } : item,
        ),
        selectedIds: [],
      });
      await Promise.all([get().fetchList(), get().fetchTags()]);
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '批量删除标签失败'));
    }
  },

  async bulkAssignOwner(ids, ownerId) {
    if (ids.length === 0) return null;
    set({ mutating: true });
    try {
      const result = await apiPost<BulkUpdateResult>('/customers/bulk/owner', { ids, ownerId });
      // 乐观更新 ownerId 与负责人摘要（名字取自已有的负责人词汇表）
      const matched = ownerId ? get().owners.find((owner) => owner.id === ownerId) ?? null : null;
      set({
        mutating: false,
        items: get().items.map((item) =>
          ids.includes(item.id)
            ? { ...item, ownerId, owner: matched ? { id: matched.id, name: matched.name } : null }
            : item,
        ),
        selectedIds: [],
      });
      await get().fetchList();
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '批量分配负责人失败'));
    }
  },

  async bulkSetFollowUp(ids, nextFollowUpAt) {
    if (ids.length === 0) return null;
    set({ mutating: true });
    try {
      const result = await apiPost<BulkUpdateResult>('/customers/bulk/follow-up', { ids, nextFollowUpAt });
      set({
        mutating: false,
        items: get().items.map((item) =>
          ids.includes(item.id) ? { ...item, nextFollowUpAt } : item,
        ),
        selectedIds: [],
      });
      await get().fetchList();
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '批量设置跟进时间失败'));
    }
  },

  async importCustomers(payload) {
    set({ mutating: true });
    try {
      const result = await apiPost<ImportResult>('/customers/import', payload);
      set({ mutating: false });
      // dryRun 只是预检，不刷新列表
      if (!payload.dryRun) {
        await Promise.all([get().fetchList(), get().fetchIndustries(), get().fetchTags()]);
      }
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, 'Excel 导入失败'));
    }
  },

  patchLocal: (id, patch) => {
    set({ items: get().items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  },
}));

/** 是否存在生效中的筛选条件（用于「清空筛选」按钮的显隐） */
export function selectHasActiveFilters(state: CustomerState): boolean {
  return (
    state.search.trim() !== '' ||
    state.status !== 'all' ||
    state.industry !== '' ||
    state.grade !== '' ||
    state.leadSource !== '' ||
    state.priority !== 'all' ||
    state.hasEmail !== 'all' ||
    state.tag !== '' ||
    state.ownerId !== OWNER_FILTER_ALL ||
    state.followUp !== 'all'
  );
}
