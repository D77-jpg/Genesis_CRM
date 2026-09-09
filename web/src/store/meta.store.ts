/**
 * 元数据：枚举、占位符、我方公司信息
 * ------------------------------------------------------------------
 * 由 GET /api/meta 下发，避免前后端各维护一份枚举。
 * 接口失败时回退到 @/constants 里的静态定义，保证 UI 不会白屏。
 */
import { create } from 'zustand';
import { apiGet, toErrorMessage } from '@/lib/api';
import { PLACEHOLDER_DEFS, type PlaceholderDef } from '@/constants';
import type { MailChannel, MetaResponse } from '@/types';

/** 属于「我方信息」分组的占位符 key */
const COMPANY_KEYS = new Set(['companyName', 'companyWebsite', 'moq', 'senderName']);

/** 把后端下发的占位符补上 UI 分组信息 */
export function toPlaceholderDefs(meta: MetaResponse | null): PlaceholderDef[] {
  if (!meta?.placeholders?.length) return PLACEHOLDER_DEFS;
  return meta.placeholders.map((item) => ({
    key: item.key,
    label: item.label,
    token: item.token || `{{${item.key}}}`,
    group: COMPANY_KEYS.has(item.key) ? '我方信息' : '客户信息',
  }));
}

interface MetaState {
  meta: MetaResponse | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
  /** 当前生效的邮件通道（mock 时前端会给出「模拟发送」提示） */
  mailChannel: MailChannel;
  /**
   * 当前生效的占位符定义。
   *
   * 必须作为 state 字段存在，而不是在 selector 里现算：
   * zustand 用 useSyncExternalStore 订阅，getSnapshot 每次返回新数组就会
   * 触发「Maximum update depth exceeded」无限重渲染。
   */
  placeholderDefs: PlaceholderDef[];
  fetchMeta: (options?: { force?: boolean }) => Promise<void>;
}

export const useMetaStore = create<MetaState>()((set, get) => ({
  meta: null,
  loading: false,
  error: null,
  loaded: false,
  mailChannel: 'mock',
  // 先用本地静态定义兜底，/api/meta 回来后再覆盖
  placeholderDefs: PLACEHOLDER_DEFS,

  async fetchMeta({ force = false } = {}) {
    const state = get();
    // 已加载过就不重复请求；并发调用时也只发一次
    if (state.loading || (state.loaded && !force)) return;

    set({ loading: true, error: null });
    try {
      const meta = await apiGet<MetaResponse>('/meta');
      set({
        meta,
        // 在写入 state 时就算好，保证 selector 拿到的永远是同一个引用
        placeholderDefs: toPlaceholderDefs(meta),
        loading: false,
        loaded: true,
        mailChannel: meta.mailChannel ?? 'mock',
      });
    } catch (error) {
      // 元数据不是关键路径：失败时保留静态兜底，只在控制台留痕
      console.warn('[meta] 加载元数据失败，使用本地兜底定义', error);
      set({ loading: false, loaded: false, error: toErrorMessage(error, '元数据加载失败') });
    }
  },
}));

/** 占位符定义（合并后端下发与本地兜底），引用稳定可安全用作 selector */
export function selectPlaceholderDefs(state: MetaState): PlaceholderDef[] {
  return state.placeholderDefs;
}

/** 我方公司信息，占位符本地预览时使用 */
export function selectCompany(state: MetaState): MetaResponse['company'] | null {
  return state.meta?.company ?? null;
}
