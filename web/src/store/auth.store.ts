/**
 * 登录态
 * ------------------------------------------------------------------
 * - 访问令牌与刷新令牌保存在 HttpOnly cookie，前端不读取 token
 * - 刷新页面后通过 GET /auth/me 恢复用户信息
 * - 401 时由 lib/api.ts 回调 handleSessionExpired，避免 api 层反向依赖 store
 */
import { create } from 'zustand';
import { apiGet, apiPost, setUnauthorizedHandler, toErrorMessage, ApiClientError } from '@/lib/api';
import { ROUTES, SCRATCHPAD_PENDING_PREFIX, STORAGE_KEYS } from '@/constants';
import { removeStorage, removeStorageByPrefix } from '@/lib/utils';
import type { AuthUser, LoginResponse, LoginResult, TwoFactorChallenge } from '@/types';
import { useProjectStore } from './project.store';

export type AuthStatus = 'idle' | 'bootstrapping' | 'authenticated' | 'unauthenticated';

/** 首屏恢复登录态遇瞬态错误（后端重启 / 网络抖动）时的重试参数，避免误掉登录 */
const BOOTSTRAP_RETRIES = 3;
const BOOTSTRAP_RETRY_DELAY = 1500;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  /** 首屏恢复登录态是否已结束（路由守卫据此决定是否显示 loading） */
  initialized: boolean;
  /** 登录请求进行中 */
  loggingIn: boolean;
  loginError: string | null;
  /** 密码已通过、等待邮件 OTP 的临时挑战 */
  twoFactorChallenge: TwoFactorChallenge | null;
  verifyingTwoFactor: boolean;
  twoFactorError: string | null;

  login: (username: string, password: string) => Promise<'authenticated' | 'twoFactor' | 'failed'>;
  verifyTwoFactor: (code: string) => Promise<boolean>;
  clearTwoFactor: () => void;
  logout: (options?: { silent?: boolean }) => void;
  bootstrap: () => Promise<void>;
  handleSessionExpired: () => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  status: 'idle',
  initialized: false,
  loggingIn: false,
  loginError: null,
  twoFactorChallenge: null,
  verifyingTwoFactor: false,
  twoFactorError: null,

  async login(username, password) {
    set({ loggingIn: true, loginError: null, twoFactorChallenge: null, twoFactorError: null });
    try {
      const result = await apiPost<LoginResponse>('/auth/login', { username, password });
      // Remove any token left by a pre-cookie-session build.
      removeStorage(STORAGE_KEYS.token);
      if ('twoFactorRequired' in result && result.twoFactorRequired) {
        set({
          user: null,
          status: 'unauthenticated',
          initialized: true,
          loggingIn: false,
          loginError: null,
          twoFactorChallenge: result,
          twoFactorError: null,
        });
        return 'twoFactor';
      }
      const loginResult = result as LoginResult;
      set({
        user: loginResult.user,
        status: 'authenticated',
        initialized: true,
        loggingIn: false,
        loginError: null,
        twoFactorChallenge: null,
        twoFactorError: null,
      });
      return 'authenticated';
    } catch (error) {
      set({ loggingIn: false, loginError: toErrorMessage(error, '登录失败，请检查用户名与密码') });
      return 'failed';
    }
  },

  async verifyTwoFactor(code) {
    const challenge = get().twoFactorChallenge;
    if (!challenge) return false;
    set({ verifyingTwoFactor: true, twoFactorError: null });
    try {
      const result = await apiPost<LoginResult>('/auth/login/verify-2fa', {
        challengeId: challenge.challengeId,
        code,
      });
      removeStorage(STORAGE_KEYS.token);
      set({
        user: result.user,
        status: 'authenticated',
        initialized: true,
        verifyingTwoFactor: false,
        twoFactorChallenge: null,
        twoFactorError: null,
      });
      return true;
    } catch (error) {
      set({
        verifyingTwoFactor: false,
        twoFactorError: toErrorMessage(error, '验证码校验失败，请重试'),
      });
      return false;
    }
  },

  clearTwoFactor() {
    set({ twoFactorChallenge: null, twoFactorError: null, verifyingTwoFactor: false });
  },

  logout({ silent = false } = {}) {
    // Clear the browser cookie on the server as well; the local state must not
    // remain usable while the request is in flight.
    void apiPost('/auth/logout').catch(() => undefined);
    removeStorage(STORAGE_KEYS.token);
    removeStorageByPrefix(SCRATCHPAD_PENDING_PREFIX);
    useProjectStore.getState().reset();
    set({
      user: null,
      status: 'unauthenticated',
      initialized: true,
      loggingIn: false,
      loginError: silent ? null : get().loginError,
      twoFactorChallenge: null,
      twoFactorError: null,
    });
  },

  /** 应用启动时调用：通过 cookie 恢复登录态 */
  async bootstrap() {
    set({ status: 'bootstrapping' });
    for (let attempt = 0; attempt < BOOTSTRAP_RETRIES; attempt++) {
      try {
        const { user } = await apiGet<{ user: AuthUser }>('/auth/me');
        set({ user, status: 'authenticated', initialized: true });
        return;
      } catch (error) {
        const status = error instanceof ApiClientError ? error.status : 0;
        // 401/403：cookie 会话确实失效 → 清理，交给路由守卫跳登录页
        if (status === 401 || status === 403) {
          removeStorage(STORAGE_KEYS.token);
          removeStorageByPrefix(SCRATCHPAD_PENDING_PREFIX);
          set({ user: null, status: 'unauthenticated', initialized: true });
          return;
        }
        // 网络抖动 / 后端重启 / 5xx：cookie 可能仍有效，稍后重试
        if (attempt < BOOTSTRAP_RETRIES - 1) await sleep(BOOTSTRAP_RETRY_DELAY);
      }
    }
    // 重试耗尽仍连不上：服务恢复后刷新页面可重新恢复 cookie 会话。
    set({ user: null, status: 'unauthenticated', initialized: true });
  },

  handleSessionExpired() {
    if (get().status === 'unauthenticated') return;
    removeStorage(STORAGE_KEYS.token);
    removeStorageByPrefix(SCRATCHPAD_PENDING_PREFIX);
    useProjectStore.getState().reset();
    set({ user: null, status: 'unauthenticated', initialized: true, twoFactorChallenge: null, twoFactorError: null });
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

/** Platform operators can manage every tenant; ordinary admins cannot. */
export const selectIsPlatformAdmin = (state: AuthState): boolean => Boolean(state.user?.isPlatformAdmin);

/** Project managers can edit assigned project settings and see the whole project. */
export const selectCanManageProjects = (state: AuthState): boolean =>
  state.user?.role === 'admin' || state.user?.role === 'project_admin';

/** Read-only accounts must not see write controls; the API also rejects writes. */
export const selectIsReadOnly = (state: AuthState): boolean => state.user?.role === 'viewer';
