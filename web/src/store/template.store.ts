/**
 * 开发信模板状态（Zustand）
 * ------------------------------------------------------------------
 * 服务两处：
 *  1. 「模板中心」页的列表 / 新建 / 编辑 / 删除 / 复制
 *  2. 「发送开发信」弹窗里的模板选择器（只借用 items + fetchList）
 *
 * 模板是全局资源，数量通常不大，一次拉全量、前端本地按分类 / 关键词再过滤即可，
 * 因此这里的 fetchList 直接返回数组，不做分页。
 */
import { create } from 'zustand';
import { apiDelete, apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import type {
  DeleteTemplateResult,
  LetterTemplate,
  TemplateCategory,
  TemplateInput,
} from '@/types';

interface TemplateQueryState {
  /** 分类过滤，'all' 表示不限 */
  category: TemplateCategory | 'all';
  /** 关键词（名称 / 主题），前端本地过滤 */
  keyword: string;
}

interface TemplateState extends TemplateQueryState {
  items: LetterTemplate[];
  loading: boolean;
  /** 写操作进行中（新建 / 编辑 / 删除 / 复制） */
  mutating: boolean;
  error: string | null;

  setFilters: (patch: Partial<TemplateQueryState>) => void;
  resetFilters: () => void;
  /** 按当前 category / keyword 本地过滤后的结果 */
  visibleItems: () => LetterTemplate[];

  fetchList: () => Promise<void>;
  createTemplate: (input: TemplateInput) => Promise<LetterTemplate | null>;
  updateTemplate: (id: string, input: TemplateInput) => Promise<LetterTemplate | null>;
  deleteTemplate: (id: string) => Promise<boolean>;
  duplicateTemplate: (id: string) => Promise<LetterTemplate | null>;
}

const initialQuery: TemplateQueryState = {
  category: 'all',
  keyword: '',
};

export const useTemplateStore = create<TemplateState>()((set, get) => ({
  ...initialQuery,
  items: [],
  loading: false,
  mutating: false,
  error: null,

  setFilters: (patch) => set(patch),
  resetFilters: () => set({ ...initialQuery }),

  visibleItems: () => {
    const { items, category, keyword } = get();
    const kw = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (kw && !`${item.name} ${item.subject}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  },

  async fetchList() {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<LetterTemplate[]>('/templates');
      set({ items: Array.isArray(data) ? data : [], loading: false });
    } catch (error) {
      set({ items: [], loading: false, error: toErrorMessage(error, '模板加载失败') });
    }
  },

  async createTemplate(input) {
    set({ mutating: true, error: null });
    try {
      const created = await apiPost<LetterTemplate>('/templates', input);
      set({ mutating: false, items: [created, ...get().items] });
      return created;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '新建模板失败'));
    }
  },

  async updateTemplate(id, input) {
    set({ mutating: true, error: null });
    try {
      const updated = await apiPut<LetterTemplate>(`/templates/${id}`, input);
      set({
        mutating: false,
        items: get().items.map((item) => (item.id === id ? updated : item)),
      });
      return updated;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '保存模板失败'));
    }
  },

  async deleteTemplate(id) {
    set({ mutating: true, error: null });
    try {
      await apiDelete<DeleteTemplateResult>(`/templates/${id}`);
      set({ mutating: false, items: get().items.filter((item) => item.id !== id) });
      return true;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '删除模板失败'));
    }
  },

  async duplicateTemplate(id) {
    set({ mutating: true, error: null });
    try {
      const copy = await apiPost<LetterTemplate>(`/templates/${id}/duplicate`);
      // 复制出的模板排在最前（后端按 updatedAt 倒序，这里本地插到队首保持一致）
      set({ mutating: false, items: [copy, ...get().items] });
      return copy;
    } catch (error) {
      set({ mutating: false });
      throw new Error(toErrorMessage(error, '复制模板失败'));
    }
  },
}));
