import type { AgentCustomerAnalysis } from '@/types';
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Load authoritative, user-scoped analysis and keep model HTML inert in the editor. */
export function outreachComposerDraft(analysis: AgentCustomerAnalysis, customerId: string) {
  if (!analysis.firstOutreach || analysis.customerId !== customerId) throw new Error('草稿与当前客户不匹配');
  return { analysisId: analysis.id, subject: analysis.emailDraft.subject,
    content: analysis.emailDraft.bodyText.trim().split(/\r?\n(?:[ \t]*\r?\n)+/).map(paragraph =>
      `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`).join('') };
}
