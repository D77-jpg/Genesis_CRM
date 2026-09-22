import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import env from '../../config/env';
import { AgentQuotaBucket } from '../../models';
import type { AuthUser } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { requireProjectId } from '../../utils/access';

export interface AgentUsageValues {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentQuotaLimits {
  dailyRuns: number;
  dailyTokens: number;
  maxOutputTokens: number;
}

export interface AgentQuotaReservation {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  day: string;
  reservedTokens: number;
}

export interface LimitedItems<T> {
  items: T[];
  inputCharacters: number;
  truncated: boolean;
}

export const DEFAULT_AGENT_QUOTA_LIMITS: AgentQuotaLimits = {
  dailyRuns: env.AI_DAILY_RUN_LIMIT,
  dailyTokens: env.AI_DAILY_TOKEN_LIMIT,
  maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
};

export function agentSafetyIdentifier(actor: AuthUser): string {
  return createHash('sha256').update(`${actor.id}:${requireProjectId(actor)}`).digest('hex').slice(0, 64);
}

/** 仅用于诊断标记；真正的边界由系统指令、只读工具注册表和服务端权限共同保证。 */
export function containsPromptInjection(value: unknown): boolean {
  const text = String(value ?? '').toLowerCase();
  return /ignore (all |any )?(previous|prior|system|developer) instructions|reveal (the )?(system prompt|secret|api key)|act as (an? )?(admin|system)|call (an? )?unregistered tool|绕过.{0,12}(规则|权限)|忽略.{0,12}(之前|系统|开发者).{0,12}(指令|要求)|泄露.{0,8}(密钥|提示词)/i.test(text);
}

export function estimateAgentCostUsd(usage: AgentUsageValues, provider: 'mock' | 'openai'): number {
  if (provider === 'mock') return 0;
  const cost = (usage.inputTokens * env.AI_INPUT_USD_PER_1M_TOKENS
    + usage.outputTokens * env.AI_OUTPUT_USD_PER_1M_TOKENS) / 1_000_000;
  return Number(cost.toFixed(8));
}

function quotaError(limits: AgentQuotaLimits): ApiError {
  return new ApiError(429, '已达到今日 Agent 使用额度，请明日再试或联系管理员', 'RATE_LIMITED', [
    { field: 'dailyRuns', message: `每日最多 ${limits.dailyRuns} 次` },
    { field: 'dailyTokens', message: `每日最多预留 ${limits.dailyTokens} tokens` },
  ]);
}

function quotaScope(actor: AuthUser) {
  return {
    projectId: new Types.ObjectId(requireProjectId(actor)),
    userId: new Types.ObjectId(actor.id),
    day: new Date().toISOString().slice(0, 10),
  };
}

/**
 * 原子预留一次运行额度。唯一索引处理首个并发请求，条件更新处理后续并发请求，
 * 避免多个同时到达的请求一起越过日额度。
 */
export async function reserveAgentQuota(
  actor: AuthUser,
  inputCharacters: number,
  limits: AgentQuotaLimits = DEFAULT_AGENT_QUOTA_LIMITS,
): Promise<AgentQuotaReservation> {
  const identifiers = quotaScope(actor);
  const estimatedInputTokens = Math.max(1, Math.ceil(Math.max(0, inputCharacters) / 4));
  const reservedTokens = estimatedInputTokens + limits.maxOutputTokens;
  if (reservedTokens > limits.dailyTokens) throw quotaError(limits);

  const guarded = {
    ...identifiers,
    requestCount: { $lt: limits.dailyRuns },
    $expr: { $lte: [{ $add: ['$totalTokens', '$reservedTokens', reservedTokens] }, limits.dailyTokens] },
  };
  const update = { $inc: { requestCount: 1, reservedTokens } };
  let updated = await AgentQuotaBucket.findOneAndUpdate(guarded, update, { new: true });
  if (!updated) {
    try {
      updated = await AgentQuotaBucket.create({ ...identifiers, requestCount: 1, reservedTokens });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      updated = await AgentQuotaBucket.findOneAndUpdate(guarded, update, { new: true });
    }
  }
  if (!updated) throw quotaError(limits);
  return { ...identifiers, reservedTokens };
}

export async function settleAgentQuota(
  reservation: AgentQuotaReservation | undefined,
  usage?: AgentUsageValues,
): Promise<void> {
  if (!reservation) return;
  const safe = usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  await AgentQuotaBucket.updateOne(
    { projectId: reservation.projectId, userId: reservation.userId, day: reservation.day },
    {
      $inc: {
        reservedTokens: -reservation.reservedTokens,
        inputTokens: Math.max(0, safe.inputTokens),
        outputTokens: Math.max(0, safe.outputTokens),
        totalTokens: Math.max(0, safe.totalTokens),
      },
    },
  );
}

/** 优先保留最新数据；若单条内容超预算，则只截断正文而保留该条记录的身份字段。 */
export function limitRecentItems<T>(
  items: T[],
  getText: (item: T) => string,
  setText: (item: T, text: string) => T,
  budget = env.AI_MAX_INPUT_CHARS,
): LimitedItems<T> {
  const kept: T[] = [];
  let remaining = budget;
  let truncated = false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    const text = getText(item);
    const overhead = Math.max(80, JSON.stringify(setText(item, '')).length);
    const available = Math.max(0, remaining - overhead);
    if (available <= 0) {
      truncated = true;
      continue;
    }
    const nextText = text.length > available ? text.slice(0, available) : text;
    if (nextText.length < text.length) truncated = true;
    kept.push(setText(item, nextText));
    remaining -= overhead + nextText.length;
    if (remaining <= 0) truncated = truncated || index > 0;
  }
  kept.reverse();
  return { items: kept, inputCharacters: Math.max(0, budget - remaining), truncated: truncated || kept.length < items.length };
}

export function canonicalToolCallKey(name: string, args: Record<string, unknown>): string {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]));
    }
    return value;
  };
  return `${name}:${JSON.stringify(canonicalize(args))}`;
}
