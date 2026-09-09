/**
 * 异步路由处理器包装
 * ------------------------------------------------------------------
 * Express 4 不会自动捕获 async 函数抛出的错误，
 * 用 asyncHandler 包一层即可统一交给 errorHandler。
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (fn: AsyncRequestHandler): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default asyncHandler;
