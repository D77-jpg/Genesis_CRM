/**
 * 模型统一出口
 * ------------------------------------------------------------------
 * 业务代码只从 '../models' 引入，方便后续替换持久层实现。
 */
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

export { Quotation, computeQuotationTotals, roundMoney } from './Quotation';
export type { IQuotation, IQuotationItem, QuotationDocument } from './Quotation';

export { User, hashPassword } from './User';
export type { IUser, IUserMethods, UserDocument, UserModel, UserRole, UserStatus } from './User';

export { Project } from './Project';
export type { IProject, ProjectDocument, ProjectModel, ProjectStatus } from './Project';

export { Scratchpad } from './Scratchpad';
export type { IScratchpad, ScratchpadDocument, ScratchpadModel } from './Scratchpad';

export { AgentSession, AgentMessage, AgentRun, AgentAction } from './Agent';
export type {
  IAgentSession,
  IAgentMessage,
  IAgentRun,
  IAgentAction,
  AgentContextType,
  AgentProviderName,
  AgentSessionDocument,
  AgentMessageDocument,
  AgentRunDocument,
  AgentActionDocument,
} from './Agent';

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
