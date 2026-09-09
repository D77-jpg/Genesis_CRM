/**
 * 请求校验中间件（zod）
 * ------------------------------------------------------------------
 * - 一次校验 params / query / body
 * - 校验通过后用「解析并转换过的数据」回写请求对象，
 *   这样 controller 拿到的永远是干净、类型正确的数据（trim、类型强转、默认值等）
 * - 校验失败抛出 422，并带上字段级 details，前端可逐字段提示
 */
import type { RequestHandler } from 'express';
import type { ZodError, ZodTypeAny } from 'zod';
import { ApiError, type ApiErrorDetail } from '../utils/ApiError';

export interface ValidationSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

function mapIssues(error: ZodError, source: 'params' | 'query' | 'body'): ApiErrorDetail[] {
  // 同一字段可能因 min + refine 等多重规则报出完全相同的提示，
  // 这里按 field + message 去重，避免前端表单里出现重复的错误条
  const seen = new Set<string>();
  const details: ApiErrorDetail[] = [];

  error.issues.forEach((issue) => {
    const field = [source, ...issue.path.map(String)].join('.');
    const key = `${field}::${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);

    details.push({
      field,
      // 只取路径最后一段，前端表单更好定位
      path: issue.path.map(String).join('.') || source,
      message: issue.message,
      code: issue.code,
    });
  });

  return details;
}

/** 用 defineProperty 覆盖 query，兼容 Express 4/5（Express 5 中 query 是 getter） */
function overrideQuery(req: Parameters<RequestHandler>[0], value: unknown): void {
  Object.defineProperty(req, 'query', {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (req, _res, next) => {
    const details: ApiErrorDetail[] = [];
    const parsed: { params?: unknown; query?: unknown; body?: unknown } = {};

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) parsed.params = result.data;
      else details.push(...mapIssues(result.error, 'params'));
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) parsed.query = result.data;
      else details.push(...mapIssues(result.error, 'query'));
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) parsed.body = result.data;
      else details.push(...mapIssues(result.error, 'body'));
    }

    if (details.length > 0) {
      next(ApiError.validation(details));
      return;
    }

    if (parsed.params !== undefined) req.params = parsed.params as typeof req.params;
    if (parsed.query !== undefined) overrideQuery(req, parsed.query);
    if (parsed.body !== undefined) req.body = parsed.body;

    next();
  };
};

export default validate;
