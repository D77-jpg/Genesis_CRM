/**
 * IntegrationRequestLog 模型（Integration API v1 审计日志）
 * ------------------------------------------------------------------
 * 每次集成 API 请求记录一条：谁（凭证）、对哪个项目、做了什么、结果如何、耗时多少。
 *
 * 安全约定：绝不记录 token 原文、请求体全文或询盘/邮件内容；
 * 只保留 requestId、凭证、项目、路由、状态码、错误码与耗时（脱敏摘要）。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export interface IIntegrationRequestLog {
  /** 服务端生成的请求 ID（同时通过 X-Request-Id 返回给调用方） */
  requestId: string;
  credentialId?: Types.ObjectId | null;
  projectId?: Types.ObjectId | null;
  method: string;
  /** 路由模板（如 /integrations/v1/customers/upsert），不含查询串 */
  route: string;
  /** 本次请求涉及的 scope（读端点记录所需 scope，写端点同） */
  scope?: string | null;
  statusCode: number;
  errorCode?: string | null;
  latencyMs: number;
  /** 业务外部 ID（如 lead:1024），便于两端对账；可选 */
  externalId?: string | null;
  createdAt: Date;
}

export type IntegrationRequestLogDocument = HydratedDocument<IIntegrationRequestLog>;
export type IntegrationRequestLogModel = Model<IIntegrationRequestLog>;

const IntegrationRequestLogSchema = new Schema<IIntegrationRequestLog>(
  {
    requestId: { type: String, required: true, index: true },
    credentialId: { type: Schema.Types.ObjectId, ref: 'IntegrationCredential', default: null, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    method: { type: String, required: true, maxlength: 10 },
    route: { type: String, required: true, maxlength: 200 },
    scope: { type: String, default: null, maxlength: 60 },
    statusCode: { type: Number, required: true },
    errorCode: { type: String, default: null, maxlength: 60 },
    latencyMs: { type: Number, required: true, min: 0 },
    externalId: { type: String, default: null, maxlength: 160 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// 审计检索：按凭证 / 项目 + 时间倒序
IntegrationRequestLogSchema.index({ credentialId: 1, createdAt: -1 });
IntegrationRequestLogSchema.index({ projectId: 1, createdAt: -1 });

export const IntegrationRequestLog = model<IIntegrationRequestLog>(
  'IntegrationRequestLog',
  IntegrationRequestLogSchema,
);
export default IntegrationRequestLog;
