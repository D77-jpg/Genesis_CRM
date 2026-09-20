/**
 * Express 类型扩展
 * ------------------------------------------------------------------
 * 为 Request 注入 user 字段，使 auth 中间件之后的 handler 能安全访问当前登录人。
 */
import type { UserRole } from '../models/User';

/** 挂载在 req 上的精简用户信息（不含任何敏感字段） */
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** requireProject 解析后的当前项目；业务接口必须存在。 */
  projectId?: string;
}

export interface ActiveProject {
  id: string;
  slug: string;
  code: string;
  name: string;
}

/** JWT 载荷 */
export interface JwtPayload {
  sub: string;
  username: string;
  displayName: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      project?: ActiveProject;
    }
  }
}

export {};
