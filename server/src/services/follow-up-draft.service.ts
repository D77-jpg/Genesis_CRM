import type { AuthUser } from '../types/express';
import { ApiError } from '../utils/ApiError';
import { createLogger } from '../config/logger';
import { DevelopmentLetter, Project } from '../models';
import { getCustomerByIdOrThrow } from './customer.service';
import { resolveAgentProvider } from './agent/ai-settings.service';
import { OUTREACH_MAX_STEPS } from '../constants';

const EXCERPT_LENGTH = 700;
const log = createLogger('follow-up-draft');

export interface FollowUpDraft {
  subject: string;
  /** 可直接放进编辑器的 HTML */
  content: string;
  text: string;
  step: number;
  previousSubject: string;
  previousSentAt: string;
  source: 'ai' | 'template';
  note: string;
}

const htmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(paragraphs: string[]): string {
  return paragraphs.filter(Boolean).map((line) => `<p>${htmlEscape(line).replace(/&lt;br&gt;/g, '<br>')}</p>`).join('\n');
}

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 第一段（Dear X,）之后的第一句，用来判断上一封讲了什么 */
function firstSentence(text: string): string {
  const cleaned = text.replace(/^(dear[^,\n]*,?\s*)/i, '').trim();
  const [sentence] = cleaned.split(/(?<=[.!?])\s+/);
  return (sentence || cleaned).slice(0, 220).trim();
}

/** 去掉 AI 自己加的落款/签名（弹窗里会统一追加标准签名） */
function stripSignature(text: string): string {
  const lines = text.split('\n');
  const marker = /^(best|kind|warm|many)\s+(regards|wishes)|^sincerely|^thanks( again)?[,!]?$|^thank you[,!]?$/i;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (marker.test(lines[i].trim())) return lines.slice(0, i).join('\n').trim();
  }
  return text.trim();
}

function firstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'there';
  if (/^[A-Z]{2,}$/.test(trimmed)) return trimmed;
  return trimmed.split(/\s+/)[0];
}

/**
 * 安全护栏：跟进信不得引入上一封没有的硬事实。
 * 命中价格/数量/交期/认证类表述就直接回退成模板，避免 AI 自己编承诺。
 */
function introducesNewClaims(text: string): string | null {
  const patterns: [RegExp, string][] = [
    [/\b(usd|eur|rmb|cny|jpy)\b|\$|€|¥/i, '价格'],
    [/\b\d+(\.\d+)?\s*%/, '百分比'],
    [/\bmoq\b|\bminimum order\b/i, 'MOQ'],
    [/\b\d+([-–]\d+)?\s*(days?|weeks?|months?)\b/i, '交期'],
    [/\b(fsc|grs|iso|sedex|bsci|fda|lfgb)\b/i, '认证'],
    [/\b(discount|free of charge|for free|guarantee|warrant(y|ies)|refund)\b/i, '承诺'],
    [/\b\d{2,}\s*(pcs|units?|sets?|boxes|bags)\b/i, '数量'],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function templateDraft(input: {
  step: number; customerName: string; previousSubject: string; previousSentAt: string;
  senderName: string; companyName: string; previousText: string;
}): { subject: string; paragraphs: string[] } {
  const date = new Date(input.previousSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const subject = /^re:/i.test(input.previousSubject) ? input.previousSubject : `Re: ${input.previousSubject}`;
  const hook = firstSentence(input.previousText);
  const paragraphs = [
    `Dear ${input.customerName},`,
    `Following up on my email of ${date} about "${input.previousSubject}" — I know inboxes get busy, so this is a short note rather than a long one.`,
    hook && hook.length > 40
      ? `My point was simple: ${hook.replace(/\s+/g, ' ')}`
      : '',
    input.step >= 3
      ? 'If packaging is not a priority this quarter, just reply "not now" and I will stop following up — no hard feelings.'
      : 'Would it help if I sent a small sample set, or a quick price range for the sizes you normally use?',
  ].filter(Boolean);
  return { subject, paragraphs };
}

/** 一键生成第 2 / 3 封跟进草稿（基于上一封的实际主题与正文） */
export async function draftFollowUpLetter(customerId: string, actor: AuthUser): Promise<FollowUpDraft> {
  const customer = await getCustomerByIdOrThrow(customerId, actor);
  const previous = await DevelopmentLetter.findOne({
    projectId: customer.projectId,
    customerId: customer._id,
    status: { $in: ['sent', 'opened'] },
  }).sort({ sentAt: -1 }).lean();

  if (!previous) throw ApiError.badRequest('这个客户还没有发出过开发信，先发第 1 封再跟');

  const previousSentAt = (previous.sentAt ?? previous.createdAt ?? new Date()) as Date;
  const currentStep = Number(customer.outreachStep ?? previous.outreachStep ?? 1) || 1;
  const step = Math.min(currentStep + 1, OUTREACH_MAX_STEPS);
  const previousSubject = String(previous.subject || '').trim() || '(no subject)';
  const previousText = plainText(String(previous.content || ''));
  const excerpt = previousText.slice(0, EXCERPT_LENGTH);

  const project = await Project.findById(customer.projectId).select('companyName').lean();
  const companyName = String(project?.companyName || 'Genesis Bags');
  const senderName = String(actor.displayName || actor.username || 'Sales');
  const seller = { companyName, senderName };

  const fallback = () => {
    const { subject, paragraphs } = templateDraft({
      step, customerName: firstName(String(customer.name || '')), previousSubject, previousSentAt: previousSentAt.toISOString(),
      senderName, companyName, previousText,
    });
    const text = paragraphs.join('\n\n');
    return {
      subject, content: toHtml(paragraphs), text, step, previousSubject,
      previousSentAt: previousSentAt.toISOString(), source: 'template' as const,
      note: '按上一封的内容生成了跟进模板（未启用 AI，可直接改）',
    };
  };

  let provider;
  try {
    provider = await resolveAgentProvider();
  } catch (error) {
    log.warn('provider unavailable, fallback to template', { error: (error as Error).message });
    return fallback();
  }
  if (!provider.isAvailable()) return fallback();

  try {
    const result = await provider.draftFollowUp({
      safetyIdentifier: `follow-up:${actor.id}`,
      input: {
        step,
        customer: {
          name: String(customer.name || ''),
          salutation: firstName(String(customer.name || '')),
          company: customer.company || undefined,
          email: customer.email || undefined,
        },
        previous: { subject: previousSubject, sentAt: previousSentAt.toISOString(), excerpt },
        seller,
        allowedFacts: [],
      },
    });
    const claim = introducesNewClaims(result.bodyText);
    if (claim) {
      log.warn('ai draft rejected by claim guard', { customerId, claim });
      return { ...fallback(), note: `AI 草稿里出现了未经确认的${claim}，已换成模板版，请人工补充` };
    }
    const paragraphs = stripSignature(result.bodyText).split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
    const text = paragraphs.join('\n\n');
    return {
      subject: /^re:/i.test(result.subject) ? result.subject : `Re: ${result.subject || previousSubject}`,
      content: toHtml(paragraphs),
      text,
      step,
      previousSubject,
      previousSentAt: previousSentAt.toISOString(),
      source: 'ai',
      note: `已按上一封（${previousSubject}）生成第 ${step} 封跟进草稿，发前请过一遍`,
    };
  } catch (error) {
    log.warn('ai draft failed, fallback to template', { error: (error as Error).message });
    return fallback();
  }
}
