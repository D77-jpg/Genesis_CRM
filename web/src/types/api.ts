/**
 * API 响应契约（与 server/src/types/api.ts 对应）
 */

/** 后端统一错误码 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'MAIL_SEND_FAILED'
  | 'IMPORT_FAILED'
  | 'INTERNAL_ERROR';

/** 字段级错误，前端可用来定位到具体输入框 */
export interface ApiErrorDetail {
  /** 形如 "body.email" / "query.page" */
  field?: string;
  /** 形如 "email" */
  path?: string;
  message?: string;
  code?: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: ApiErrorDetail[];
  stack?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 分页包装 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** 通用分页 / 排序查询参数 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
