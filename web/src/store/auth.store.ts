/**
 * 登录态
 * ------------------------------------------------------------------
 * - Token 持久化在 localStorage，刷新页面后通过 GET /auth/me 恢复用户信息
 * - 401 时由 lib/api.ts 回调 handleSessionExpired，避免 api 层反向依赖 store
 */
import { create } from 'zustand';
import { apiGet, apiPost, getToken, setUnauthorizedHandler, toErrorMessage, ApiClientError } from '@/lib/api';
import { ROUTES, SCRATCHPAD_PENDING_PREFIX, STORAGE_KEYS } from '@/constants';
import { removeStorage, removeStorageByPrefix, writeStorage } from '@/lib/utils';
import type { AuthUser, LoginResult } from '@/types';
import { useProjectStore } from './project.store';

export type AuthStatus = 'idle' | 'bootstrapping' | 'authenticated' | 'unauthenticated';

/** 首屏恢复登录态遇瞬态错误（后端重启 / 网络抖动）时的重试参数，避免误掉登录 */
const BOOTSTRAP_RETRIES = 3;
const BOOTSTRAP_RETRY_DELAY = 1500;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    removeStorageByPrefix(SCRATCHPAD_PENDING_PREFIX);
    useProjectStore.getState().reset();
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
    for (let attempt = 0; attempt < BOOTSTRAP_RETRIES; attempt++) {
      try {
        const { user } = await apiGet<{ user: AuthUser }>('/auth/me');
        set({ user, status: 'authenticated', initialized: true });
        return;
      } catch (error) {
        const status = error instanceof ApiClientError ? error.status : 0;
        // 401/403：token 确实失效 → 静默清理，交给路由守卫跳登录页
        if (status === 401 || status === 403) {
          removeStorage(STORAGE_KEYS.token);
          removeStorageByPrefix(SCRATCHPAD_PENDING_PREFIX);
          set({ user: null, token: null, status: 'unauthenticated', initialized: true });
          return;
        }
        // 网络抖动 / 后端重启 / 5xx：token 可能仍有效，不销毁，稍后重试
        if (attempt < BOOTSTRAP_RETRIES - 1) await sleep(BOOTSTRAP_RETRY_DELAY);
      }
    }
    // 重试耗尽仍连不上：保留 localStorage 里的 token（服务恢复后刷新可免重输），仅回到未登录态
    set({ user: null, token: null, status: 'unauthenticated', initialized: true });
  },

  handleSessionExpired() {
    if (get().status === 'unauthenticated') return;
    removeStorage(STORAGE_KEYS.token);
    removeStorageByPrefix(SCRATCHPAD_PENDING_PREFIX);
    useProjectStore.getState().reset();
    set({ user: null, token: null, status: 'unauthenticated', initialized: true });
    // 强制整页跳登录页：避免残留的内存态 UI 在掉登录后仍能被继续操作
    if (window.location.pathname !== ROUTES.login) {
      window.location.assign(ROUTES.login);
    }
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
