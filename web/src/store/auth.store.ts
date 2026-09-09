/**
 * 登录态
 * ------------------------------------------------------------------
 * - Token 持久化在 localStorage，刷新页面后通过 GET /auth/me 恢复用户信息
 * - 401 时由 lib/api.ts 回调 handleSessionExpired，避免 api 层反向依赖 store
 */
import { create } from 'zustand';
import { apiGet, apiPost, getToken, setUnauthorizedHandler, toErrorMessage } from '@/lib/api';
import { STORAGE_KEYS } from '@/constants';
import { removeStorage, writeStorage } from '@/lib/utils';
import type { AuthUser, LoginResult } from '@/types';

export type AuthStatus = 'idle' | 'bootstrapping' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  status: AuthStatus;
  /** 首屏恢复登录态是否已结束（路由守卫据此决定是否显示 loading） */
  initialized: boolean;
  /** 登录请求进行中 */
  loggingIn: boolean;
  loginError: string | null;

  login: (username: string, password: string) => Promise<boolean>;
  logout: (options?: { silent?: boolean }) => void;
  bootstrap: () => Promise<void>;
  handleSessionExpired: () => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  token: getToken(),
  status: getToken() ? 'idle' : 'unauthenticated',
  initialized: false,
  loggingIn: false,
  loginError: null,

  async login(username, password) {
    set({ loggingIn: true, loginError: null });
    try {
      const result = await apiPost<LoginResult>('/auth/login', { username, password });
      writeStorage(STORAGE_KEYS.token, result.token);
      set({
        user: result.user,
        token: result.token,
        status: 'authenticated',
        initialized: true,
        loggingIn: false,
        loginError: null,
      });
      return true;
    } catch (error) {
      set({ loggingIn: false, loginError: toErrorMessage(error, '登录失败，请检查用户名与密码') });
      return false;
    }
  },

  logout({ silent = false } = {}) {
    removeStorage(STORAGE_KEYS.token);
    set({
      user: null,
      token: null,
      status: 'unauthenticated',
      initialized: true,
      loggingIn: false,
      loginError: silent ? null : get().loginError,
    });
  },

  /** 应用启动时调用：有 token 就校验，没有就直接进入未登录态 */
  async bootstrap() {
    const token = getToken();
    if (!token) {
      set({ user: null, token: null, status: 'unauthenticated', initialized: true });
      return;
    }

    set({ status: 'bootstrapping', token });
    try {
      const user = await apiGet<AuthUser>('/auth/me');
      set({ user, status: 'authenticated', initialized: true });
    } catch {
      // token 过期或被篡改：静默清理，交给路由守卫跳登录页
      removeStorage(STORAGE_KEYS.token);
      set({ user: null, token: null, status: 'unauthenticated', initialized: true });
    }
  },

  handleSessionExpired() {
    if (get().status === 'unauthenticated') return;
    removeStorage(STORAGE_KEYS.token);
    set({ user: null, token: null, status: 'unauthenticated', initialized: true });
  },
}));

// 注册 401 处理器（只在模块加载时执行一次）
setUnauthorizedHandler(() => useAuthStore.getState().handleSessionExpired());

/** 便捷选择器 */
export const selectIsAuthenticated = (state: AuthState): boolean => state.status === 'authenticated';

/**
 * 当前登录用户是否管理员。
 * 角色化 UI 的依据：负责人分配 / 用户管理入口等仅管理员可见，
 * 业务员只看自己名下客户（后端已做数据隔离，前端隐藏相应操作即可）。
 */
export const selectIsAdmin = (state: AuthState): boolean => state.user?.role === 'admin';
