/**
 * IntegrationCredential 模型（Integration API v1）
 * ------------------------------------------------------------------
 * 供 AutoForceAI 等外部系统以「服务凭证」接入 Genesis。
 *
 * 安全约定：
 *   - 原始 token 形如 `gci_<48 hex>`，仅在创建/轮换时返回一次；
 *   - 数据库只存 SHA-256 哈希（tokenHash），泄露库文件不泄露可用凭证；
 *   - tokenPrefix 只用于管理界面脱敏展示（如前 12 位）；
 *   - 凭证绑定一个或多个 projectId（首版建议一项目一 token），无默认项目回退；
 *   - 支持 expiresAt 过期、revoked 撤销、rotate 轮换（见 integration-credential.service）。
 */
import { Schema, model, Types, type HydratedDocument, type Model } from 'mongoose';
import {
  INTEGRATION_CREDENTIAL_STATUS,
  INTEGRATION_SCOPES,
  type IntegrationCredentialStatus,
  type IntegrationScope,
} from '../constants';

export interface IIntegrationCredential {
  /** 显示名，例如 "AutoForceAI 生产环境" */
  name: string;
  /** token 的 SHA-256 哈希（hex）；唯一索引 */
  tokenHash: string;
  /** token 前缀（含 gci_），仅用于脱敏展示 */
  tokenPrefix: string;
  /** 授权 scope 集合 */
  scopes: IntegrationScope[];
  /** 绑定的项目集合（必填，至少一个） */
  projectIds: Types.ObjectId[];
  status: IntegrationCredentialStatus;
  /** 过期时间（可选；过期视同失效） */
  expiresAt?: Date | null;
  /** 最近一次成功使用时间（由中间件节流更新） */
  lastUsedAt?: Date | null;
  /** 轮换：新凭证的 rotatedFrom 指向上一个凭证 */
  rotatedFrom?: Types.ObjectId | null;
  note?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationCredentialDocument = HydratedDocument<IIntegrationCredential>;
export type IntegrationCredentialModel = Model<IIntegrationCredential>;

const IntegrationCredentialSchema = new Schema<IIntegrationCredential>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    tokenHash: { type: String, required: true, unique: true, index: true, select: false },
    tokenPrefix: { type: String, required: true, maxlength: 16 },
    scopes: {
      type: [String],
      enum: { values: INTEGRATION_SCOPES, message: '集成 scope 取值非法' },
      default: [],
    },
    projectIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
      required: true,
      validate: {
        validator: (v: Types.ObjectId[]) => Array.isArray(v) && v.length > 0,
        message: '集成凭证必须至少绑定一个项目',
      },
    },
    status: {
      type: String,
      enum: { values: INTEGRATION_CREDENTIAL_STATUS, message: '凭证状态非法' },
      default: 'active',
      index: true,
    },
    expiresAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    rotatedFrom: { type: Schema.Types.ObjectId, ref: 'IntegrationCredential', default: null },
    note: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.tokenHash;
        return ret;
      },
    },
  },
);

export const IntegrationCredential = model<IIntegrationCredential>(
  'IntegrationCredential',
  IntegrationCredentialSchema,
);
export default IntegrationCredential;
