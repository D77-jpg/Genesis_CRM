import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Attach a server-generated request id to every API request. The id is
 * returned to the client and included in audit records / error responses.
 */
export const requestIdMiddleware: RequestHandler = (_req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

export default requestIdMiddleware;
