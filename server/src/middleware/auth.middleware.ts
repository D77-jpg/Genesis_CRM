/**
 * 鉴权中间件
 * ------------------------------------------------------------------
 * requireAuth  —— 必须携带合法 Bearer Token
 * requireRole  —— 在 requireAuth 之后校验角色
 */
import type { Request, RequestHandler } from 'express';
import { ApiError } from '../utils/ApiError';
import { isAuthSessionActive, safeTokenEqual, verifyToken } from '../services/auth.service';
import { AUTH_COOKIE_NAMES, getCookie } from '../utils/auth-cookies';
import { Project, User, type UserRole } from '../models';

/** 从 Authorization 头中提取 token（兼容脚本 / 集成客户端） */
function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token?.trim()) return null;
  return token.trim();
}

/** Cookie 是浏览器的主要登录方式；Bearer 保留给自动化与旧客户端迁移。 */
function extractAuthToken(req: Request): { token: string; fromCookie: boolean } | null {
  const bearer = extractBearerToken(req.headers.authorization);
  if (bearer) return { token: bearer, fromCookie: false };
  const cookieToken = getCookie(req, AUTH_COOKIE_NAMES.access);
  return cookieToken ? { token: cookieToken, fromCookie: true } : null;
}

function assertCookieCsrf(req: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) return;
  const header = req.headers['x-csrf-token'];
  const expected = getCookie(req, AUTH_COOKIE_NAMES.csrf);
  if (!safeTokenEqual(typeof header === 'string' ? header : undefined, expected)) {
    throw ApiError.forbidden('CSRF 校验失败，请刷新页面后重试');
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const credential = extractAuthToken(req);
    if (!credential) {
      throw ApiError.unauthorized('缺少登录凭证，请先登录');
    }
    const payload = verifyToken(credential.token);

    // New browser sessions are revocable; legacy Bearer tokens without sid
    // remain supported until they expire during the migration window.
    if (payload.sid && !(await isAuthSessionActive(payload.sid, payload.sub))) {
      throw ApiError.unauthorized('登录会话已失效，请重新登录');
    }
    if (credential.fromCookie) assertCookieCsrf(req);

    // 查库校验账号是否仍存在且启用：停用 / 删除后，已签发的 token 立即失效（返回 401 触发前端登出）
    const current = await User.findById(payload.sub);
    if (!current) {
      throw ApiError.unauthorized('账号不存在或已被删除，请重新登录');
    }
    if (current.status === 'disabled') {
      throw ApiError.unauthorized('账号已停用，请联系管理员');
    }

    // 以库中最新的角色 / 显示名为准：角色被调整后即时生效，无需等 token 过期
    req.user = {
      id: current._id.toString(),
      username: current.username,
      displayName: current.displayName || current.username,
      role: current.role,
      // 部分旧版子路由仍会重复执行 requireAuth；保留父路由已经解析出的项目上下文。
      projectId: req.user?.projectId,
    };
    next();
  } catch (error) {
    next(error);
  }
};

/** 角色守卫，用法：router.delete('/:id', requireAuth, requireRole('admin'), handler) */
export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      next(ApiError.forbidden(`需要以下角色之一: ${roles.join(' / ')}`));
      return;
    }
    next();
  };

export default requireAuth;

/**
 * 解析 X-Project-Id。管理员可进入任一启用项目；普通用户仅可进入 projectIds。
 * 为兼容 V1-V2.5 客户端，缺少请求头时回退到用户默认项目或系统默认项目。
 */
export const requireProject: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const current = await User.findById(req.user.id).select('role projectIds defaultProjectId');
    if (!current) throw ApiError.unauthorized();

    const requested = String(req.headers['x-project-id'] ?? '').trim();
    const permitted = current.role === 'admin' ? null : current.projectIds.map(String);
    let project = requested && /^[a-f\d]{24}$/i.test(requested)
      ? await Project.findOne({ _id: requested, status: 'active' })
      : null;
    if (project && permitted && !permitted.includes(String(project._id))) project = null;
    if (requested && !project) throw ApiError.notFound('项目不存在或无权访问');

    if (!project && current.defaultProjectId && (!permitted || permitted.includes(String(current.defaultProjectId)))) {
      project = await Project.findOne({ _id: current.defaultProjectId, status: 'active' });
    }
    if (!project) {
      const filter: Record<string, unknown> = { status: 'active' };
      if (permitted) filter._id = { $in: current.projectIds };
      project = await Project.findOne(filter).sort({ isDefault: -1, createdAt: 1 });
    }
    if (!project) throw ApiError.notFound('没有可访问的项目');

    req.user.projectId = String(project._id);
    req.project = { id: String(project._id), slug: project.slug, code: project.code, name: project.name };
    res.setHeader('X-Project-Id', String(project._id));
    next();
  } catch (error) {
    next(error);
  }
};
