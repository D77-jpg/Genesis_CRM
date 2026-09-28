import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Types } from 'mongoose';
import env from '../../config/env';
import { AgentAiSettings, type AgentAiSettingsDocument } from '../../models/AgentAiSettings';
import { decryptAiCredential, encryptAiCredential } from '../credential-crypto';
import type { AuthUser } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import type { AiSettingsInput } from '../../validators/ai-settings.validator';
import { MockAgentProvider } from './mock-provider';
import { OpenAIResponsesProvider } from './openai-provider';
import { AgentProviderError, type AgentProvider } from './provider';

const KEY = 'global';

interface ResolvedSettings {
  provider: 'mock' | 'openai';
  model: string;
  baseUrl: string;
  apiKey: string;
  source: 'database' | 'environment';
  keySource: 'database' | 'environment' | 'none';
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized !== '::' && normalized !== '::1' && !normalized.startsWith('ff') && !normalized.startsWith('fc') &&
      !normalized.startsWith('fd') && !normalized.startsWith('fe8') &&
      !normalized.startsWith('fe9') && !normalized.startsWith('fea') &&
      !normalized.startsWith('feb') && !normalized.startsWith('::ffff:');
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)));
}

/** Configuration is admin-only, but never let an arbitrary URL reach cloud metadata or the LAN. */
export async function validateAiBaseUrl(value: string, production = env.isProd): Promise<string> {
  let url: URL;
  try { url = new URL(value); } catch { throw ApiError.badRequest('API 地址无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw ApiError.badRequest('API 地址仅支持无凭证、无查询参数的 HTTP(S) 基址');
  }
  if (production && url.protocol !== 'https:') throw ApiError.badRequest('生产环境 AI 地址必须使用 HTTPS');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.') || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (production || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw ApiError.badRequest('该 AI 主机地址不允许使用');
    }
    return url.toString().replace(/\/$/, '');
  }
  if (isIP(hostname)) {
    if (!publicAddress(hostname) && !(env.isDev && ['127.0.0.1', '::1'].includes(hostname))) {
      throw ApiError.badRequest('AI 地址不得指向内网或保留地址');
    }
  } else {
    let addresses: { address: string }[];
    try { addresses = await lookup(hostname, { all: true }); }
    catch { throw ApiError.badRequest('AI 主机 DNS 解析失败'); }
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
      throw ApiError.badRequest('AI 地址解析到了内网或保留地址');
    }
  }
  return url.toString().replace(/\/$/, '');
}

function storedKey(doc: AgentAiSettingsDocument | null): string | null {
  if (!doc?.credentialCiphertext || !doc.credentialIv || !doc.credentialTag) return null;
  try {
    return decryptAiCredential({ ciphertext: doc.credentialCiphertext, iv: doc.credentialIv, tag: doc.credentialTag });
  } catch {
    throw ApiError.internal('AI 密钥无法解密，请检查服务器加密密钥');
  }
}

async function storedSettings(): Promise<AgentAiSettingsDocument | null> {
  return AgentAiSettings.findOne({ key: KEY }).select('+credentialCiphertext +credentialIv +credentialTag').exec();
}

function resolved(doc: AgentAiSettingsDocument | null, replacementKey?: string, requestedProvider?: 'mock' | 'openai'): ResolvedSettings {
  const provider = requestedProvider ?? doc?.provider ?? env.AI_PROVIDER;
  const databaseKey = replacementKey || (provider === 'mock' ? null : storedKey(doc));
  const environmentKey = env.OPENAI_API_KEY || '';
  return {
    provider,
    model: doc?.modelName ?? env.OPENAI_MODEL,
    baseUrl: doc?.baseUrl ?? env.OPENAI_BASE_URL,
    apiKey: databaseKey || environmentKey,
    source: doc ? 'database' : 'environment',
    keySource: databaseKey || doc?.credentialCiphertext ? 'database' : environmentKey ? 'environment' : 'none',
  };
}

function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}

function publicSettings(config: ResolvedSettings, updatedAt?: Date) {
  return {
    provider: config.provider, model: config.model, baseUrl: safeDisplayUrl(config.baseUrl),
    source: config.source, keySource: config.keySource, keyConfigured: config.keySource !== 'none',
    updatedAt: updatedAt ?? null,
  };
}

export async function getAiSettings(actor: AuthUser) {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可配置 AI');
  const doc = await storedSettings();
  // Reading the admin page must still work after an encryption-key rotation, so
  // operators can replace an unreadable stored credential without exposing it.
  const keySource = doc?.credentialCiphertext ? 'database' : env.OPENAI_API_KEY ? 'environment' : 'none';
  return publicSettings({
    provider: doc?.provider ?? env.AI_PROVIDER,
    model: doc?.modelName ?? env.OPENAI_MODEL,
    baseUrl: doc?.baseUrl ?? env.OPENAI_BASE_URL,
    apiKey: '', source: doc ? 'database' : 'environment', keySource,
  }, doc?.updatedAt);
}

function candidate(input: AiSettingsInput, doc: AgentAiSettingsDocument | null): ResolvedSettings {
  const newKey = input.apiKey?.trim();
  const current = resolved(doc, newKey, input.provider);
  return {
    provider: input.provider, model: input.model.trim(), baseUrl: input.baseUrl.trim(),
    apiKey: newKey || current.apiKey,
    source: 'database',
    keySource: newKey ? 'database' : current.keySource,
  };
}

async function probe(config: ResolvedSettings): Promise<void> {
  if (config.provider === 'mock') return;
  const baseUrl = await validateAiBaseUrl(config.baseUrl);
  if (!config.apiKey) throw ApiError.badRequest('请先填写 API Key');
  const provider = new OpenAIResponsesProvider({
    apiKey: config.apiKey, model: config.model, baseUrl, timeoutMs: Math.min(env.AI_REQUEST_TIMEOUT_MS, 20000),
  });
  try {
    const result = await provider.createTurn({
      instructions: 'Reply with OK.', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Ping' }] }],
      tools: [], context: { type: 'global' }, userPrompt: 'Ping', safetyIdentifier: 'admin-ai-config-test',
    });
    if (!result.text.trim()) throw new AgentProviderError('OPENAI_EMPTY_RESPONSE');
  } catch (error) {
    const rawCode = error instanceof AgentProviderError ? error.code : '';
    const code = /^OPENAI_(?:UNREACHABLE|TIMEOUT|INVALID_RESPONSE|EMPTY_RESPONSE|(?:4|5)\d\d)$/.test(rawCode)
      ? rawCode : 'AI_TEST_FAILED';
    throw ApiError.badRequest(`AI 连通性验证失败（${code}）；原配置未更改`);
  }
}

export async function testAiSettings(input: AiSettingsInput, actor: AuthUser) {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可配置 AI');
  await probe(candidate(input, await storedSettings()));
  return { ok: true, provider: input.provider, model: input.model };
}

export async function saveAiSettings(input: AiSettingsInput, actor: AuthUser) {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可配置 AI');
  const doc = await storedSettings();
  const config = candidate(input, doc);
  await probe(config); // Never activate an untested live provider.
  const newKey = input.apiKey?.trim();
  const encrypted = newKey ? encryptAiCredential(newKey) : null;
  const saved = await AgentAiSettings.findOneAndUpdate({ key: KEY }, {
    $set: {
      provider: config.provider, modelName: config.model, baseUrl: config.baseUrl,
      updatedBy: new Types.ObjectId(actor.id),
      ...(encrypted ? { credentialCiphertext: encrypted.ciphertext, credentialIv: encrypted.iv, credentialTag: encrypted.tag } : {}),
    },
    $setOnInsert: { key: KEY },
  }, { upsert: true, new: true, runValidators: true }).exec();
  return publicSettings(config, saved?.updatedAt);
}

export async function resolveAgentProvider(): Promise<AgentProvider> {
  const config = resolved(await storedSettings());
  if (config.provider === 'mock') return new MockAgentProvider();
  const baseUrl = await validateAiBaseUrl(config.baseUrl);
  return new OpenAIResponsesProvider({ apiKey: config.apiKey, model: config.model, baseUrl, timeoutMs: env.AI_REQUEST_TIMEOUT_MS });
}
