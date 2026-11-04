/**
 * 鉴权路由
 */
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { validate } from '../middleware/validate.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { loginSchema, verifyTwoFactorSchema, forgotPasswordSchema, resetPasswordSchema } from '../validators/auth.validator';
import {
  forgotPasswordHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  resetPasswordHandler,
  verifyTwoFactorHandler,
} from '../controllers/auth.controller';
import { ApiError } from '../utils/ApiError';

const router = Router();

/** 登录接口单独限流，防暴力破解 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // 抛 ApiError，由全局 errorHandler 输出统一的 JSON 错误体
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('登录尝试过于频繁，请 15 分钟后再试')),
});

const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('验证码尝试过于频繁，请 15 分钟后再试')),
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('请求过于频繁，请 15 分钟后再试')),
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('重置请求过于频繁，请 15 分钟后再试')),
});

router.post('/login', loginLimiter, validate({ body: loginSchema }), loginHandler);
router.post('/login/verify-2fa', twoFactorLimiter, validate({ body: verifyTwoFactorSchema }), verifyTwoFactorHandler);
router.post('/forgot-password', forgotPasswordLimiter, validate({ body: forgotPasswordSchema }), forgotPasswordHandler);
router.post('/reset-password', resetPasswordLimiter, validate({ body: resetPasswordSchema }), resetPasswordHandler);
router.post('/refresh', loginLimiter, refreshHandler);
router.post('/logout', logoutHandler);
router.get('/me', requireAuth, meHandler);

export default router;
