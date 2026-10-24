/**
 * 客户查重
 * ------------------------------------------------------------------
 * 三条建客户的路都要先过这里：手工新建、Excel 导入直接建客户、今日开发转客户。
 *
 * 判重口径（从强到弱）：
 *   email   —— 邮箱相同。DB 上本来就有 (projectId, email) 唯一索引，这里提前拦，
 *              顺带告诉用户撞的是哪一位客户。
 *   website —— 网站域名相同。同一个公司换个联系人邮箱再来一遍，是最常见的重复来源。
 *   company —— 公司名去后缀（Ltd / LLC / GmbH…）、去符号、不分大小写后相同。
 *   phone   —— 电话后 9 位相同（避免 +86 / 空格 / 横线写法差异）。
 *
 * hard = 一定是重复，直接拒绝（邮箱、网站）；
 * soft = 可能是重复，先提示、由人决定（公司名、电话）。
 */
import { Types } from 'mongoose';
import { Customer } from '../models/Customer';
import { ApiError } from '../utils/ApiError';

export type DuplicateField = 'email' | 'website' | 'company' | 'phone';

export interface DuplicateCandidate {
  id: string;
  name: string;
  company?: string;
  email?: string;
  website?: string;
  status?: string;
  matched: DuplicateField;
}

export interface DuplicateCheckInput {
  email?: string | null;
  website?: string | null;
  company?: string | null;
  name?: string | null;
  phone?: string | null;
  /** 编辑场景排除自己 */
  excludeId?: string;
}

export interface DuplicateReport {
  hard: DuplicateCandidate[];
  soft: DuplicateCandidate[];
}

/** 公司名归一：去公司后缀、去符号、压空格，用来判断「是不是同一家公司」 */
const LEGAL_SUFFIX =
  /\b(?:ltd|limited|llc|l l c|inc|incorporated|co|corp|corporation|company|gmbh|ag|bv|nv|ab|oy|oyj|as|aps|sarl|sas|srl|spa|pty|pte|kk|plc|group|holdings|international|intl)\b/g;

export function companyKey(value?: string | null): string {
  const raw = (value ?? '')
    .toLowerCase()
    // 全角转半角常见符号直接抹掉，避免「ＬＴＤ」这种写法漏判
    .replace(/[®™©]/g, ' ')
    .replace(/\s+/g, ' ');
  return raw
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/[^0-9a-z\u4e00-\u9fa5]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 取网站域名（去协议、去 www、去路径），拿不到就空串 */
export function websiteHost(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 电话归一：只留数字，取后 9 位（够区分，又能容忍国家码写法差异） */
export function phoneKey(value?: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : '';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type LeanCustomer = {
  _id: unknown;
  name?: string;
  company?: string;
  email?: string;
  website?: string;
  phone?: string;
  status?: string;
};

/** 纯匹配逻辑（导出供单测）：把候选客户和输入比对，产出 hard / soft */
export function matchDuplicates(candidates: LeanCustomer[], input: DuplicateCheckInput): DuplicateReport {
  const email = (input.email ?? '').trim().toLowerCase();
  const host = websiteHost(input.website);
  const keys = [companyKey(input.company), companyKey(input.name)].filter((key) => key.length >= 2);
  const phone = phoneKey(input.phone);

  const hard: DuplicateCandidate[] = [];
  const soft: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const id = String(candidate._id);
    if (input.excludeId && id === input.excludeId) continue;
    const base = {
      id,
      name: String(candidate.name ?? ''),
      company: candidate.company || undefined,
      email: candidate.email || undefined,
      website: candidate.website || undefined,
      status: candidate.status || undefined,
    };

    const candidateEmail = String(candidate.email ?? '').trim().toLowerCase();
    if (email && candidateEmail && candidateEmail === email) {
      if (!seen.has(id)) {
        hard.push({ ...base, matched: 'email' });
        seen.add(id);
      }
      continue;
    }

    const candidateHost = websiteHost(candidate.website);
    if (host && candidateHost && candidateHost === host) {
      if (!seen.has(id)) {
        hard.push({ ...base, matched: 'website' });
        seen.add(id);
      }
      continue;
    }

    const candidateKeys = [companyKey(candidate.company), companyKey(candidate.name)].filter((key) => key.length >= 2);
    if (keys.length > 0 && candidateKeys.some((key) => keys.includes(key))) {
      if (!seen.has(id)) {
        soft.push({ ...base, matched: 'company' });
        seen.add(id);
      }
      continue;
    }

    if (phone && phoneKey(candidate.phone) === phone) {
      if (!seen.has(id)) {
        soft.push({ ...base, matched: 'phone' });
        seen.add(id);
      }
    }
  }

  return { hard, soft };
}

/** 把命中项翻译成一句人话 */
export function describeDuplicate(candidate: DuplicateCandidate): string {
  const target = candidate.name ? `「${candidate.name}」` : '已有一条记录';
  switch (candidate.matched) {
    case 'email':
      return `邮箱与客户库里${target}相同`;
    case 'website':
      return `网站与客户库里${target}相同`;
    case 'company':
      return `公司名与客户库里${target}相同`;
    case 'phone':
      return `电话与客户库里${target}相同`;
    default:
      return `与客户库里${target}重复`;
  }
}

/**
 * 查客户库里有没有重复。
 * `strictDomain` = true 时，同网站也算硬冲突（转客户 / 导入用，避免同一个公司进来两次）。
 */
export async function findCustomerDuplicates(
  projectId: Types.ObjectId | string,
  input: DuplicateCheckInput,
  options: { strictDomain?: boolean } = {},
): Promise<DuplicateReport> {
  const email = (input.email ?? '').trim().toLowerCase();
  const host = websiteHost(input.website);
  const keys = [companyKey(input.company), companyKey(input.name)].filter((key) => key.length >= 2);
  const phone = phoneKey(input.phone);

  const or: Record<string, unknown>[] = [];
  if (email) or.push({ email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
  if (host) or.push({ website: { $regex: `(?:^|//)(?:www\\.)?${escapeRegex(host)}(?:[/:]|$)`, $options: 'i' } });
  keys.forEach((key) => {
    // 公司名里最长的词做粗筛，再用 companyKey 精确比对
    const token = key.split(' ').sort((a, b) => b.length - a.length)[0];
    if (!token || token.length < 3) return;
    or.push({ company: { $regex: escapeRegex(token), $options: 'i' } });
    or.push({ name: { $regex: escapeRegex(token), $options: 'i' } });
  });
  if (phone) or.push({ phone: { $regex: escapeRegex(phone.slice(-7)) } });

  if (or.length === 0) return { hard: [], soft: [] };

  const candidates = (await Customer.find({ projectId: new Types.ObjectId(String(projectId)), $or: or })
    .select('name company email website phone status')
    .limit(50)
    .lean()) as unknown as LeanCustomer[];

  const report = matchDuplicates(candidates, input);
  if (options.strictDomain === false) {
    // 非严格模式：同网站只提示、不拦（可能是同一家公司的第二个联系人）
    const stillHard: DuplicateCandidate[] = [];
    for (const candidate of report.hard) {
      if (candidate.matched === 'website') report.soft.push(candidate);
      else stillHard.push(candidate);
    }
    report.hard = stillHard;
  }
  return report;
}

/** 建客户前调用：有硬冲突就抛 409，提示撞的是哪一位客户 */
export async function assertNoCustomerDuplicate(
  projectId: Types.ObjectId | string,
  input: DuplicateCheckInput,
  options: { strictDomain?: boolean } = {},
): Promise<DuplicateReport> {
  const report = await findCustomerDuplicates(projectId, input, options);
  if (report.hard.length > 0) {
    const first = report.hard[0]!;
    throw new ApiError(409, `${describeDuplicate(first)}，请勿重复添加`, 'CONFLICT', [
      { field: 'duplicateCustomerId', message: first.id },
      { field: 'duplicateCustomerName', message: first.name },
    ]);
  }
  return report;
}

/* ------------------------------------------------------------------
 * 批量查重（导入用）
 * 一次导入几百上千行时不能逐行查库，这里把「邮箱 / 网站 / 公司名 / 电话」
 * 四类索引一次性建好，再在内存里逐行比对。
 * ------------------------------------------------------------------ */

export interface DuplicateIndex {
  emails: Map<string, DuplicateCandidate>;
  hosts: Map<string, DuplicateCandidate>;
  companyKeys: Map<string, DuplicateCandidate>;
  phones: Map<string, DuplicateCandidate>;
}

function toCandidate(doc: LeanCustomer, matched: DuplicateField): DuplicateCandidate {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    company: doc.company || undefined,
    email: doc.email || undefined,
    website: doc.website || undefined,
    status: doc.status || undefined,
    matched,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 一次把项目里可能撞上的客户捞出来，建四个索引 */
export async function buildDuplicateIndex(
  projectId: Types.ObjectId | string,
  rows: DuplicateCheckInput[],
  scopeFilter: Record<string, unknown> = {},
): Promise<DuplicateIndex> {
  const emails = [...new Set(rows.map((row) => (row.email ?? '').trim().toLowerCase()).filter(Boolean))];
  const hosts = [...new Set(rows.map((row) => websiteHost(row.website)).filter(Boolean))];
  const keys = [
    ...new Set(rows.flatMap((row) => [companyKey(row.company), companyKey(row.name)]).filter((key) => key.length >= 2)),
  ];
  const phones = [...new Set(rows.map((row) => phoneKey(row.phone)).filter(Boolean))];
  const tokens = [
    ...new Set(
      keys
        .map((key) => key.split(' ').sort((a, b) => b.length - a.length)[0])
        .filter((token): token is string => Boolean(token) && token.length >= 3),
    ),
  ];

  const base = { projectId: new Types.ObjectId(String(projectId)), ...scopeFilter };
  const queries: Record<string, unknown>[] = [];
  chunk(emails, 300).forEach((part) => queries.push({ ...base, email: { $in: part } }));
  chunk(hosts, 40).forEach((part) =>
    queries.push({
      ...base,
      $or: part.map((host) => ({ website: { $regex: `(?:^|//)(?:www\\.)?${escapeRegex(host)}(?:[/:]|$)`, $options: 'i' } })),
    }),
  );
  chunk(tokens, 40).forEach((part) =>
    queries.push({
      ...base,
      $or: part.flatMap((token) => [
        { company: { $regex: escapeRegex(token), $options: 'i' } },
        { name: { $regex: escapeRegex(token), $options: 'i' } },
      ]),
    }),
  );
  chunk(phones, 40).forEach((part) =>
    queries.push({ ...base, $or: part.map((phone) => ({ phone: { $regex: escapeRegex(phone.slice(-7)) } })) }),
  );

  const index: DuplicateIndex = { emails: new Map(), hosts: new Map(), companyKeys: new Map(), phones: new Map() };
  if (queries.length === 0) return index;

  const docs = (await Promise.all(
    queries.map((query) => Customer.find(query).select('name company email website phone status').limit(2000).lean()),
  )).flat() as unknown as LeanCustomer[];

  const seen = new Set<string>();
  for (const doc of docs) {
    const id = String(doc._id);
    if (seen.has(id)) continue;
    seen.add(id);
    const email = String(doc.email ?? '').trim().toLowerCase();
    if (email) index.emails.set(email, toCandidate(doc, 'email'));
    const host = websiteHost(doc.website);
    if (host) index.hosts.set(host, toCandidate(doc, 'website'));
    [companyKey(doc.company), companyKey(doc.name)].forEach((key) => {
      if (key.length >= 2 && !index.companyKeys.has(key)) index.companyKeys.set(key, toCandidate(doc, 'company'));
    });
    const phone = phoneKey(doc.phone);
    if (phone) index.phones.set(phone, toCandidate(doc, 'phone'));
  }
  return index;
}

/** 用索引判断一行数据撞上了谁：先邮箱、再网站、最后公司名/电话 */
export function lookupDuplicate(
  index: DuplicateIndex,
  input: DuplicateCheckInput,
  options: { strictDomain?: boolean } = {},
): { hard?: DuplicateCandidate; soft?: DuplicateCandidate } {
  const email = (input.email ?? '').trim().toLowerCase();
  const emailHit = email ? index.emails.get(email) : undefined;
  if (emailHit) return { hard: emailHit };

  const host = websiteHost(input.website);
  const hostHit = host ? index.hosts.get(host) : undefined;
  if (hostHit) return options.strictDomain === false ? { soft: hostHit } : { hard: hostHit };

  for (const key of [companyKey(input.company), companyKey(input.name)]) {
    if (key.length >= 2) {
      const companyHit = index.companyKeys.get(key);
      if (companyHit) return { soft: companyHit };
    }
  }

  const phone = phoneKey(input.phone);
  const phoneHit = phone ? index.phones.get(phone) : undefined;
  if (phoneHit) return { soft: phoneHit };

  return {};
}