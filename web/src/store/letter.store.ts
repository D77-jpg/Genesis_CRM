/**
 * 开发信状态（Zustand）
 * ------------------------------------------------------------------
 * 同时服务两个场景：
 *  1. 「开发信记录」页的全量列表（筛选 / 分页 / 批量删除）
 *  2. 客户详情页的发送 / 重发 / 删除动作（只借用 action，不共享列表数据）
 */
import { create } from 'zustand';
import { apiDelete, apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { DEFAULT_PAGE_SIZE, STORAGE_KEYS } from '@/constants';
import { readStorage, writeStorage } from '@/lib/utils';
import type {
  BulkDeleteLettersResult,
  DevelopmentLetter,
  LetterListQuery,
  LetterStatus,
  MailChannel,
  Paginated,
  RenderedLetter,
  ResendLetterPayload,
  SendLetterPayload,
  SendLetterResult,
} from '@/types';

export type LetterSortField = 'sentAt' | 'createdAt' | 'subject' | 'status';

interface LetterQueryState {
  search: string;
  status: LetterStatus | 'all';
  channel: MailChannel | 'all';
  page: number;
  limit: number;
  sortBy: LetterSortField;
  sortOrder: 'asc' | 'desc';
}

interface LetterState extends LetterQueryState {
  items: DevelopmentLetter[];
  total: number;
  totalPages: number;
  loading: boolean;
  /** 发送 / 重发 / 删除进行中 */
  sending: boolean;
  error: string | null;
  selectedIds: string[];

  setFilters: (patch: Partial<Pick<LetterQueryState, 'search' | 'status' | 'channel'>>) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSorting: (sortBy: LetterSortField) => void;
  resetFilters: () => void;
  buildQuery: () => LetterListQuery;

  fetchList: () => Promise<void>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: (ids: string[]) => void;
  clearSelection: () => void;

  /* 动作 */
  sendLetter: (payload: SendLetterPayload) => Promise<SendLetterResult>;
  resendLetter: (letterId: string, payload?: ResendLetterPayload) => Promise<SendLetterResult>;
  previewLetter: (customerId: string, subject: string, content: string, recipientEmail?: string) => Promise<RenderedLetter>;
  deleteLetter: (id: string) => Promise<void>;
  bulkDelete: (ids: string[]) => Promise<BulkDeleteLettersResult | null>;
}

const initialQuery: LetterQueryState = {
  search: '',
  status: 'all',
  channel: 'all',
  page: 1,
  limit: readStorage<number>(STORAGE_KEYS.pageSize, DEFAULT_PAGE_SIZE),
  sortBy: 'sentAt',
  sortOrder: 'desc',
};

export const useLetterStore = create<LetterState>()((set, get) => ({
  ...initialQuery,
  items: [],
  total: 0,
  totalPages: 0,
  loading: false,
  sending: false,
  error: null,
  selectedIds: [],

  setFilters: (patch) => set({ ...patch, page: 1 }),

  setPage: (page) => set({ page: Math.max(1, page) }),

  setLimit: (limit) => {
    writeStorage(STORAGE_KEYS.pageSize, limit);
    set({ limit, page: 1 });
  },

  setSorting: (sortBy) => {
    const state = get();
    set({
      sortBy,
      sortOrder: state.sortBy === sortBy && state.sortOrder === 'desc' ? 'asc' : 'desc',
      page: 1,
    });
  },

  resetFilters: () => set({ ...initialQuery, limit: get().limit }),

  buildQuery: () => {
    const state = get();
    const query: LetterListQuery = {
      page: state.page,
      limit: state.limit,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };
    if (state.search.trim()) query.search = state.search.trim();
    if (state.status !== 'all') query.status = state.status;
    if (state.channel !== 'all') query.channel = state.channel;
    return query;
  },

  async fetchList() {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<Paginated<DevelopmentLetter>>('/letters', { params: get().buildQuery() });
      const items = data.items ?? [];
      set({
        items,
        total: data.total ?? 0,
        totalPages: data.totalPages ?? 0,
        loading: false,
        selectedIds: get().selectedIds.filter((id) => items.some((item) => item.id === id)),
      });
    } catch (error) {
      set({ items: [], total: 0, totalPages: 0, loading: false, error: toErrorMessage(error, '开发信记录加载失败') });
    }
  },

  toggleSelect: (id) => {
    const selected = get().selectedIds;
    set({ selectedIds: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] });
  },

  toggleSelectAll: (ids) => {
    const selected = new Set(get().selectedIds);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    if (allSelected) ids.forEach((id) => selected.delete(id));
    else ids.forEach((id) => selected.add(id));
    set({ selectedIds: Array.from(selected) });
  },

  clearSelection: () => set({ selectedIds: [] }),

  /* ---------------------------- 动作 ---------------------------- */

  async sendLetter(payload) {
    set({ sending: true });
    try {
      // 走嵌套路由，customerId 由路径提供，语义更清晰
      const url = payload.customerId ? `/customers/${payload.customerId}/letters` : '/letters';
      return await apiPost<SendLetterResult>(url, payload);
    } catch (error) {
      throw new Error(toErrorMessage(error, '开发信发送失败'));
    } finally {
      set({ sending: false });
    }
  },

  async resendLetter(letterId, payload = {}) {
    set({ sending: true });
    try {
      return await apiPost<SendLetterResult>(`/letters/${letterId}/resend`, payload);
    } catch (error) {
      throw new Error(toErrorMessage(error, '重新发送失败'));
    } finally {
      set({ sending: false });
    }
  },

  async previewLetter(customerId, subject, content, recipientEmail) {
    return apiPost<RenderedLetter>('/letters/preview', { customerId, subject, content, recipientEmail });
  },

  async deleteLetter(id) {
    set({ sending: true });
    try {
      await apiDelete<{ id: string }>(`/letters/${id}`);
      set({
        items: get().items.filter((item) => item.id !== id),
        total: Math.max(0, get().total - 1),
        selectedIds: get().selectedIds.filter((item) => item !== id),
      });
    } catch (error) {
      throw new Error(toErrorMessage(error, '删除开发信失败'));
    } finally {
      set({ sending: false });
    }
  },

  async bulkDelete(ids) {
    if (ids.length === 0) return null;
    set({ sending: true });
    try {
      const result = await apiPost<BulkDeleteLettersResult>('/letters/bulk/delete', { ids });
      set({ selectedIds: [] });
      await get().fetchList();
      return result;
    } catch (error) {
      throw new Error(toErrorMessage(error, '批量删除开发信失败'));
    } finally {
      set({ sending: false });
    }
  },
}));
