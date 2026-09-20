/**
 * Axios 客户端
 * ------------------------------------------------------------------
 * - 自动附带 Bearer Token
 * - 自动解包 { success, data, meta } → 直接返回 data
 * - 401 统一处理：清除登录态并跳转登录页
 * - 把后端错误转换成 ApiClientError（带 code / status / 字段级 details）
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiErrorBody, ApiErrorDetail, ApiResponse, ErrorCode } from '@/types';
import { STORAGE_KEYS } from '@/constants';
import { removeStorage, readStorage } from './utils';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/** 统一的客户端错误类型 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  readonly details: ApiErrorDetail[];
  readonly isCancel: boolean;

  constructor(message: string, status: number, code: ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN_ERROR', details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isCancel = false;
  }

  /** 取某个字段的错误信息，用于表单逐项提示 */
  fieldError(field: string): string | undefined {
    const hit = this.details.find((d) => {
      const path = d.path ?? d.field ?? '';
      return path === field || path.endsWith(`.${field}`);
    });
    return hit?.message;
  }
}

/** 401 时的回调，由 auth store 注册（避免 api 层直接依赖 store 造成循环引用） */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function getToken(): string | null {
  return readStorage<string | null>(STORAGE_KEYS.token, null);
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

/* ---------------------------- 请求拦截 ---------------------------- */
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  const projectId = readStorage<string | null>(STORAGE_KEYS.activeProject, null);
  if (projectId) config.headers.set('X-Project-Id', projectId);
  return config;
});

/* ---------------------------- 响应拦截 ---------------------------- */
http.interceptors.response.use(
  (response) => {
    // 二进制响应（Excel 下载）直接透传，不做解包
    if (response.config.responseType === 'blob') return response;

    const body = response.data as ApiResponse<unknown> | undefined;
    if (body && typeof body === 'object' && 'success' in body) {
      if (body.success) {
        // 直接解包：调用方拿到的就是后端 data 字段
        // （meta 里的 delivered / dryRun 等信息，后端已同时放在 data 内，无需额外透传）
        response.data = body.data;
      } else {
        const error = body.error as ApiErrorBody;
        return Promise.reject(
          new ApiClientError(error.message, response.status, error.code, error.details ?? []),
        );
      }
    }
    return response;
  },
  (error: AxiosError<ApiFailureLike>) => {
    if (axios.isCancel(error)) {
      const cancelled = new ApiClientError('请求已取消', 0, 'UNKNOWN_ERROR');
      (cancelled as { isCancel: boolean }).isCancel = true;
      return Promise.reject(cancelled);
    }

    const status = error.response?.status ?? 0;
    const payload = error.response?.data;

    // 401：登录态失效
    if (status === 401) {
      removeStorage(STORAGE_KEYS.token);
      unauthorizedHandler?.();
    }

    if (!error.response) {
      return Promise.reject(
        new ApiClientError(
          error.code === 'ECONNABORTED'
            ? '请求超时，请检查网络或后端服务是否已启动'
            : '无法连接到服务器，请确认后端已启动（npm run dev:server）',
          status,
          'NETWORK_ERROR',
        ),
      );
    }

    const apiError = payload?.error;
    return Promise.reject(
      new ApiClientError(
        apiError?.message ?? `请求失败（HTTP ${status}）`,
        status,
        (apiError?.code ?? 'UNKNOWN_ERROR') as ErrorCode,
        apiError?.details ?? [],
      ),
    );
  },
);

interface ApiFailureLike {
  success?: false;
  error?: ApiErrorBody;
}

/* ---------------------------- 语义化请求方法 ---------------------------- */

/** 请求结果统一为解包后的 data */
export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await http.get<unknown, { data: T }>(url, config);
  return response.data as T;
}

export async function apiPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await http.post<unknown, { data: T }>(url, body, config);
  return response.data as T;
}

export async function apiPut<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await http.put<unknown, { data: T }>(url, body, config);
  return response.data as T;
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await http.delete<unknown, { data: T }>(url, config);
  return response.data as T;
}

/** 下载结果：二进制内容 + 后端建议的文件名 */
export interface DownloadResult {
  blob: Blob;
  filename: string | null;
}

/** 从 Content-Disposition 中解析文件名，优先取 filename*（UTF-8，兼容中文） */
export function parseFilename(disposition?: string): string | null {
  if (!disposition) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, '');
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
  return plainMatch?.[1]?.trim() ?? null;
}

/**
 * 下载二进制文件（xlsx）。
 * 后端出错时返回的是 JSON，这里检测 content-type 并转换成 ApiClientError。
 */
export async function apiDownload(url: string, config?: AxiosRequestConfig): Promise<DownloadResult> {
  const response = await http.get<Blob>(url, { ...config, responseType: 'blob' });
  const blob = response.data;

  if (blob.type.includes('application/json')) {
    const text = await blob.text();
    let message = '下载失败：响应内容无法解析';
    let code: ErrorCode | 'UNKNOWN_ERROR' = 'UNKNOWN_ERROR';
    let details: ApiErrorDetail[] = [];
    try {
      const parsed = JSON.parse(text) as { error?: ApiErrorBody };
      if (parsed.error) {
        message = parsed.error.message;
        code = parsed.error.code;
        details = parsed.error.details ?? [];
      }
    } catch {
      /* 保留默认提示 */
    }
    throw new ApiClientError(message, response.status, code, details);
  }

  const raw = response.headers['content-disposition'] ?? response.headers['Content-Disposition'];
  return { blob, filename: parseFilename(typeof raw === 'string' ? raw : undefined) };
}

/** 把错误对象转换成给用户看的中文提示 */
export function toErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof ApiClientError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string' && error.length > 0) return error;
  return fallback;
}
