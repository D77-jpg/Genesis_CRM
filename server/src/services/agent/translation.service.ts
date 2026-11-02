// On-demand Chinese translation of a rendered outreach letter.
// Only for review help: the English original is what gets sent.
import { createHash } from 'node:crypto';
import env from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { resolveAgentProvider } from './ai-settings.service';

export interface LetterTranslation {
  subject?: string;
  body: string;
}

const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['subject', 'body'],
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
};

const INSTRUCTIONS = [
  '你是外贸业务翻译。把英文开发信翻译成自然、专业的简体中文。',
  '保留人名、公司名、产品名、邮箱、网址、数字、货币和 {{占位符}} 原样，不要增删事实、承诺或称呼。',
  '正文按原文段落翻译，不要添加解释。',
].join('\n');

const USER_PROMPT = '只返回 JSON：{"subject":"中文主题","body":"中文正文"}';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

type CacheEntry = { value: LetterTranslation; expiresAt: number };
const cache = new Map<string, CacheEntry>();

interface IndexTranslateResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string };
}

function cacheKey(input: { subject?: string; body: string }): string {
  return createHash('sha256')
    .update(JSON.stringify({
      provider: env.TRANSLATE_PROVIDER,
      baseUrl: env.TRANSLATE_BASE_URL,
      model: env.TRANSLATE_MODEL,
      subject: input.subject ?? '',
      body: input.body,
    }))
    .digest('hex');
}

function cached(key: string): LetterTranslation | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function remember(key: string, value: LetterTranslation): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function parseTranslation(raw: string, hasSubject: boolean): LetterTranslation {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('翻译结果不是 JSON');
  const parsed = JSON.parse(text.slice(start, end + 1)) as { subject?: unknown; body?: unknown };
  const body = String(parsed.body ?? '').trim();
  if (!body) throw new Error('翻译结果正文为空');
  const subject = hasSubject ? String(parsed.subject ?? '').trim() : '';
  if (hasSubject && !subject) throw new Error('翻译结果主题为空');
  return { subject: hasSubject ? subject : undefined, body };
}

/** Index-Translate 使用 OpenAI-compatible chat/completions，不占用主 Agent 模型。 */
async function translateWithIndex(input: { subject?: string; body: string }): Promise<LetterTranslation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.TRANSLATE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (env.TRANSLATE_API_KEY) headers.Authorization = `Bearer ${env.TRANSLATE_API_KEY}`;
    const response = await fetch(`${env.TRANSLATE_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: env.TRANSLATE_MODEL,
        temperature: 0.1,
        max_tokens: 1600,
        messages: [
          { role: 'system', content: `${INSTRUCTIONS}\n${USER_PROMPT}` },
          {
            role: 'user',
            content: JSON.stringify({ subject: input.subject ?? '', body: input.body }),
          },
        ],
      }),
      signal: controller.signal,
    });
    const data = await response.json() as IndexTranslateResponse;
    if (!response.ok) {
      throw new Error(data.error?.message || `翻译服务返回 ${response.status}`);
    }
    const choice = data.choices?.[0];
    if (!choice?.message?.content) throw new Error('翻译服务没有返回内容');
    if (choice.finish_reason === 'length') throw new Error('翻译结果被截断');
    return parseTranslation(choice.message.content, Boolean(input.subject));
  } finally {
    clearTimeout(timer);
  }
}

/** 翻译服务不可用时，回退到现有 Agent Provider，保证功能不会中断。 */
async function translateWithAgent(input: { subject?: string; body: string }): Promise<LetterTranslation> {
  const provider = await resolveAgentProvider();
  if (!provider.isAvailable()) throw new ApiError(503, 'AI 未配置，暂时无法翻译', 'INTERNAL_ERROR');
  for (let attempt = 0; attempt < 2; attempt++) {
    const turn = await provider.createTurn({
      instructions: INSTRUCTIONS,
      input: [{ role: 'user', content: JSON.stringify({ subject: input.subject ?? '', body: input.body }) }],
      tools: [],
      context: { type: 'global' },
      userPrompt: USER_PROMPT,
      safetyIdentifier: 'letter-translation',
      outputFormat: { type: 'json_schema', name: 'letter_translation', strict: true, schema: OUTPUT_SCHEMA },
    });
    try {
      const parsed = JSON.parse(turn.text) as { subject?: string; body?: string };
      const body = String(parsed.body ?? '').trim();
      if (body) return { subject: input.subject ? String(parsed.subject ?? '').trim() : undefined, body };
    } catch { /* retry once */ }
  }
  throw new ApiError(502, '翻译结果无法解析，请重试', 'INTERNAL_ERROR');
}

export async function translateLetter(input: { subject?: string; body: string }): Promise<LetterTranslation> {
  const key = cacheKey(input);
  const hit = cached(key);
  if (hit) return hit;

  let result: LetterTranslation;
  if (env.TRANSLATE_PROVIDER === 'index') {
    try {
      result = await translateWithIndex(input);
    } catch {
      result = await translateWithAgent(input);
    }
  } else {
    result = await translateWithAgent(input);
  }
  remember(key, result);
  return result;
}
