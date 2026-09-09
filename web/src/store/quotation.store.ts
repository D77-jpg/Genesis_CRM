/**
 * 客户报价单状态（Zustand，V2 报价管理）
 * ------------------------------------------------------------------
 * 详情页级别的数据：按 customerId 拉取报价单列表，并封装增 / 改 / 改状态 / 删。
 * 与 followup.store / attachment.store 一样自成一域，切换客户时 reset，避免串数据。
 *
 * 金额可信性：items[].amount 与 totalAmount 一律由后端计算，前端提交时不带金额，
 * 因此每次写操作成功后都重新拉取列表，展示后端权威的编号 / 金额 / 状态。
 *
 * 写失败时原样抛出 ApiClientError（而非包一层 Error），
 * 以便弹窗读取字段级 details（如「报价单编号已存在」409）做逐项提示。
 */
import { create } from 'zustand';
import { apiDelete, apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import type {
  DeleteQuotationResult,
  Quotation,
  QuotationInput,
  QuotationStatusInput,
} from '@/types';

interface QuotationState {
  /** 当前持有数据的客户 id */
  customerId: string | null;
  quotations: Quotation[];
  loading: boolean;
  /** 写操作进行中（新增 / 编辑 / 改状态 / 删除），用于按钮 loading */
  mutating: boolean;
  error: string | null;

  fetchQuotations: (customerId: string) => Promise<void>;
  createQuotation: (customerId: string, input: QuotationInput) => Promise<Quotation>;
  updateQuotation: (customerId: string, quotationId: string, input: QuotationInput) => Promise<Quotation>;
  updateQuotationStatus: (customerId: string, quotationId: string, input: QuotationStatusInput) => Promise<Quotation>;
  deleteQuotation: (customerId: string, quotationId: string) => Promise<boolean>;
  reset: () => void;
}

export const useQuotationStore = create<QuotationState>()((set, get) => ({
  customerId: null,
  quotations: [],
  loading: false,
  mutating: false,
  error: null,

  async fetchQuotations(customerId) {
    set({ customerId, loading: true, error: null });
    try {
      const data = await apiGet<Quotation[]>(`/customers/${customerId}/quotations`);
      set({ quotations: Array.isArray(data) ? data : [], loading: false });
    } catch (error) {
      set({ quotations: [], loading: false, error: toErrorMessage(error, '报价单加载失败') });
    }
  },

  async createQuotation(customerId, input) {
    set({ mutating: true, error: null });
    try {
      const quotation = await apiPost<Quotation>(`/customers/${customerId}/quotations`, input);
      set({ mutating: false });
      // 重新拉取：后端会生成编号、计算金额，并可能联动了客户状态，取最新列表最稳妥
      await get().fetchQuotations(customerId);
      return quotation;
    } catch (error) {
      set({ mutating: false });
      throw error;
    }
  },

  async updateQuotation(customerId, quotationId, input) {
    set({ mutating: true, error: null });
    try {
      const quotation = await apiPut<Quotation>(`/customers/${customerId}/quotations/${quotationId}`, input);
      set({ mutating: false });
      await get().fetchQuotations(customerId);
      return quotation;
    } catch (error) {
      set({ mutating: false });
      throw error;
    }
  },

  async updateQuotationStatus(customerId, quotationId, input) {
    set({ mutating: true, error: null });
    try {
      const quotation = await apiPut<Quotation>(
        `/customers/${customerId}/quotations/${quotationId}/status`,
        input,
      );
      set({ mutating: false });
      await get().fetchQuotations(customerId);
      return quotation;
    } catch (error) {
      set({ mutating: false });
      throw error;
    }
  },

  async deleteQuotation(customerId, quotationId) {
    set({ mutating: true, error: null });
    try {
      await apiDelete<DeleteQuotationResult>(`/customers/${customerId}/quotations/${quotationId}`);
      set({
        mutating: false,
        quotations: get().quotations.filter((item) => item.id !== quotationId),
      });
      return true;
    } catch (error) {
      set({ mutating: false });
      throw error;
    }
  },

  reset: () =>
    set({
      customerId: null,
      quotations: [],
      loading: false,
      mutating: false,
      error: null,
    }),
}));
