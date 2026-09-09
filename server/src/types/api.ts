/**
 * API 响应体契约
 * ------------------------------------------------------------------
 * 前端 web/src/types/api.ts 与此保持一一对应。
 */
import type { ErrorCode, ApiErrorDetail } from '../utils/ApiError';
import type { Paginated } from '../utils/pagination';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    stack?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type PaginatedResponse<T> = ApiSuccess<Paginated<T>>;

export type { Paginated, ErrorCode, ApiErrorDetail };
