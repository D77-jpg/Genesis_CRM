/**
 * IntegrationIdempotency 模型（Integration API v1 请求幂等）
 * ------------------------------------------------------------------
 * 写端点（customers/upsert）要求调用方携带 Idempotency-Key：
 *   - 同一凭证 + 同一 key + 相同载荷哈希 → 直接重放首次响应（不重复建客户）；
 *   - 同一凭证 + 同一 key + 不同载荷 → 409 CONFLICT；
 *   - 重试必须复用原 key（AutoForceAI outbox 保证）。
 *
 * 与业务唯一键 (projectId, sourceSystem, externalId) 互补：
 * 业务键保证「最终结果幂等」，请求键保证「并发/重试期间响应一致」。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';

export interface IIntegrationIdempotency {
  credentialId: Types.ObjectId;
  projectId: Types.ObjectId;
  /** 调用方提供的 Idempotency-Key */
  key: string;
  /** 规范化请求体的 SHA-256（hex），用于检测同键不同载荷 */
  requestHash: string;
  /** 原子占位状态：先 processing，业务成功后再 completed */
  state: 'processing' | 'completed';
  /** 当前处理者；只在 processing 状态存在 */
  owner?: string;
  /** 处理租约，worker 中断后允许安全接管 */
  leaseExpiresAt?: Date;
  /** 首次成功的响应 data（重放用） */
  response?: Record<string, unknown>;
  /** 首次响应的 HTTP 状态码（200/201） */
  statusCode?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationIdempotencyDocument = HydratedDocument<IIntegrationIdempotency>;
export type IntegrationIdempotencyModel = Model<IIntegrationIdempotency>;

const IntegrationIdempotencySchema = new Schema<IIntegrationIdempotency>(
  {
    credentialId: { type: Schema.Types.ObjectId, ref: 'IntegrationCredential', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String, required: true, maxlength: 128 },
    requestHash: { type: String, required: true, maxlength: 64 },
    state: { type: String, enum: ['processing', 'completed'], required: true, default: 'processing' },
    owner: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    response: { type: Schema.Types.Mixed, default: null },
    statusCode: { type: Number, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

IntegrationIdempotencySchema.index({ credentialId: 1, key: 1 }, { unique: true });

export const IntegrationIdempotency = model<IIntegrationIdempotency>(
  'IntegrationIdempotency',
  IntegrationIdempotencySchema,
);
export default IntegrationIdempotency;
