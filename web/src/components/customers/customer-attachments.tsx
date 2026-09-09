/**
 * 客户附件区
 * ------------------------------------------------------------------
 * - 上传：本地文件经 FileReader 读成 base64，随 JSON POST（复用后端统一通道，不引入 multipart）
 * - 列表：文件名 / 类型 / 大小 / 上传时间 / 操作（预览 · 下载 · 删除）
 * - 图片可直接预览，PDF / Excel / Word 等至少支持下载
 * - 下载与预览都走鉴权接口（Authorization 头），图片预览用 blob → objectURL 渲染
 * - 权限由后端按客户归属校验（业务员只能操作自己客户的附件），前端只做展示与错误提示
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  Download,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, ErrorState, InlineLoader } from '@/components/common/empty-state';
import { apiDownload, toErrorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDateTime, formatFileSize } from '@/lib/format';
import { useAttachmentStore } from '@/store/attachment.store';
import { MAX_ATTACHMENT_SIZE } from '@/constants';
import type { CustomerAttachment } from '@/types';

export interface CustomerAttachmentsProps {
  customerId: string;
}

/** 把本地文件读成 dataURL（base64，后端会自动剥离前缀） */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败，请重试'));
    reader.readAsDataURL(file);
  });
}

/** 根据 MIME 选择一个贴切的图标 */
function mimeIcon(mimeType: string): React.ReactNode {
  const type = mimeType.toLowerCase();
  if (type.startsWith('image/')) return <FileImage className="h-4 w-4" aria-hidden />;
  if (type.includes('pdf')) return <FileText className="h-4 w-4" aria-hidden />;
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) {
    return <FileSpreadsheet className="h-4 w-4" aria-hidden />;
  }
  if (type.includes('word') || type.includes('document') || type.startsWith('text/')) {
    return <FileText className="h-4 w-4" aria-hidden />;
  }
  return <FileIcon className="h-4 w-4" aria-hidden />;
}

export function CustomerAttachments({ customerId }: CustomerAttachmentsProps): React.JSX.Element {
  const attachments = useAttachmentStore((state) => state.attachments);
  const loading = useAttachmentStore((state) => state.loading);
  const uploading = useAttachmentStore((state) => state.uploading);
  const deleting = useAttachmentStore((state) => state.deleting);
  const error = useAttachmentStore((state) => state.error);
  const fetchAttachments = useAttachmentStore((state) => state.fetchAttachments);
  const uploadAttachment = useAttachmentStore((state) => state.uploadAttachment);
  const deleteAttachment = useAttachmentStore((state) => state.deleteAttachment);
  const reset = useAttachmentStore((state) => state.reset);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<CustomerAttachment | null>(null);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ url: string; name: string } | null>(null);

  // 切换客户 / 首次挂载时拉取，卸载时清空，避免串客户数据
  React.useEffect(() => {
    if (!customerId) return;
    void fetchAttachments(customerId);
    return () => reset();
  }, [customerId, fetchAttachments, reset]);

  // 组件卸载时释放可能残留的预览 objectURL
  React.useEffect(
    () => () => {
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return null;
      });
    },
    [],
  );

  const closePreview = React.useCallback(() => {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  const handleUpload = React.useCallback(
    async (file: File) => {
      if (file.size <= 0) {
        toast.error('文件为空，请重新选择');
        return;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error('文件过大', {
          description: `${file.name} 约 ${(file.size / 1024 / 1024).toFixed(1)} MB，请控制在 ${Math.round(
            MAX_ATTACHMENT_SIZE / 1024 / 1024,
          )} MB 以内`,
        });
        return;
      }
      try {
        const dataBase64 = await readFileAsDataUrl(file);
        await uploadAttachment(customerId, {
          originalName: file.name,
          mimeType: file.type || undefined,
          dataBase64,
        });
        toast.success('附件已上传', { description: file.name });
      } catch (caught) {
        toast.error('上传失败', { description: caught instanceof Error ? caught.message : String(caught) });
      }
    },
    [customerId, uploadAttachment],
  );

  const handleDownload = React.useCallback(
    async (attachment: CustomerAttachment) => {
      setDownloadingId(attachment.id);
      try {
        await downloadFile(
          `/customers/${customerId}/attachments/${attachment.id}/download`,
          attachment.originalName,
        );
      } catch (caught) {
        toast.error('下载失败', { description: caught instanceof Error ? caught.message : String(caught) });
      } finally {
        setDownloadingId(null);
      }
    },
    [customerId],
  );

  const handlePreview = React.useCallback(
    async (attachment: CustomerAttachment) => {
      setPreviewLoadingId(attachment.id);
      try {
        const { blob } = await apiDownload(`/customers/${customerId}/attachments/${attachment.id}/download`);
        // 打开新预览前先释放上一张的 objectURL
        setPreview((current) => {
          if (current) URL.revokeObjectURL(current.url);
          return { url: URL.createObjectURL(blob), name: attachment.originalName };
        });
      } catch (caught) {
        toast.error('预览失败', { description: toErrorMessage(caught, '无法加载图片') });
      } finally {
        setPreviewLoadingId(null);
      }
    },
    [customerId],
  );

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteAttachment(customerId, deleteTarget.id);
      toast.success('附件已删除');
      setDeleteTarget(null);
    } catch (caught) {
      toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [customerId, deleteAttachment, deleteTarget]);

  const uploadButton = (
    <Button type="button" size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}>
      <Upload className="h-4 w-4" aria-hidden />
      上传附件
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
              客户附件
            </CardTitle>
            <CardDescription>产品图片、需求 PDF、报价单、PI / PO、合同等资料集中保存</CardDescription>
          </div>
          {uploadButton}
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUpload(file);
              event.target.value = '';
            }}
          />
        </CardHeader>

        <CardContent>
          {loading && attachments.length === 0 ? (
            <InlineLoader label="正在加载附件…" />
          ) : error && attachments.length === 0 ? (
            <ErrorState
              title="附件加载失败"
              description={error}
              onRetry={() => void fetchAttachments(customerId)}
              retrying={loading}
            />
          ) : attachments.length === 0 ? (
            <EmptyState
              title="还没有附件"
              description="上传与客户相关的资料，方便团队随时查阅。单个文件不超过 15 MB。"
              action={uploadButton}
            />
          ) : (
            <ul className="space-y-2">
              {attachments.map((item) => {
                const isImage = item.mimeType.toLowerCase().startsWith('image/');
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      {mimeIcon(item.mimeType)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={item.originalName}>
                        {item.originalName}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="max-w-[16rem] truncate">{item.mimeType || '未知类型'}</span>
                        <span aria-hidden>·</span>
                        <span>{formatFileSize(item.size)}</span>
                        <span aria-hidden>·</span>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isImage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                          disabled={previewLoadingId === item.id}
                          onClick={() => void handlePreview(item)}
                        >
                          {previewLoadingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <FileImage className="h-3.5 w-3.5" aria-hidden />
                          )}
                          预览
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                        disabled={downloadingId === item.id}
                        onClick={() => void handleDownload(item)}
                      >
                        {downloadingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        )}
                        下载
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`删除附件 ${item.originalName}`}
                        disabled={deleting}
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 图片预览：blob 走鉴权接口拉取，关闭时释放 objectURL */}
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name ?? '图片预览'}</DialogTitle>
            <DialogDescription className="sr-only">附件图片预览</DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-md bg-muted/30 p-2">
              <img src={preview.url} alt={preview.name} className="max-h-[66vh] max-w-full object-contain" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除附件"
        description={deleteTarget ? `确定要删除「${deleteTarget.originalName}」吗？删除后无法恢复。` : undefined}
        confirmText="删除"
        variant="destructive"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
