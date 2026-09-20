import { create } from 'zustand';
import { apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import { STORAGE_KEYS } from '@/constants';
import { readStorage, removeStorage, writeStorage } from '@/lib/utils';
import type { CreateProjectInput, Project, UpdateProjectInput } from '@/types';

interface ProjectState {
  items: Project[];
  activeProject: Project | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  initialize: (force?: boolean) => Promise<void>;
  switchProject: (id: string) => void;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<Project>;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  items: [], activeProject: null, loading: false, initialized: false, error: null,
  async initialize(force = false) {
    if (get().loading || (get().initialized && !force)) return;
    set({ loading: true, error: null, ...(force ? { initialized: false, activeProject: null } : {}) });
    try {
      const items = await apiGet<Project[]>('/projects');
      const saved = readStorage<string | null>(STORAGE_KEYS.activeProject, null);
      const activeProject = items.find((item) => item.id === saved && item.status === 'active')
        ?? items.find((item) => item.isDefault && item.status === 'active')
        ?? items.find((item) => item.status === 'active')
        ?? null;
      if (activeProject) writeStorage(STORAGE_KEYS.activeProject, activeProject.id);
      else removeStorage(STORAGE_KEYS.activeProject);
      set({ items, activeProject, loading: false, initialized: true, error: activeProject ? null : '当前账号没有可访问的项目' });
    } catch (error) {
      set({ loading: false, initialized: true, error: toErrorMessage(error, '项目列表加载失败') });
    }
  },
  switchProject(id) {
    const project = get().items.find((item) => item.id === id && item.status === 'active');
    if (!project || project.id === get().activeProject?.id) return;
    writeStorage(STORAGE_KEYS.activeProject, project.id);
    set({ activeProject: project });
    window.location.assign('/');
  },
  async createProject(input) {
    const project = await apiPost<Project>('/projects', input);
    set((state) => ({ items: [...state.items, project].sort((a, b) => a.name.localeCompare(b.name)) }));
    return project;
  },
  async updateProject(id, input) {
    const project = await apiPut<Project>(`/projects/${id}`, input);
    set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...project } : item),
      activeProject: state.activeProject?.id === id ? { ...state.activeProject, ...project } : state.activeProject }));
    return project;
  },
  reset() { set({ items: [], activeProject: null, loading: false, initialized: false, error: null }); },
}));
