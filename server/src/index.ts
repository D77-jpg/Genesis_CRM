/**
 * 服务启动入口
 * ------------------------------------------------------------------
 * 启动顺序：环境变量校验（import 时完成）→ 连接 MongoDB → 初始化管理员
 *          → 邮件通道自检 → 监听端口
 * 退出顺序：停止接收新连接 → 关闭 HTTP → 关闭数据库连接 → 退出进程
 */
import http from 'node:http';
import env from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';
import { createLogger } from './config/logger';
import { bootstrapAdminUser } from './services/auth.service';
import { bootstrapProjects } from './services/project.service';
import { migrateLegacyCustomerStatus } from './services/customer.service';
import { verifyMailer } from './services/mailer.service';
import { createApp } from './app';
import { runMailQueue } from './services/mail-queue.service';
import { syncInbox } from './services/mail-sync.service';
import { Customer, CustomerAttachment, CustomerEvent, DevelopmentLetter, FollowUp, LetterTemplate, Project, Quotation, Scratchpad, User } from './models';
import { MailMessage, MailSyncState } from './models/MailMessage';

const mailTimers: NodeJS.Timeout[] = [];

const logger = createLogger('bootstrap');

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await bootstrapProjects();
    await bootstrapAdminUser();
    await bootstrapProjects();
    await migrateLegacyCustomerStatus();
    await Promise.all([Project.init(), User.init(), Customer.init(), DevelopmentLetter.init(), MailMessage.init(), MailSyncState.init(),
      FollowUp.init(), CustomerEvent.init(), CustomerAttachment.init(), Quotation.init(), LetterTemplate.init(), Scratchpad.init()]);
    const app = createApp();
    const server = http.createServer(app);
    // 邮箱连通性检查可能受网络、防火墙或上游超时影响，不能阻塞 CRM 登录与启动。
    void verifyMailer().catch((error) => {
      logger.warn('邮件通道启动自检异常（不影响 CRM 使用）', error instanceof Error ? error.message : String(error));
    });
    void runMailQueue();
    void syncInbox();
    mailTimers.push(setInterval(() => void runMailQueue(), env.MAIL_WORKER_INTERVAL_MS));
    mailTimers.push(setInterval(() => void syncInbox(), env.IMAP_SYNC_INTERVAL_MS));

    server.listen(env.PORT, env.HOST, () => {
      logger.info('==============================================');
      logger.info(`  Multi-project CRM API 已启动`);
      logger.info(`  环境      : ${env.NODE_ENV}`);
      logger.info(`  监听地址  : ${env.HOST}:${env.PORT}`);
      logger.info(`  健康检查  : http://localhost:${env.PORT}/api/health`);
      logger.info(`  元数据    : http://localhost:${env.PORT}/api/meta`);
      logger.info(`  邮件通道  : ${env.MAIL_TRANSPORT === 'smtp' ? (env.smtpConfigured ? 'smtp（真实发送）' : 'smtp（配置不完整）') : 'mock（模拟发送）'}`);
      logger.info('==============================================');
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`端口 ${env.PORT} 已被占用，请修改 .env 中的 PORT 或释放该端口`);
        process.exit(1);
      }
      logger.error('HTTP 服务错误', error.message);
      process.exit(1);
    });

    registerShutdown(server);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('服务启动失败', message);
    if (!env.isProd && error instanceof Error) {
      // 开发环境打印堆栈，便于定位
      logger.error(error.stack ?? '');
    }
    process.exit(1);
  }
}

/** 优雅停机 */
function registerShutdown(server: http.Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    mailTimers.forEach(clearInterval);
    logger.info(`收到 ${signal}，开始优雅停机...`);

    // 给正在处理的请求 10 秒收尾时间
    const forceTimer = setTimeout(() => {
      logger.error('停机超时（10s），强制退出');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    server.close(async () => {
      try {
        await disconnectDatabase();
        logger.info('已安全退出');
        process.exit(0);
      } catch (error) {
        logger.error('关闭数据库连接失败', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', reason instanceof Error ? reason.stack : String(reason));
  });

  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常，进程即将退出', error.stack ?? error.message);
    // 未知状态下继续服务不安全，直接退出交给进程管理器重启
    process.exit(1);
  });
}

void bootstrap();
