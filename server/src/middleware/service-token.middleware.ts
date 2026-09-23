/**
 * 服务凭证中间件（Integration API v1）
 * ------------------------------------------------------------------
 * requireServiceToken        —— Bearer 服务凭证认证（区别于用户 JWT 的 requireAuth）
 * requireScope(scope)        —— scope 守卫
 * requireIntegrationProject  —— 显式 X-Project-Id 解析 + 凭证项目绑定校验
 * integrationAuditLog        —— 审计日志（requestId / 凭证 / 项目 / 结果 / 耗时）
 *
 * 安全约定：本文件与用户 JWT 体系完全隔离；不接受用户 token，也不签发任何会话。
 */
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyToken } from '../services/integration-credential.service';
import { IntegrationRequestLog, Project } from '../models';

function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token?.trim()) return null;
  return token.trim();
}

/** Bearer 服务凭证认证。失败一律 401 UNAUTHORIZED（不区分原因，避免凭证探测）。 */
export const requireServiceToken: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) throw ApiError.unauthorized('缺少服务凭证');

    const verified = await verifyToken(token);
    if (!verified) throw ApiError.unauthorized('服务凭证无效或已失效');

    req.integration = {
      credentialId: verified.id,
      scopes: verified.scopes,
      projectIds: verified.projectIds,
    };
    next();
  } catch (error) {
    next(error);
  }
};

/** scope 守卫：requireServiceToken 之后使用 */
export const requireScope = (scope: string): RequestHandler => {
  return (req, _res, next) => {
    if (!req.integration) {
      next(ApiError.unauthorized('缺少服务凭证'));
      return;
    }
    res_setScopeHint(req, scope);
    if (!req.integration.scopes.includes(scope)) {
      next(ApiError.forbiddenScope(scope));
      return;
    }
    next();
  };
};

/** 把端点所需 scope 暂存到 res.locals，供审计日志记录 */
function res_setScopeHint(req: Parameters<RequestHandler>[0], scope: string): void {
  const res = req.res;
  if (res) res.locals.integrationScope = scope;
}

/**
 * 显式解析 X-Project-Id：
 *  - 必须携带（集成 API 无默认项目回退，防止多项目场景写错工作区）；
 *  - 项目必须存在且 active；
 *  - 项目必须在凭证绑定集合内，否则 404 PROJECT_MISMATCH（不暴露项目存在性）。
 */
export const requireIntegrationProject: RequestHandler = async (req, res, next) => {
  try {
    if (!req.integration) throw ApiError.unauthorized('缺少服务凭证');

    const requested = String(req.headers['x-project-id'] ?? '').trim();
    if (!requested || !/^[a-f\d]{24}$/i.test(requested)) {
      throw ApiError.badRequest('缺少或非法的 X-Project-Id 请求头（集成 API 必须显式指定项目）');
    }
    if (!req.integration.projectIds.includes(requested.toLowerCase())) {
      throw ApiError.projectMismatch();
    }
    const project = await Project.findOne({ _id: requested, status: 'active' });
    if (!project) throw ApiError.projectMismatch();

    req.project = { id: String(project._id), slug: project.slug, code: project.code, name: project.name };
    res.setHeader('X-Project-Id', String(project._id));
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 审计日志：响应结束后落一条 IntegrationRequestLog。
 * 必须挂载在认证中间件之前——认证失败（401）恰恰是最需要审计的请求。
 * 只记录 requestId / 凭证 / 项目 / 路由 / 状态码 / 错误码 / 耗时；
 * 不记录 token、请求体与询盘内容。
 */
export const integrationAuditLog: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.locals.integrationStartedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const started = res.locals.integrationStartedAt as bigint | undefined;
    const latencyMs = started ? Number(process.hrtime.bigint() - started) / 1e6 : 0;
    void IntegrationRequestLog.create({
      requestId,
      credentialId: req.integration?.credentialId ?? null,
      projectId: req.project?.id ?? null,
      method: req.method,
      route: `${req.baseUrl}${req.route?.path ?? ''}` || req.originalUrl.split('?')[0],
      scope: res.locals.integrationScope ?? null,
      statusCode: res.statusCode,
      errorCode: res.locals.apiErrorCode ?? null,
      latencyMs: Math.round(latencyMs),
      externalId: typeof req.body?.externalId === 'string' ? req.body.externalId : null,
    }).catch(() => undefined);
  });
  next();
};
