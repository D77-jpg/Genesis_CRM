// On-demand Chinese translation of a rendered outreach letter.
// Only for review help: the English original is what gets sent.
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

export async function translateLetter(input: { subject?: string; body: string }): Promise<LetterTranslation> {
  const provider = await resolveAgentProvider();
  if (!provider.isAvailable()) throw new ApiError(503, 'AI 未配置，暂时无法翻译', 'INTERNAL_ERROR');
  for (let attempt = 0; attempt < 2; attempt++) {
    const turn = await provider.createTurn({
      instructions: [
        '你是外贸业务翻译。把英文开发信翻译成自然、专业的简体中文。',
        '保留人名、公司名、产品名、邮箱、网址、数字、货币和 {{占位符}} 原样，不要增删事实、承诺或称呼。',
        '正文按原文段落翻译，不要添加解释。',
      ].join('\n'),
      input: [{ role: 'user', content: JSON.stringify({ subject: input.subject ?? '', body: input.body }) }],
      tools: [],
      context: { type: 'global' },
      userPrompt: '只返回 JSON：{"subject":"中文主题","body":"中文正文"}',
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
