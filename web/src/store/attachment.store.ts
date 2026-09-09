/**
 * 客户附件状态（Zustand）
 * ------------------------------------------------------------------
 * 详情页级别的数据：按 customerId 拉取附件列表，并封装上传 / 删除写操作。
 * 与 followup.store 同样自成一域，切换客户时 reset，避免串数据。
 *
 * 下载是无状态的浏览器行为，由组件直接调用 lib/download 完成，不进 store。
 * 权限：后端已按客户归属校验（业务员只能操作自己客户的附件），前端只做展示与错误提示。
 */
import { create } from 'zustand';
import { apiDelete, apiGet, apiPost, toErrorMessage } from '@/lib/api';
import type { CustomerAttachment, DeleteAttachmentResult, UploadAttachmentInput } from '@/types';

interface AttachmentState {
  /** 当前持有数据的客户 id */
  customerId: string | null;
  attachments: CustomerAttachment[];
  loading: boolean;
  /** 上传进行中（禁用上传按钮） */
  uploading: boolean;
  /** 删除进行中（禁用删除按钮） */
  deleting: boolean;
  error: string | null;

  fetchAttachments: (customerId: string) => Promise<void>;
  uploadAttachment: (customerId: string, input: UploadAttachmentInput) => Promise<CustomerAttachment | null>;
  deleteAttachment: (customerId: string, attachmentId: string) => Promise<boolean>;
  reset: () => void;
}

export const useAttachmentStore = create<AttachmentState>()((set, get) => ({
  customerId: null,
  attachments: [],
  loading: false,
  uploading: false,
  deleting: false,
  error: null,

  async fetchAttachments(customerId) {
    set({ customerId, loading: true, error: null });
    try {
      const data = await apiGet<CustomerAttachment[]>(`/customers/${customerId}/attachments`);
      set({ attachments: Array.isArray(data) ? data : [], loading: false });
    } catch (error) {
      set({ attachments: [], loading: false, error: toErrorMessage(error, '附件加载失败') });
    }
  },

  async uploadAttachment(customerId, input) {
    set({ uploading: true, error: null });
    try {
      const attachment = await apiPost<CustomerAttachment>(`/customers/${customerId}/attachments`, input);
      // 列表按上传时间倒序，新附件直接插到头部，避免整表重拉
      set({ uploading: false, attachments: [attachment, ...get().attachments] });
      return attachment;
    } catch (error) {
      set({ uploading: false });
      throw new Error(toErrorMessage(error, '上传附件失败'));
    }
  },

  async deleteAttachment(customerId, attachmentId) {
    set({ deleting: true, error: null });
    try {
      await apiDelete<DeleteAttachmentResult>(`/customers/${customerId}/attachments/${attachmentId}`);
      set({
        deleting: false,
        attachments: get().attachments.filter((item) => item.id !== attachmentId),
      });
      return true;
    } catch (error) {
      set({ deleting: false });
      throw new Error(toErrorMessage(error, '删除附件失败'));
    }
  },

  reset: () =>
    set({
      customerId: null,
      attachments: [],
      loading: false,
      uploading: false,
      deleting: false,
      error: null,
    }),
}));
