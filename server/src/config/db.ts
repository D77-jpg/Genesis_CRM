/**
 * MongoDB 连接管理
 * ------------------------------------------------------------------
 * - 启动时连接，失败自动重试（指数退避）
 * - 监听连接事件并输出日志
 * - 暴露 disconnectDatabase 供优雅停机使用
 */
import mongoose from 'mongoose';
import env from './env';
import { createLogger } from './logger';

const logger = createLogger('mongodb');

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  // 让 JSON 序列化时自动带上 id 字段、隐藏 __v
  mongoose.set('toJSON', { virtuals: true, versionKey: false });
  mongoose.set('toObject', { virtuals: true });

  mongoose.connection.on('connected', () => {
    logger.info(`已连接到 MongoDB: ${maskUri(env.MONGODB_URI)}`);
  });
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB 连接错误', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB 连接已断开');
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB 已重新连接');
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await mongoose.connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 20,
        autoIndex: !env.isProd, // 生产环境建议离线建索引
      });
      return mongoose;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`第 ${attempt}/${MAX_RETRIES} 次连接失败: ${message}`);
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `无法连接到 MongoDB（${maskUri(env.MONGODB_URI)}）。请确认 mongod 已启动，或修改 .env 中的 MONGODB_URI。`,
        );
      }
      await sleep(BASE_DELAY_MS * attempt);
    }
  }

  /* istanbul ignore next -- 理论上不可达 */
  throw new Error('MongoDB 连接失败');
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    logger.info('MongoDB 连接已关闭');
  }
}

/** 隐藏连接串中的用户名密码，避免日志泄露凭据 */
function maskUri(uri: string): string {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@');
}

export default connectDatabase;
