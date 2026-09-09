/**
 * 用户管理接口（管理员专属）
 * ------------------------------------------------------------------
 * GET    /api/users              用户列表
 * POST   /api/users              创建用户（业务员 / 管理员）
 * PUT    /api/users/:id          编辑资料（显示名 / 角色）
 * PUT    /api/users/:id/password 重置密码
 * PUT    /api/users/:id/status   停用 / 启用
 * DELETE /api/users/:id          删除账号（名下客户转为未分配）
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { createUser, deleteUser, listUsers, resetPassword, setUserStatus, updateUser } from '../services/user.service';
import type {
  CreateUserInput,
  ResetPasswordInput,
  SetUserStatusInput,
  UpdateUserInput,
} from '../validators/user.validator';

export const listUsersHandler = asyncHandler(async (_req: Request, res: Response) => {
  const data = await listUsers();
  sendSuccess(res, data);
});

export const createUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateUserInput;
  const data = await createUser(input);
  sendSuccess(res, data, 201);
});

export const updateUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpdateUserInput;
  const data = await updateUser(req.user!.id, req.params.id, input);
  sendSuccess(res, data);
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ResetPasswordInput;
  const data = await resetPassword(req.params.id, input.password);
  sendSuccess(res, data);
});

export const setUserStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as SetUserStatusInput;
  const data = await setUserStatus(req.user!.id, req.params.id, input.status);
  sendSuccess(res, data);
});

export const deleteUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await deleteUser(req.user!.id, req.params.id);
  sendSuccess(res, data);
});
