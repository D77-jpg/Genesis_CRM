/**
 * 客户跟进记录 / 时间线状态（Zustand）
 * ------------------------------------------------------------------
 * 详情页级别的数据：按 customerId 拉取跟进记录与聚合时间线，并封装写操作。
 * 与 customer.store（列表页）分离，避免两个页面的状态互相干扰。
 *
 * 说明：新增跟进时后端可能同步更新客户的 nextFollowUpAt，
 * 因此 createFollowUp 成功后会同时刷新跟进列表与时间线；
 * 客户档案本身的刷新由详情页负责（调用 useCustomer 的 run）。
 */
import { create } from 'zustand';
import { apiDelete, apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import type { CustomerTimeline, DeleteFollowUpResult, FollowUp, FollowUpInput } from '@/types';

interface FollowUpState {
  /** 当前持有数据的客户 id */
  customerId: string | null;
  followUps: FollowUp[];
  timeline: CustomerTimeline | null;
  loadingFollowUps: boolean;
  loadingTimeline: boolean;
  /** 写操作进行中（新增 / 删除），用于按钮 loading */
  mutating: boolean;
  error: string | null;

  fetchFollowUps: (customerId: string) => Promise<void>;
  fetchTimeline: (customerId: string) => Promise<void>;
  createFollowUp: (customerId: string, input: FollowUpInput) => Promise<FollowUp | null>;
  updateFollowUp: (customerId: string, followUpId: string, input: FollowUpInput) => Promise<FollowUp | null>;
  deleteFollowUp: (customerId: string, followUpId: string) => Promise<boolean>;
  reset: () => void;
}

export const useFollowUpStore = create<FollowUpState>()((set, get) => ({
  customerId: null,
  followUps: [],
  timeline: null,
  loadingFollowUps: false,
  loadingTimeline: false,
  mutating: false,
  error: null,

  async fetchFollowUps(customerId) {
    set({ customerId, loadingFollowUps: true, error: null });
    try {
      const data = await apiGet<FollowUp[]>(`/customers/${customerId}/follow-ups`);
      set({ followUps: Array.isArray(data) ? data : [], loadingFollowUps: false });
    } catch (error) {
      set({ followUps: [], loadingFollowUps: false, error: toErrorMessage(error, '跟进记录加载失败') });
    }
  },

  async fetchTimeline(customerId) {
    set({ customerId, loadingTimeline: true });
    try {
      const data = await apiGet<CustomerTimeline>(`/customers/${customerId}/timeline`);
      set({ timeline: data, loadingTimeline: false });
    } catch {
      // 时间线是辅助信息，失败时置空即可，不打断详情页其它部分
      set({ timeline: null, loadingTimeline: false });
    }
  },

  async createFollowUp(customerId, input) {
    set({ mutating: true, error: null });
    try {
      const followUp = await apiPost<FollowUp>(`/customers/${customerId}/follow-ups`, input);
      set({ mutating: false });
      // 跟进记录会进入时间线，且可能同步了客户的下一次跟进时间，两者都刷新
      await Promise.all([get().fetchFollowUps(customerId), get().fetchTimeline(customerId)]);
      return followUp;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '新增跟进记录失败'));
    }
  },

  async updateFollowUp(customerId, followUpId, input) {
    set({ mutating: true, error: null });
    try {
      const followUp = await apiPut<FollowUp>(`/customers/${customerId}/follow-ups/${followUpId}`, input);
      set({ mutating: false });
      // 编辑同样会改动时间线，且可能同步了客户的下一次跟进时间，两者都刷新
      await Promise.all([get().fetchFollowUps(customerId), get().fetchTimeline(customerId)]);
      return followUp;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '编辑跟进记录失败'));
    }
  },

  async deleteFollowUp(customerId, followUpId) {
    set({ mutating: true, error: null });
    try {
      await apiDelete<DeleteFollowUpResult>(`/customers/${customerId}/follow-ups/${followUpId}`);
      set({
        mutating: false,
        followUps: get().followUps.filter((item) => item.id !== followUpId),
      });
      // 时间线里也含这条跟进，后台刷新一次保持一致
      void get().fetchTimeline(customerId);
      return true;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '删除跟进记录失败'));
    }
  },

  reset: () =>
    set({
      customerId: null,
      followUps: [],
      timeline: null,
      loadingFollowUps: false,
      loadingTimeline: false,
      mutating: false,
      error: null,
    }),
}));
