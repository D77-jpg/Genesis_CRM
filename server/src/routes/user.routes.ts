/**
 * 用户管理路由（管理员专属）
 * ------------------------------------------------------------------
 * 严格分配制下，只有管理员能创建 / 查看 / 编辑 / 重置密码 / 停用 / 删除账号，再把客户分配给业务员。
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { idParamsSchema } from '../validators/common';
import { createUserSchema, resetPasswordSchema, setUserStatusSchema, updateUserSchema } from '../validators/user.validator';
import {
  createUserHandler,
  deleteUserHandler,
  listUsersHandler,
  resetPasswordHandler,
  setUserStatusHandler,
  updateUserHandler,
} from '../controllers/user.controller';

const router = Router();

// 用户管理整体是管理员专属
router.use(requireAuth, requireRole('admin'));

router.get('/', listUsersHandler);
router.post('/', validate({ body: createUserSchema }), createUserHandler);
router.put('/:id', validate({ params: idParamsSchema, body: updateUserSchema }), updateUserHandler);
router.put('/:id/password', validate({ params: idParamsSchema, body: resetPasswordSchema }), resetPasswordHandler);
router.put('/:id/status', validate({ params: idParamsSchema, body: setUserStatusSchema }), setUserStatusHandler);
router.delete('/:id', validate({ params: idParamsSchema }), deleteUserHandler);

export default router;
