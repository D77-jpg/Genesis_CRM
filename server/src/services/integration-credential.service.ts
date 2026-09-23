/**
 * 集成服务凭证服务（Integration API v1）
 * ------------------------------------------------------------------
 * 签发 / 校验 / 轮换 / 撤销服务凭证。
 * 原始 token 只在 create / rotate 的返回值里出现一次，数据库只存 SHA-256 哈希。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import { INTEGRATION_SCOPES, type IntegrationScope } from '../constants';
import { ApiError } from '../utils/ApiError';
import { IntegrationCredential, Project, type IntegrationCredentialDocument } from '../models';

const TOKEN_PREFIX = 'gci_';
const TOKEN_BYTES = 24; // 48 hex chars

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 生成新 token；返回值只在创建/轮换时展示一次 */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`;
}

export interface CreateCredentialInput {
  name: string;
  projectIds: string[];
  scopes: string[];
  expiresAt?: Date | null;
  note?: string;
  createdBy?: string;
}

function assertValidScopes(scopes: string[]): IntegrationScope[] {
  const valid = new Set<string>(INTEGRATION_SCOPES);
  const invalid = scopes.filter((s) => !valid.has(s));
  if (invalid.length > 0) {
    throw ApiError.badRequest(`非法 scope: ${invalid.join(', ')}（可选：${INTEGRATION_SCOPES.join(', ')}）`);
  }
  if (scopes.length === 0) {
    throw ApiError.badRequest('至少需要一个 scope');
  }
  return scopes as IntegrationScope[];
}

async function assertProjectsExist(projectIds: string[]): Promise<Types.ObjectId[]> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) throw ApiError.badRequest('必须至少绑定一个项目');
  for (const id of ids) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest(`非法项目 ID: ${id}`);
  }
  const found = await Project.find({ _id: { $in: ids } }).select('_id');
  if (found.length !== ids.length) {
    const foundIds = new Set(found.map((p) => String(p._id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    throw ApiError.badRequest(`项目不存在: ${missing.join(', ')}`);
  }
  return ids.map((id) => new Types.ObjectId(id));
}

export interface CreatedCredential {
  credential: IntegrationCredentialDocument;
  /** 原始 token，仅此一次 */
  token: string;
}

export async function createCredential(input: CreateCredentialInput): Promise<CreatedCredential> {
  const scopes = assertValidScopes(input.scopes);
  const projectObjectIds = await assertProjectsExist(input.projectIds);

  const token = generateToken();
  const credential = await IntegrationCredential.create({
    name: input.name.trim(),
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, 12),
    scopes,
    projectIds: projectObjectIds,
    status: 'active',
    expiresAt: input.expiresAt ?? null,
    note: input.note,
    createdBy: input.createdBy ? new Types.ObjectId(input.createdBy) : undefined,
  });
  return { credential, token };
}

/** 轮换：签发新 token（同一凭证记录，scope/项目不变），旧 token 立即失效 */
export async function rotateCredential(id: string): Promise<CreatedCredential> {
  const credential = await IntegrationCredential.findById(id);
  if (!credential) throw ApiError.notFound('凭证不存在');
  if (credential.status === 'revoked') throw ApiError.conflict('凭证已撤销，不能轮换');

  const token = generateToken();
  credential.tokenHash = hashToken(token);
  credential.tokenPrefix = token.slice(0, 12);
  await credential.save();
  return { credential, token };
}

export async function revokeCredential(id: string): Promise<IntegrationCredentialDocument> {
  const credential = await IntegrationCredential.findById(id);
  if (!credential) throw ApiError.notFound('凭证不存在');
  credential.status = 'revoked';
  await credential.save();
  return credential;
}

export interface VerifiedCredential {
  id: string;
  scopes: string[];
  projectIds: string[];
}

/**
 * 校验 Bearer token：存在、active、未过期。
 * 命中后节流更新 lastUsedAt（每 60 秒最多一次写库）。
 */
export async function verifyToken(token: string): Promise<VerifiedCredential | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  // 哈希等值查询命中后再用 timingSafeEqual 双重确认，避免时序侧信道
  const credential = await IntegrationCredential.findOne({ tokenHash: hash, status: 'active' })
    .select('+tokenHash');
  if (!credential || !credential.tokenHash) return null;

  const a = Buffer.from(credential.tokenHash, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) return null;

  const now = Date.now();
  if (!credential.lastUsedAt || now - credential.lastUsedAt.getTime() > 60_000) {
    // 不阻塞请求路径的节流更新
    void IntegrationCredential.updateOne(
      { _id: credential._id },
      { $set: { lastUsedAt: new Date(now) } },
    ).catch(() => undefined);
  }

  return {
    id: String(credential._id),
    scopes: credential.scopes,
    projectIds: credential.projectIds.map(String),
  };
}
