/**
 * zod 4 升级后的「英文默认提示」体检：把各校验器喂上明显非法的输入，
 * 打印仍然冒英文的提示（Too big / Invalid input / Required ...）。
 * 用法：node --import tsx scripts/check-validator-messages.ts
 */
import * as customer from '../src/validators/customer.validator';
import * as followup from '../src/validators/followup.validator';
import * as quotation from '../src/validators/quotation.validator';
import * as template from '../src/validators/template.validator';
import * as agent from '../src/validators/agent.validator';
import * as scratchpad from '../src/validators/scratchpad.validator';
import * as letter from '../src/validators/letter.validator';
import * as user from '../src/validators/user.validator';
import * as project from '../src/validators/project.validator';
import * as prospecting from '../src/validators/prospecting.validator';
import * as mailAccount from '../src/validators/mail-account.validator';
import * as auth from '../src/validators/auth.validator';

type Case = { schema: unknown; payload: unknown };

const long = 'x'.repeat(500);
const weird = { $ne: null };

const cases: Record<string, Case[]> = {
  customer: [
    { schema: (customer as any).createCustomerSchema, payload: { name: '', email: 'bad', status: 'nope', priority: 'x', website: long, tags: 'x' } },
    { schema: (customer as any).updateCustomerSchema, payload: { email: 'bad', company: long, status: 'nope' } },
    { schema: (customer as any).listCustomersQuerySchema, payload: { page: '0', limit: '99999', sortOrder: 'sideways', hasEmail: 'maybe', ownerId: 'zzz', createdFrom: 'not-a-date' } },
    { schema: (customer as any).bulkUpdateStatusSchema, payload: { ids: [], status: 'nope' } },
    { schema: (customer as any).bulkDeleteSchema, payload: { ids: ['bad'] } },
  ],
  followup: [
    { schema: (followup as any).createFollowUpSchema, payload: { method: 'x', result: 'y', content: long, followUpAt: 'not-a-date', nextFollowUpAt: 'not-a-date' } },
  ],
  quotation: [
    { schema: (quotation as any).createQuotationSchema, payload: { currency: 'XYZ', status: 'nope', items: [], title: long } },
  ],
  template: [
    { schema: (template as any).createTemplateSchema, payload: { name: '', subject: '', content: '   ', category: 'nope' } },
  ],
  agent: [
    { schema: (agent as any).createAgentSessionSchema, payload: { title: long } },
    { schema: (agent as any).sendAgentMessageSchema, payload: { content: '' } },
    { schema: (agent as any).agentContextSchema, payload: { type: 'nope' } },
  ],
  scratchpad: [
    { schema: (scratchpad as any).updateScratchpadSchema, payload: { content: 123, expectedVersion: -1 } },
  ],
  letter: [
    { schema: (letter as any).sendLetterSchema, payload: { customerId: 'bad', subject: '', content: '' } },
    { schema: (letter as any).createLetterSchema, payload: { customerId: 'bad', channel: 'nope' } },
  ],
  user: [
    { schema: (user as any).createUserSchema, payload: { username: '', password: '123', role: 'nope' } },
  ],
  project: [
    { schema: (project as any).createProjectSchema, payload: { name: '' } },
  ],
  prospecting: [
    { schema: (prospecting as any).prospectingConfigSchema, payload: { minScore: 500 } },
    { schema: (prospecting as any).bulkConvertSchema ?? (prospecting as any).convertProspectsSchema, payload: { ids: ['bad'] } },
  ],
  mailAccount: [
    { schema: (mailAccount as any).upsertMailAccountSchema ?? (mailAccount as any).mailAccountSchema, payload: { email: 'bad', smtpPort: 'zero', fromName: long } },
  ],
  auth: [
    { schema: (auth as any).loginSchema, payload: { username: '', password: '' } },
    { schema: (auth as any).changePasswordSchema, payload: { currentPassword: '', newPassword: '1' } },
  ],
};

const ENGLISH = /^(Too |Invalid |Expected |Unrecognized |Required|Unions|String must|Number must|Array must)/i;

function messagesOf(schema: any, payload: unknown): string[] {
  if (!schema || typeof schema.safeParse !== 'function') return ['（没有这个 schema，跳过）'];
  const result = schema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue: any) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

let english = 0;
let total = 0;
for (const [group, list] of Object.entries(cases)) {
  for (const { schema, payload } of list) {
    const messages = messagesOf(schema, payload);
    total += messages.length;
    const bad = messages.filter((message) => ENGLISH.test(message.replace(/^[^:]+: /, '')));
    if (bad.length) english += bad.length;
    console.log(`[${group}] ${messages.length ? messages.length + ' 条提示' : '全部通过（可能漏测）'}`);
    for (const message of messages) console.log(`   ${ENGLISH.test(message.replace(/^[^:]+: /, '')) ? '✗ 英文' : '✓ 中文'} ${message}`);
  }
}
console.log(`\n合计 ${total} 条提示，其中英文默认提示 ${english} 条`);
