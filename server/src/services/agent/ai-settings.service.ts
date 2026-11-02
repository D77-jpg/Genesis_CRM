import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Types } from 'mongoose';
import env from '../../config/env';
import { AgentAiProvider, type AgentAiProviderDocument } from '../../models/AgentAiProvider';
import { AgentAiSettings, type AgentAiSettingsDocument } from '../../models/AgentAiSettings';
import { decryptAiCredential, encryptAiCredential } from '../credential-crypto';
import type { AuthUser } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import type { AiProviderInput, AiSettingsInput } from '../../validators/ai-settings.validator';
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

export interface AiProviderPublic {
  id: string;
  name: string;
  kind: 'mock' | 'openai';
  model: string;
  baseUrl: string;
  keyConfigured: boolean;
  keySource: 'database' | 'environment' | 'none';
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestStatus: 'ok' | 'failed' | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderCatalog {
  providers: AiProviderPublic[];
  activeProviderId: string | null;
  fallback: {
    provider: 'mock' | 'openai';
    model: string;
    baseUrl: string;
    source: 'database' | 'environment';
    keySource: 'database' | 'environment' | 'none';
    keyConfigured: boolean;
    updatedAt: string | null;
  };
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

function assertAdmin(actor: AuthUser): void {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可配置 AI');
}

function storedProviderKey(doc: AgentAiProviderDocument): string | null {
  if (!doc.credentialCiphertext || !doc.credentialIv || !doc.credentialTag) return null;
  try {
    return decryptAiCredential({ ciphertext: doc.credentialCiphertext, iv: doc.credentialIv, tag: doc.credentialTag });
  } catch {
    throw ApiError.internal('AI 密钥无法解密，请检查服务器加密密钥');
  }
}

function resolvedProvider(doc: AgentAiProviderDocument, replacementKey?: string): ResolvedSettings {
  const databaseKey = replacementKey || (doc.kind === 'mock' ? null : storedProviderKey(doc));
  return {
    provider: doc.kind,
    model: doc.modelName,
    baseUrl: doc.baseUrl,
    apiKey: databaseKey || '',
    source: 'database',
    keySource: databaseKey ? 'database' : 'none',
  };
}

function publicProvider(doc: AgentAiProviderDocument, activeProviderId?: unknown): AiProviderPublic {
  return {
    id: String(doc._id),
    name: doc.name,
    kind: doc.kind,
    model: doc.modelName,
    baseUrl: safeDisplayUrl(doc.baseUrl),
    keyConfigured: Boolean(doc.credentialCiphertext),
    keySource: doc.credentialCiphertext ? 'database' : 'none',
    isActive: Boolean(activeProviderId && String(activeProviderId) === String(doc._id)),
    lastTestedAt: doc.lastTestedAt ? doc.lastTestedAt.toISOString() : null,
    lastTestStatus: doc.lastTestStatus ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function providerDisplayName(baseUrl: string, model: string): string {
  const host = (() => { try { return new URL(baseUrl).hostname.toLowerCase(); } catch { return ''; } })();
  if (host.includes('deepseek')) return 'DeepSeek';
  if (host.includes('openrouter')) return 'OpenRouter';
  if (host.includes('openai')) return 'OpenAI';
  if (model.trim()) return `${model.trim()} 服务`;
  return 'AI 服务';
}

function sameNamePattern(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

async function storedProvider(id: string): Promise<AgentAiProviderDocument | null> {
  return AgentAiProvider.findById(id).select('+credentialCiphertext +credentialIv +credentialTag').exec();
}

/** 把旧版单例配置迁移成一个可编辑的服务商，避免升级后历史配置消失。 */
async function ensureLegacyProvider(): Promise<void> {
  if (await AgentAiProvider.exists({})) return;
  const doc = await storedSettings();
  if (!doc) return;
  const kind = doc.provider;
  // A legacy live config without its own encrypted key is using the environment key;
  // leave it as fallback rather than migrating an unusable provider profile.
  if (kind === 'openai' && !doc.credentialCiphertext) return;
  const modelName = kind === 'mock' ? 'mock' : doc.modelName;
  const name = kind === 'mock' ? '演示模式' : providerDisplayName(doc.baseUrl, doc.modelName);
  try {
    const created = await AgentAiProvider.create({
      name,
      kind,
      modelName,
      baseUrl: kind === 'mock' ? '' : doc.baseUrl,
      credentialCiphertext: doc.credentialCiphertext,
      credentialIv: doc.credentialIv,
      credentialTag: doc.credentialTag,
      createdBy: doc.updatedBy,
      updatedBy: doc.updatedBy,
    });
    await AgentAiSettings.updateOne({ _id: doc._id }, { $set: { activeProviderId: created._id } });
  } catch (error) {
    // A concurrent first load may have created the same provider; keep the existing one.
    if (!(error instanceof Error) || !/duplicate key/i.test(error.message)) throw error;
    const existing = await AgentAiProvider.findOne({ name: sameNamePattern(name) });
    if (existing) await AgentAiSettings.updateOne({ _id: doc._id }, { $set: { activeProviderId: existing._id } });
  }
}

async function activeProviderDoc(): Promise<AgentAiProviderDocument | null> {
  const settings = await AgentAiSettings.findOne({ key: KEY }).select('activeProviderId').lean();
  if (!settings?.activeProviderId) return null;
  return storedProvider(String(settings.activeProviderId));
}

function providerSettingsFields(provider: AgentAiProviderDocument) {
  return {
    provider: provider.kind,
    modelName: provider.modelName || 'mock',
    baseUrl: provider.baseUrl || 'https://mock.local',
    ...(provider.credentialCiphertext ? {
      credentialCiphertext: provider.credentialCiphertext,
      credentialIv: provider.credentialIv,
      credentialTag: provider.credentialTag,
    } : {}),
  };
}

async function syncActiveSettings(provider: AgentAiProviderDocument, actor: AuthUser): Promise<void> {
  const settings = await AgentAiSettings.findOne({ key: KEY }).select('activeProviderId').lean();
  if (!settings?.activeProviderId || String(settings.activeProviderId) !== String(provider._id)) return;
  await AgentAiSettings.updateOne({ key: KEY }, {
    $set: { ...providerSettingsFields(provider), updatedBy: new Types.ObjectId(actor.id) },
  });
}

export async function getAiSettings(actor: AuthUser) {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可配置 AI');
  const active = await activeProviderDoc();
  if (active) return publicSettings(resolvedProvider(active), active.updatedAt);
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

async function providerCandidate(input: AiProviderInput, existing: AgentAiProviderDocument | null): Promise<ResolvedSettings> {
  if (input.kind === 'mock') {
    return { provider: 'mock', model: 'mock', baseUrl: '', apiKey: '', source: 'database', keySource: 'none' };
  }
  const newKey = input.apiKey?.trim();
  const currentKey = newKey || (existing ? storedProviderKey(existing) : null);
  if (!currentKey) throw ApiError.badRequest('第一次接入真实 AI 要填写 API Key');
  const baseUrl = await validateAiBaseUrl(input.baseUrl.trim());
  return {
    provider: 'openai',
    model: input.model.trim(),
    baseUrl,
    apiKey: currentKey,
    source: 'database',
    keySource: newKey || existing?.credentialCiphertext ? 'database' : 'none',
  };
}

export async function testAiSettings(input: AiSettingsInput, actor: AuthUser) {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可配置 AI');
  const active = await activeProviderDoc();
  if (active) {
    const result = await testAiProvider({
      name: active.name,
      kind: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
    }, actor, String(active._id));
    return { ok: true, provider: result.provider, model: result.model };
  }
  await probe(candidate(input, await storedSettings()));
  return { ok: true, provider: input.provider, model: input.model };
}

export async function saveAiSettings(input: AiSettingsInput, actor: AuthUser) {
  if (actor.role !== 'admin') throw ApiError.forbidden('仅管理员可配置 AI');
  const active = await activeProviderDoc();
  if (active) {
    // Keep the legacy single-provider endpoint working after migration by editing
    // the currently active provider instead of writing an ignored singleton.
    await updateAiProvider(String(active._id), {
      name: active.name,
      kind: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
    }, actor);
    return getAiSettings(actor);
  }
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

export async function listAiProviders(actor: AuthUser): Promise<AiProviderCatalog> {
  assertAdmin(actor);
  await ensureLegacyProvider();
  const [docs, settings] = await Promise.all([
    AgentAiProvider.find().select('+credentialCiphertext').sort({ createdAt: 1 }).exec(),
    storedSettings(),
  ]);
  const requestedActiveId = settings?.activeProviderId ? String(settings.activeProviderId) : null;
  const activeProviderId = docs.some((doc) => String(doc._id) === requestedActiveId) ? requestedActiveId : null;
  const environmentKey = env.OPENAI_API_KEY || '';
  return {
    providers: docs.map((doc) => publicProvider(doc, activeProviderId)),
    activeProviderId,
    fallback: {
      provider: settings?.provider ?? env.AI_PROVIDER,
      model: settings?.modelName ?? env.OPENAI_MODEL,
      baseUrl: safeDisplayUrl(settings?.baseUrl ?? env.OPENAI_BASE_URL),
      source: settings ? 'database' : 'environment',
      keySource: settings?.credentialCiphertext ? 'database' : environmentKey ? 'environment' : 'none',
      keyConfigured: Boolean(settings?.credentialCiphertext || environmentKey),
      updatedAt: settings?.updatedAt ? settings.updatedAt.toISOString() : null,
    },
  };
}

export async function testAiProvider(input: AiProviderInput, actor: AuthUser, existingId?: string) {
  assertAdmin(actor);
  const existing = existingId ? await storedProvider(existingId) : null;
  if (existingId && !existing) throw ApiError.notFound('AI 服务不存在或已删除');
  const config = await providerCandidate(input, existing);
  const startedAt = Date.now();
  try {
    await probe(config);
  } catch (error) {
    if (existing) {
      existing.lastTestedAt = new Date();
      existing.lastTestStatus = 'failed';
      await existing.save();
    }
    throw error;
  }
  if (existing) {
    existing.lastTestedAt = new Date();
    existing.lastTestStatus = 'ok';
    await existing.save();
  }
  return { ok: true, provider: config.provider, model: config.model, latencyMs: Date.now() - startedAt };
}

export async function testStoredAiProvider(id: string, actor: AuthUser) {
  assertAdmin(actor);
  const existing = await storedProvider(id);
  if (!existing) throw ApiError.notFound('AI 服务不存在或已删除');
  const startedAt = Date.now();
  try {
    await probe(resolvedProvider(existing));
  } catch (error) {
    existing.lastTestedAt = new Date();
    existing.lastTestStatus = 'failed';
    await existing.save();
    throw error;
  }
  existing.lastTestedAt = new Date();
  existing.lastTestStatus = 'ok';
  await existing.save();
  return { ok: true, provider: existing.kind, model: existing.modelName, latencyMs: Date.now() - startedAt };
}

export async function createAiProvider(input: AiProviderInput, actor: AuthUser) {
  assertAdmin(actor);
  if (await AgentAiProvider.exists({ name: sameNamePattern(input.name) })) {
    throw ApiError.conflict('这个服务名称已经存在，请换一个');
  }
  const config = await providerCandidate(input, null);
  await probe(config);
  const newKey = input.apiKey?.trim();
  const encrypted = newKey ? encryptAiCredential(newKey) : null;
  try {
    const created = await AgentAiProvider.create({
      name: input.name,
      kind: config.provider,
      modelName: config.model,
      baseUrl: config.baseUrl,
      ...(encrypted ? { credentialCiphertext: encrypted.ciphertext, credentialIv: encrypted.iv, credentialTag: encrypted.tag } : {}),
      lastTestedAt: new Date(),
      lastTestStatus: 'ok',
      createdBy: new Types.ObjectId(actor.id),
      updatedBy: new Types.ObjectId(actor.id),
    });
    return publicProvider(created);
  } catch (error) {
    if (error instanceof Error && /duplicate key/i.test(error.message)) {
      throw ApiError.conflict('这个服务名称已经存在，请换一个');
    }
    throw error;
  }
}

export async function updateAiProvider(id: string, input: AiProviderInput, actor: AuthUser) {
  assertAdmin(actor);
  const existing = await storedProvider(id);
  if (!existing) throw ApiError.notFound('AI 服务不存在或已删除');
  if (await AgentAiProvider.exists({ _id: { $ne: existing._id }, name: sameNamePattern(input.name) })) {
    throw ApiError.conflict('这个服务名称已经存在，请换一个');
  }
  const config = await providerCandidate(input, existing);
  await probe(config);
  const newKey = input.apiKey?.trim();
  const encrypted = newKey ? encryptAiCredential(newKey) : null;
  existing.name = input.name;
  existing.kind = config.provider;
  existing.modelName = config.model;
  existing.baseUrl = config.baseUrl;
  existing.updatedBy = new Types.ObjectId(actor.id);
  existing.lastTestedAt = new Date();
  existing.lastTestStatus = 'ok';
  if (encrypted) {
    existing.credentialCiphertext = encrypted.ciphertext;
    existing.credentialIv = encrypted.iv;
    existing.credentialTag = encrypted.tag;
  }
  await existing.save();
  await syncActiveSettings(existing, actor);
  const settings = await AgentAiSettings.findOne({ key: KEY }).select('activeProviderId').lean();
  return publicProvider(existing, settings?.activeProviderId);
}

export async function activateAiProvider(id: string, actor: AuthUser) {
  assertAdmin(actor);
  const existing = await storedProvider(id);
  if (!existing) throw ApiError.notFound('AI 服务不存在或已删除');
  if (existing.kind === 'openai') {
    if (!existing.credentialCiphertext) throw ApiError.badRequest('这个服务还没有配置 API Key，不能启用');
    storedProviderKey(existing);
  }
  await AgentAiSettings.findOneAndUpdate({ key: KEY }, {
    $set: {
      activeProviderId: existing._id,
      ...providerSettingsFields(existing),
      updatedBy: new Types.ObjectId(actor.id),
    },
    $setOnInsert: { key: KEY },
  }, { upsert: true, new: true, runValidators: true }).exec();
  return { activeProviderId: String(existing._id) };
}

export async function deleteAiProvider(id: string, actor: AuthUser) {
  assertAdmin(actor);
  const existing = await storedProvider(id);
  if (!existing) throw ApiError.notFound('AI 服务不存在或已删除');
  const settings = await AgentAiSettings.findOne({ key: KEY }).select('activeProviderId').lean();
  if (settings?.activeProviderId && String(settings.activeProviderId) === String(existing._id)) {
    throw ApiError.conflict('当前正在使用这个服务，请先切换到其他服务再删除');
  }
  await existing.deleteOne();
  return { ok: true };
}

export async function resolveAgentProvider(): Promise<AgentProvider> {
  const profile = await activeProviderDoc();
  if (profile) {
    const config = resolvedProvider(profile);
    if (config.provider === 'mock') return new MockAgentProvider();
    const baseUrl = await validateAiBaseUrl(config.baseUrl);
    return new OpenAIResponsesProvider({ apiKey: config.apiKey, model: config.model, baseUrl, timeoutMs: env.AI_REQUEST_TIMEOUT_MS });
  }
  const config = resolved(await storedSettings());
  if (config.provider === 'mock') return new MockAgentProvider();
  const baseUrl = await validateAiBaseUrl(config.baseUrl);
  return new OpenAIResponsesProvider({ apiKey: config.apiKey, model: config.model, baseUrl, timeoutMs: env.AI_REQUEST_TIMEOUT_MS });
}
