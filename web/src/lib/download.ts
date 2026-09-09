/**
 * 文件下载辅助
 * ------------------------------------------------------------------
 * 导出 Excel 走后端（xlsx 在服务端生成，字段与中文表头统一维护），
 * 前端只负责把 Blob 变成一次浏览器下载。
 */
import { apiDownload, toErrorMessage } from './api';

/** 触发一次浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // 不挂到可见 DOM 也能点击，但 Firefox 需要节点在文档中
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  // 延迟回收，避免部分浏览器在下载启动前就把 URL 释放掉
  window.setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}

/** 生成带日期戳的文件名，如 客户列表-2026-09-08.xlsx */
export function stampedFilename(prefix: string, extension = 'xlsx'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix}-${stamp}.${extension}`;
}

/**
 * 下载接口封装：自动使用后端 Content-Disposition 中的文件名，
 * 缺失时回退到 fallbackName。抛出的错误已是中文提示可直接 toast。
 */
export async function downloadFile(
  url: string,
  fallbackName: string,
  params?: Record<string, unknown>,
): Promise<void> {
  try {
    const { blob, filename } = await apiDownload(url, { params });
    downloadBlob(blob, filename ?? fallbackName);
  } catch (error) {
    throw new Error(toErrorMessage(error, '导出失败，请稍后重试'));
  }
}
