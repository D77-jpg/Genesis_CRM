/**
 * Express 应用装配
 * ------------------------------------------------------------------
 * 只负责「中间件 + 路由」的组合，不监听端口（便于测试时直接 import app）。
 */
import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';

import env from './config/env';
import { createLogger } from './config/logger';
import { ApiError } from './utils/ApiError';
import apiRoutes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

const logger = createLogger('app');

/** CORS 白名单校验：未配置的来源一律拒绝（同源请求 origin 为 undefined，放行） */
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    logger.warn(`拒绝跨域请求，origin=${origin} 不在白名单内`);
    callback(ApiError.forbidden(`来源 ${origin} 未被允许跨域访问`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

/** 全局限流：单 IP 每分钟最多 600 次请求 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // 健康检查不计入限流
  skip: (req) => req.path === '/api/health',
  handler: (_req, _res, next) => next(ApiError.tooManyRequests()),
});

export function createApp(): Application {
  const app = express();

  // 反向代理（nginx 等）场景下正确识别协议与客户端 IP
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /* ---------- 安全与基础中间件 ---------- */
  app.use(
    helmet({
      // 纯 API 服务，不需要 CSP
      contentSecurityPolicy: false,
      // 允许浏览器跨源下载 xlsx 文件
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors(corsOptions));
  app.use(compression());

  /* ---------- 请求体解析 ----------
   * 25MB 上限：Excel 导入走前端解析后提交 JSON（5000 行客户数据通常在 3~5MB 内）；
   * 客户附件以 base64 JSON 提交，单个文件上限 15MB（base64 膨胀约 33% → ~20MB），故放宽到 25MB。
   */
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  /* ---------- 访问日志 ---------- */
  app.use(morgan(env.isProd ? 'combined' : 'dev', {
    skip: (req) => req.path === '/api/health',
  }));

  /* ---------- 路由 ---------- */
  app.use('/api', apiLimiter, apiRoutes);

  // 根路径给个友好提示，避免打开 http://localhost:5000 看到 404 一头雾水
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'Customer Dev Letter Manager API',
        version: '2.0.0',
        docs: '/api/health, /api/meta',
        env: env.NODE_ENV,
      },
    });
  });

  /* ---------- 404 与错误处理（必须放最后） ---------- */
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
