/**
 * Index synchronization is a migration, not an implicit startup side effect.
 * Future model/index changes must add a new migration rather than editing this
 * one in place.
 */
import {
  AgentAction, AgentAiProvider, AgentAiSettings, AgentCustomerPreview, AgentMessage, AgentRun, AgentSession,
  AuthChallenge, AuthSession, BillingInvoice, Customer, CustomerAttachment, CustomerEvent, DevelopmentLetter,
  EmailSuppression, FollowUp, KnowledgeFeedback, KnowledgeTrainingState, LetterTemplate, MailAccountAudit,
  MailQuotaBucket, Organization, OutreachAutomationConfig, OutreachAutomationDay, OutreachAutomationEnrollment,
  Product, Project, ProjectPlaybook, Quotation, Scratchpad, UsageRecord, User, UserMailAccount,
} from '../models';
import { MailMessage, MailSyncState } from '../models/MailMessage';
import type { Migration } from './types';

export const indexSynchronizationMigration: Migration = {
  id: '20261104-007-sync-indexes',
  name: 'Create and synchronize collection indexes',
  version: 1,
  async up() {
    await Promise.all([
      Organization.init(), UsageRecord.init(), BillingInvoice.init(), Project.init(), User.init(),
      AuthSession.init(), AuthChallenge.init(), Customer.init(), DevelopmentLetter.init(), MailMessage.init(),
      MailSyncState.init(), FollowUp.init(), CustomerEvent.init(), CustomerAttachment.init(), Product.init(),
      ProjectPlaybook.init(), Quotation.init(), LetterTemplate.init(), Scratchpad.init(), AgentSession.init(),
      AgentMessage.init(), AgentRun.init(), AgentAction.init(), AgentCustomerPreview.init(),
      KnowledgeFeedback.init(), KnowledgeTrainingState.init(), UserMailAccount.init(), MailQuotaBucket.init(),
      MailAccountAudit.init(), OutreachAutomationConfig.init(), OutreachAutomationEnrollment.init(),
      OutreachAutomationDay.init(), AgentAiSettings.init(), AgentAiProvider.init(),
    ]);
    // These collections intentionally sync explicitly because their index
    // definitions changed after early deployments.
    await AuthChallenge.syncIndexes();
    await Promise.all([
      Project.syncIndexes(),
      EmailSuppression.syncIndexes(),
      AgentAiSettings.syncIndexes(),
      AgentAiProvider.syncIndexes(),
    ]);
  },
};
