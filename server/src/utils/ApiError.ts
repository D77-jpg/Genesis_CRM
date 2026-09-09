/**
 * 统一的应用错误类型
 * ------------------------------------------------------------------
 * 所有「可预期」的业务错误都应抛出 ApiError，
 * 由 errorHandler 中间件转换成统一格式的 JSON 响应。
 * 非 ApiError 的异常会被视为 500 服务器内部错误，并记录堆栈。
 */

/** 机器可读的错误码，前端可据此做差异化提示 / i18n */
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

export interface ApiErrorDetail {
  /** 出错字段路径，例如 "email" / "customers.3.email" */
  field?: string;
  /** 补充说明 */
  message?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: ApiErrorDetail[];
  readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    code: ErrorCode = 'INTERNAL_ERROR',
    details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = '请求参数有误', details?: ApiErrorDetail[]): ApiError {
    return new ApiError(400, message, 'VALIDATION_ERROR', details);
  }

  static validation(details: ApiErrorDetail[], message = '数据校验未通过'): ApiError {
    return new ApiError(422, message, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = '未登录或登录已过期，请重新登录'): ApiError {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = '没有权限执行该操作'): ApiError {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  static notFound(message = '请求的资源不存在'): ApiError {
    return new ApiError(404, message, 'NOT_FOUND');
  }

  static conflict(message = '资源已存在或状态冲突'): ApiError {
    return new ApiError(409, message, 'CONFLICT');
  }

  static tooManyRequests(message = '操作过于频繁，请稍后再试'): ApiError {
    return new ApiError(429, message, 'RATE_LIMITED');
  }

  static mailFailed(message = '开发信发送失败', details?: ApiErrorDetail[]): ApiError {
    return new ApiError(502, message, 'MAIL_SEND_FAILED', details);
  }

  static importFailed(message = 'Excel 导入失败', details?: ApiErrorDetail[]): ApiError {
    return new ApiError(422, message, 'IMPORT_FAILED', details);
  }

  static internal(message = '服务器内部错误'): ApiError {
    return new ApiError(500, message, 'INTERNAL_ERROR');
  }
}

export default ApiError;
