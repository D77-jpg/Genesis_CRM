/**
 * 错误处理中间件
 * ------------------------------------------------------------------
 * 1) notFoundHandler  —— 兜住所有未匹配的路由
 * 2) errorHandler     —— 把各类异常统一转换成 { success:false, error:{...} }
 *
 * 支持的异常来源：
 * - ApiError（业务主动抛出）
 * - Mongoose ValidationError / CastError
 * - MongoDB 唯一索引冲突（code 11000）
 * - body-parser 请求体过大
 * - 其它未知异常（统一 500，生产环境不泄露堆栈）
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import env from '../config/env';
import { createLogger } from '../config/logger';
import { ApiError, type ApiErrorDetail } from '../utils/ApiError';

const logger = createLogger('http');

/** 404：路由不存在 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`接口不存在: ${req.method} ${req.originalUrl}`));
};

interface MongoServerErrorLike extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
}

/** 把 Mongoose 校验错误转成字段级 details，前端可直接定位到具体输入框 */
function mapMongooseValidationError(error: mongoose.Error.ValidationError): ApiErrorDetail[] {
  return Object.values(error.errors).map((e) => ({
    field: e.path,
    message: e.message,
  }));
}

/** 从 11000 错误中提取重复字段名，给出人类可读的提示 */
function describeDuplicateKey(error: MongoServerErrorLike): string {
  const keys = Object.keys(error.keyValue ?? {});
  if (keys.length === 0) return '记录已存在，请勿重复提交';
  const fieldLabel: Record<string, string> = { email: '邮箱', username: '用户名', name: '姓名' };
  const parts = keys.map((k) => {
    const label = fieldLabel[k] ?? k;
    const value = error.keyValue?.[k];
    return value ? `${label} "${String(value)}"` : label;
  });
  return `${parts.join('、')} 已存在，请勿重复添加`;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof mongoose.Error.ValidationError) {
    apiError = new ApiError(422, '数据校验未通过', 'VALIDATION_ERROR', mapMongooseValidationError(err));
  } else if (err instanceof mongoose.Error.CastError) {
    apiError = ApiError.badRequest(`字段 "${err.path}" 的取值格式不正确（${String(err.value)}）`);
  } else if ((err as MongoServerErrorLike)?.code === 11000) {
    apiError = ApiError.conflict(describeDuplicateKey(err as MongoServerErrorLike));
  } else if ((err as { type?: string })?.type === 'entity.too.large') {
    apiError = new ApiError(413, '请求体过大，请减少单次提交的数据量', 'PAYLOAD_TOO_LARGE');
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    apiError = ApiError.badRequest('请求体不是合法的 JSON');
  } else {
    apiError = ApiError.internal(env.isProd ? '服务器内部错误，请稍后重试' : (err as Error)?.message || '服务器内部错误');
  }

  // 4xx 记 warn，5xx 记 error 并带堆栈
  const logLine = `${req.method} ${req.originalUrl} -> ${apiError.statusCode} ${apiError.code}`;
  if (apiError.statusCode >= 500) {
    logger.error(logLine, { message: err?.message, stack: env.isProd ? undefined : err?.stack });
  } else {
    logger.warn(logLine, { message: apiError.message });
  }

  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      // 仅开发环境返回堆栈，便于调试
      ...(!env.isProd && apiError.statusCode >= 500 && err?.stack ? { stack: String(err.stack) } : {}),
    },
  });
};

export default errorHandler;
