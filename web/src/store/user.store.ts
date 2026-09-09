/**
 * 用户管理状态（Zustand）
 * ------------------------------------------------------------------
 * 仅管理员可访问：用户列表 + 新建 / 编辑资料 / 重置密码 / 停用启用 / 删除账号。
 * 用户数量通常不大，一次拉全量，不做分页与本地过滤。
 * 写操作成功后就地更新 items（替换 / 移除），无需整表重拉。
 */
import { create } from 'zustand';
import { apiDelete, apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import type { CreateUserInput, UpdateUserInput, UserDto, UserStatus } from '@/types';

interface UserState {
  items: UserDto[];
  loading: boolean;
  /** 写操作进行中（新建） */
  mutating: boolean;
  error: string | null;

  fetchList: () => Promise<void>;
  createUser: (input: CreateUserInput) => Promise<UserDto | null>;
  updateUser: (id: string, input: UpdateUserInput) => Promise<UserDto | null>;
  resetPassword: (id: string, password: string) => Promise<void>;
  setStatus: (id: string, status: UserStatus) => Promise<UserDto | null>;
  deleteUser: (id: string) => Promise<{ id: string; reassignedCustomers: number } | null>;
}

export const useUserStore = create<UserState>()((set, get) => ({
  items: [],
  loading: false,
  mutating: false,
  error: null,

  async fetchList() {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<UserDto[]>('/users');
      set({ items: Array.isArray(data) ? data : [], loading: false });
    } catch (error) {
      set({ items: [], loading: false, error: toErrorMessage(error, '用户列表加载失败') });
    }
  },

  async createUser(input) {
    set({ mutating: true, error: null });
    try {
      const created = await apiPost<UserDto>('/users', input);
      // 后端列表按 createdAt 升序，新建的用户排在末尾，这里本地追加保持一致
      set({ mutating: false, items: [...get().items, created] });
      return created;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '新建用户失败'));
    }
  },

  async updateUser(id, input) {
    set({ mutating: true, error: null });
    try {
      const updated = await apiPut<UserDto>(`/users/${id}`, input);
      set({ mutating: false, items: get().items.map((u) => (u.id === id ? updated : u)) });
      return updated;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '更新用户失败'));
    }
  },

  async resetPassword(id, password) {
    set({ mutating: true, error: null });
    try {
      await apiPut<{ id: string }>(`/users/${id}/password`, { password });
      set({ mutating: false });
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '重置密码失败'));
    }
  },

  async setStatus(id, status) {
    set({ mutating: true, error: null });
    try {
      const updated = await apiPut<UserDto>(`/users/${id}/status`, { status });
      set({ mutating: false, items: get().items.map((u) => (u.id === id ? updated : u)) });
      return updated;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, status === 'disabled' ? '停用失败' : '启用失败'));
    }
  },

  async deleteUser(id) {
    set({ mutating: true, error: null });
    try {
      const result = await apiDelete<{ id: string; reassignedCustomers: number }>(`/users/${id}`);
      set({ mutating: false, items: get().items.filter((u) => u.id !== id) });
      return result;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '删除用户失败'));
    }
  },
}));
