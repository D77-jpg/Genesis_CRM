/**
 * Background job runtime shared by the standalone worker and (for
 * single-process development) the API.
 */
import env from '../config/env';
import { createLogger } from '../config/logger';
import { runWithTenant } from '../models/tenant-context';
import { semanticPool } from '../services/knowledge/embedding';
import { startKnowledgeDocumentWorker, stopKnowledgeDocumentWorker } from '../services/knowledge/document.service';
import { startKnowledgeIndexWorker, stopKnowledgeIndexWorker } from '../services/knowledge/index.service';
import { startAgentTaskWorker, stopAgentTaskWorker } from '../services/agent/task.service';
import { startProspectingScheduler, stopProspectingScheduler } from '../services/prospecting/scheduler';
import { startOutreachAutomationWorker, stopOutreachAutomationWorker } from '../services/outreach-automation.service';
import { startOutreachFollowUpWorker, stopOutreachFollowUpWorker } from '../services/outreach-followup.service';
import { startWebsiteResearchWorker, stopWebsiteResearchWorker } from '../services/website/research.service';
import { runMailQueue } from '../services/mail-queue.service';
import { syncInbox } from '../services/mail-sync.service';

const logger = createLogger('worker');
const timers: NodeJS.Timeout[] = [];
let started = false;

/**
 * Workers must see every organization. They still derive organizationId for
 * new project-scoped documents from the project (tenant plugin save hook).
 */
export function startBackgroundJobs(): void {
  if (started) return;
  started = true;
  runWithTenant({ bypass: true, source: 'worker' }, () => {
    void runMailQueue().catch((error) => logger.warn('邮件队列启动失败', error instanceof Error ? error.message : String(error)));
    void syncInbox().catch((error) => logger.warn('收件箱同步启动失败', error instanceof Error ? error.message : String(error)));
    timers.push(setInterval(() => void runMailQueue(), env.MAIL_WORKER_INTERVAL_MS));
    timers.push(setInterval(() => void syncInbox(), env.IMAP_SYNC_INTERVAL_MS));
    startProspectingScheduler();
    startOutreachFollowUpWorker();
    startOutreachAutomationWorker();
    startAgentTaskWorker();
    startWebsiteResearchWorker();
    startKnowledgeDocumentWorker();
    startKnowledgeIndexWorker();
    logger.info('后台任务已启动（邮件队列 / 收件箱 / 获客 / 自动跟进 / Agent / 知识库）');
  });
}

export function stopBackgroundJobs(): void {
  if (!started) return;
  started = false;
  timers.forEach(clearInterval);
  timers.length = 0;
  stopProspectingScheduler();
  stopOutreachFollowUpWorker();
  stopOutreachAutomationWorker();
  stopAgentTaskWorker();
  stopWebsiteResearchWorker();
  stopKnowledgeDocumentWorker();
  stopKnowledgeIndexWorker();
  semanticPool.close();
  logger.info('后台任务已停止');
}
