import './tenant-setup';
/**
 * 模型统一出口
 * ------------------------------------------------------------------
 * 业务代码只从 '../models' 引入，方便后续替换持久层实现。
 */
export { Organization } from './Organization';
export type { IOrganization, OrganizationDocument, OrganizationModel, OrganizationStatus } from './Organization';

export { UsageRecord, USAGE_METRICS } from './UsageRecord';
export type { IUsageRecord, UsageRecordDocument, UsageRecordModel, UsageMetric } from './UsageRecord';

export { BillingInvoice } from './BillingInvoice';
export type { IBillingInvoice, BillingInvoiceDocument, BillingInvoiceModel, IInvoiceLine, InvoiceStatus } from './BillingInvoice';

export { Customer } from './Customer';
export type { ICustomer, ICustomerMethods, CustomerDocument, CustomerModel } from './Customer';

export { DevelopmentLetter } from './DevelopmentLetter';
export type { IDevelopmentLetter, DevelopmentLetterDocument } from './DevelopmentLetter';

export { LetterTemplate } from './LetterTemplate';
export type { ILetterTemplate, LetterTemplateDocument } from './LetterTemplate';

export { FollowUp } from './FollowUp';
export type { IFollowUp, FollowUpDocument } from './FollowUp';

export { CustomerEvent } from './CustomerEvent';
export type { ICustomerEvent, CustomerEventDocument } from './CustomerEvent';

export { CustomerAttachment } from './CustomerAttachment';
export type { ICustomerAttachment, CustomerAttachmentDocument } from './CustomerAttachment';

export { ProjectPlaybook } from './ProjectPlaybook';
export type { IProjectPlaybook, ProjectPlaybookDocument, ProjectPlaybookModel } from './ProjectPlaybook';

export { Product } from './Product';
export type { IProduct, ProductSpec, ProductPriceTier, ProductDocument, ProductModel } from './Product';

export { Quotation, computeQuotationTotals, roundMoney } from './Quotation';
export type {
  IQuotation,
  IQuotationItem,
  IQuotationProposalSource,
  IQuotationProposalTrace,
  QuotationDocument,
} from './Quotation';

export { User, hashPassword } from './User';
export type { IUser, IUserMethods, UserDocument, UserModel, UserRole, UserStatus } from './User';

export { AuthSession } from './AuthSession';
export type { IAuthSession, AuthSessionDocument } from './AuthSession';

export { AuthChallenge } from './AuthChallenge';
export type { IAuthChallenge, AuthChallengeDocument, AuthChallengePurpose } from './AuthChallenge';

export { AuditLog, AUDIT_ACTIONS } from './AuditLog';
export type { AuditAction, IAuditLog, AuditLogDocument } from './AuditLog';

export { EmailSuppression, SUPPRESSION_REASONS } from './EmailSuppression';
export type { IEmailSuppression, EmailSuppressionDocument, SuppressionReason } from './EmailSuppression';

export { UserMailAccount, MailQuotaBucket, MailAccountAudit } from './UserMailAccount';
export type {
  IUserMailAccount,
  UserMailAccountDocument,
  MailAccountStatus,
  MailVerificationStatus,
} from './UserMailAccount';

export { Project } from './Project';
export type { IProject, ProjectDocument, ProjectModel, ProjectStatus, ProjectBrandProfile, ProjectMailCompliance } from './Project';

export { Scratchpad } from './Scratchpad';
export type { IScratchpad, ScratchpadDocument, ScratchpadModel } from './Scratchpad';

export { AgentSession, AgentMessage, AgentRun, AgentAction, AgentQuotaBucket } from './Agent';
export type {
  IAgentSession,
  IAgentMessage,
  IAgentRun,
  IAgentAction,
  IAgentQuotaBucket,
  AgentContextType,
  AgentProviderName,
  AgentSessionDocument,
  AgentMessageDocument,
  AgentRunDocument,
  AgentActionDocument,
  AgentQuotaBucketDocument,
} from './Agent';

export { AgentAiSettings } from './AgentAiSettings';
export type { IAgentAiSettings, AgentAiSettingsDocument } from './AgentAiSettings';

export { AgentAiProvider } from './AgentAiProvider';
export type { IAgentAiProvider, AgentAiProviderDocument, AgentAiProviderKind } from './AgentAiProvider';

export { AgentCustomerPreview, AGENT_CUSTOMER_FIELDS } from './AgentCustomerPreview';
export type {
  IAgentCustomerPreview,
  AgentCustomerPreviewDocument,
  AgentCustomerPreviewFields,
  AgentCustomerUncertainty,
  AgentCustomerDuplicate,
  AgentCustomerField,
} from './AgentCustomerPreview';

export { AgentCustomerAnalysis } from './AgentCustomerAnalysis';
export type {
  IAgentCustomerAnalysis,
  AgentCustomerAnalysisDocument,
  AgentAnalysisSource,
  AgentAnalysisSourceKind,
  AgentAnalysisClaim,
} from './AgentCustomerAnalysis';

export { AgentMailThreadAnalysis, AGENT_MAIL_INTENTS, AGENT_MAIL_SAFETY } from './AgentMailThreadAnalysis';
export type {
  IAgentMailThreadAnalysis,
  AgentMailThreadAnalysisDocument,
  AgentMailIntent,
  AgentMailSafety,
  AgentMailEvidenceValue,
  AgentMailQuestion,
} from './AgentMailThreadAnalysis';

export { AgentEvalRun } from './AgentEvalRun';
export type { IAgentEvalRun, AgentEvalRunDocument, AgentEvalCaseResult } from './AgentEvalRun';

export { KnowledgeFeedback, FEEDBACK_ISSUES } from './KnowledgeFeedback';
export type { IKnowledgeFeedback, KnowledgeFeedbackDocument, FeedbackIssue } from './KnowledgeFeedback';

export { KnowledgeTrainingState } from './KnowledgeTrainingState';
export type { IKnowledgeTrainingState, KnowledgeTrainingStateDocument } from './KnowledgeTrainingState';

export { IntegrationCredential } from './IntegrationCredential';
export type {
  IIntegrationCredential,
  IntegrationCredentialDocument,
  IntegrationCredentialModel,
} from './IntegrationCredential';

export { IntegrationRequestLog } from './IntegrationRequestLog';
export type {
  IIntegrationRequestLog,
  IntegrationRequestLogDocument,
  IntegrationRequestLogModel,
} from './IntegrationRequestLog';

export { IntegrationIdempotency } from './IntegrationIdempotency';
export type {
  IIntegrationIdempotency,
  IntegrationIdempotencyDocument,
  IntegrationIdempotencyModel,
} from './IntegrationIdempotency';

export {
  OutreachAutomationConfig,
  OutreachAutomationEnrollment,
  OutreachAutomationDay,
} from './OutreachAutomation';
export type {
  IOutreachAutomationConfig,
  IOutreachAutomationEnrollment,
  OutreachAutomationEnrollmentStatus,
  OutreachAutomationConfigDocument,
  OutreachAutomationEnrollmentDocument,
} from './OutreachAutomation';
