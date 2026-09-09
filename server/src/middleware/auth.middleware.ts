/**
 * 鉴权中间件
 * ------------------------------------------------------------------
 * requireAuth  —— 必须携带合法 Bearer Token
 * requireRole  —— 在 requireAuth 之后校验角色
 */
import type { RequestHandler } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyToken } from '../services/auth.service';
import { User, type UserRole } from '../models';

/** 从 Authorization 头中提取 token */
function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token?.trim()) return null;
  return token.trim();
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw ApiError.unauthorized('缺少登录凭证，请先登录');
    }
    const payload = verifyToken(token);

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
