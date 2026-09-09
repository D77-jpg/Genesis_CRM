/**
 * 列表数据订阅 Hook
 * ------------------------------------------------------------------
 * store 只保存查询条件，真正的请求由这里的 useEffect 触发：
 * 条件变化 → 拉数据，避免在多个 action 里各写一次 fetch 造成重复请求。
 */
import { useEffect } from 'react';
import { apiGet } from '@/lib/api';
import { useAsync } from './use-async';
import { useCustomerStore } from '@/store/customer.store';
import { useLetterStore } from '@/store/letter.store';
import { selectIsAdmin, useAuthStore } from '@/store/auth.store';
import type { Customer, DevelopmentLetter, OverviewStats, Paginated } from '@/types';

/** 客户列表页：条件变化时自动拉取 */
export function useCustomerList(): void {
  const search = useCustomerStore((state) => state.search);
  const status = useCustomerStore((state) => state.status);
  const industry = useCustomerStore((state) => state.industry);
  const grade = useCustomerStore((state) => state.grade);
  const leadSource = useCustomerStore((state) => state.leadSource);
  const priority = useCustomerStore((state) => state.priority);
  const hasEmail = useCustomerStore((state) => state.hasEmail);
  const tag = useCustomerStore((state) => state.tag);
  const ownerId = useCustomerStore((state) => state.ownerId);
  const followUp = useCustomerStore((state) => state.followUp);
  const page = useCustomerStore((state) => state.page);
  const limit = useCustomerStore((state) => state.limit);
  const sortBy = useCustomerStore((state) => state.sortBy);
  const sortOrder = useCustomerStore((state) => state.sortOrder);
  const fetchList = useCustomerStore((state) => state.fetchList);

  useEffect(() => {
    void fetchList();
  }, [search, status, industry, grade, leadSource, priority, hasEmail, tag, ownerId, followUp, page, limit, sortBy, sortOrder, fetchList]);
}

/** 开发信记录页：条件变化时自动拉取 */
export function useLetterList(): void {
  const search = useLetterStore((state) => state.search);
  const status = useLetterStore((state) => state.status);
  const channel = useLetterStore((state) => state.channel);
  const page = useLetterStore((state) => state.page);
  const limit = useLetterStore((state) => state.limit);
  const sortBy = useLetterStore((state) => state.sortBy);
  const sortOrder = useLetterStore((state) => state.sortOrder);
  const fetchList = useLetterStore((state) => state.fetchList);

  useEffect(() => {
    void fetchList();
  }, [search, status, channel, page, limit, sortBy, sortOrder, fetchList]);
}

/** 行业下拉数据（只在客户页首次进入时拉一次） */
export function useIndustries(): void {
  const fetchIndustries = useCustomerStore((state) => state.fetchIndustries);
  useEffect(() => {
    void fetchIndustries();
  }, [fetchIndustries]);
}

/** 标签词汇表（客户页首次进入时拉一次） */
export function useTags(): void {
  const fetchTags = useCustomerStore((state) => state.fetchTags);
  useEffect(() => {
    void fetchTags();
  }, [fetchTags]);
}

/** 负责人下拉数据（仅管理员：用于分配客户 / 负责人筛选，业务员无此 UI 也无需全量用户） */
export function useOwners(): void {
  const isAdmin = useAuthStore(selectIsAdmin);
  const fetchOwners = useCustomerStore((state) => state.fetchOwners);
  useEffect(() => {
    if (isAdmin) void fetchOwners();
  }, [isAdmin, fetchOwners]);
}

/* ------------------------------------------------------------------ */
/* 详情页级别的独立数据（不进 store，避免与列表页状态互相干扰）           */
/* ------------------------------------------------------------------ */

export interface CustomerLettersQuery {
  page: number;
  limit: number;
  search?: string;
}

/** 客户详情 */
export function useCustomer(id: string | undefined) {
  return useAsync<Customer>(
    async () => {
      if (!id) throw new Error('缺少客户 ID');
      return apiGet<Customer>(`/customers/${id}`);
    },
    [id],
    { immediate: Boolean(id), fallbackMessage: '客户信息加载失败' },
  );
}

/** 某客户的开发信历史 */
export function useCustomerLetters(id: string | undefined, query: CustomerLettersQuery) {
  const { page, limit, search } = query;
  return useAsync<Paginated<DevelopmentLetter>>(
    async () => {
      if (!id) throw new Error('缺少客户 ID');
      return apiGet<Paginated<DevelopmentLetter>>(`/customers/${id}/letters`, {
        params: { page, limit, sortBy: 'sentAt', sortOrder: 'desc', ...(search ? { search } : {}) },
      });
    },
    [id, page, limit, search],
    { immediate: Boolean(id), fallbackMessage: '开发信记录加载失败' },
  );
}

/** 仪表盘总览统计 */
export function useOverviewStats() {
  return useAsync<OverviewStats>(() => apiGet<OverviewStats>('/stats/overview'), [], {
    fallbackMessage: '统计数据加载失败',
  });
}
