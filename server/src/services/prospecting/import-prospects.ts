/**
 * Excel 导入线索（今日开发线索池）
 * ------------------------------------------------------------------
 * 业务员手里的 Excel 不直接进客户库，而是先落成线索，在「今日开发」里
 * 逐条审核：补齐联系方式、看备注、确认是目标客户，再点「转为客户」。
 *
 * 与搜索抓取的线索（source=serper）区别：
 *  - 没有抓取证据链（没有 snippet / excerpt / contactSources）
 *  - 但带着业务员自己填的等级、优先级、备注、来源
 *  - 判重口径更严：邮箱或网站已经在客户库里的直接跳过，不重复建线索
 */
import { Types } from 'mongoose';
import { createLogger } from '../../config/logger';
import { Prospect, type ProspectStatus } from '../../models/Prospect';
import { ProspectingConfig } from '../../models/ProspectingConfig';
import { requireProjectId } from '../../utils/access';
import { resolveCountry } from '../../utils/country';
import { importRowSchema, type ImportRow } from '../../validators/customer.validator';
import type { AuthUser } from '../../types/express';
import { collectWarnings, type ImportFailure, type ImportResult, type ImportWarning } from '../customer.service';
import { buildDuplicateIndex, describeDuplicate, lookupDuplicate } from '../customer-duplicate';
import { dayIn } from './prospecting.service';

const logger = createLogger('prospecting');

/** 免费邮箱域名：不能拿来当公司网站 */
const FREEMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'qq.com',
  '163.com',
  '126.com',
  'proton.me',
  'protonmail.com',
  'gmx.de',
  'web.de',
]);

export interface ImportProspectsInput {
  rows: unknown[];
  dryRun?: boolean;
}

/** 从一个可能不带协议的地址里取 host：「monarcjewellery.com/pages/x」→「monarcjewellery.com」 */
function hostOf(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 公司名兜底成域名样式的唯一键：Melinda Maria → melinda-maria */
function slugOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** 线索唯一键：优先官网域名，其次邮箱域名，最后公司名 */
/** 导出供单测：线索唯一键 */
export function domainKeyOf(row: ImportRow): string {
  const website = hostOf(row.website);
  if (website) return website;
  const emailDomain = (row.email ?? '').split('@')[1]?.toLowerCase().trim();
  if (emailDomain && !FREEMAIL.has(emailDomain)) return emailDomain;
  const slug = slugOf(row.company || row.name || '');
  if (slug) return slug;
  return emailDomain ?? '';
}

/** 没有官网时用邮箱域名当网站（免费邮箱不算），客户库判重会用到 */
function emailDomainOf(row: ImportRow): string {
  const domain = (row.email ?? '').split('@')[1]?.toLowerCase().trim() ?? '';
  return domain && !FREEMAIL.has(domain) ? domain : '';
}

/** 等级 + 优先级折算成 0-100 分，让导入线索也能按分数排序 */
/** 导出供单测：等级/优先级折算分数 */
export function scoreOf(row: ImportRow): number {
  const grade = (row.grade ?? '').trim().toUpperCase();
  const base = grade === 'A' ? 85 : grade === 'B' ? 70 : grade === 'C' ? 50 : 60;
  const bump = row.priority === 'high' ? 10 : row.priority === 'low' ? -10 : 0;
  return Math.max(0, Math.min(100, base + bump));
}


export async function importProspects(actor: AuthUser, input: ImportProspectsInput): Promise<ImportResult> {
  const projectId = new Types.ObjectId(requireProjectId(actor));
  const dryRun = input.dryRun === true;

  const failures: ImportFailure[] = [];
  const warnings: ImportWarning[] = [];

  /* ---------- 1. 行级校验（与客户导入同一套规则） ---------- */
  const valid: { row: ImportRow; index: number }[] = [];
  input.rows.forEach((raw, index) => {
    const parsed = importRowSchema.safeParse(raw);
    if (parsed.success) {
      valid.push({ row: parsed.data, index });
      return;
    }
    const reasons = [
      ...new Set(
        parsed.error.issues.map((issue) => {
          const path = issue.path.filter((segment) => segment !== '__row');
          return `${path.length > 0 ? path.join('.') : '该行'}：${issue.message}`;
        }),
      ),
    ];
    const record = (raw ?? {}) as Record<string, unknown>;
    failures.push({
      row: typeof record.__row === 'number' ? (record.__row as number) : index + 2,
      name: typeof record.name === 'string' ? record.name : undefined,
      email: typeof record.email === 'string' ? record.email : undefined,
      reason: `数据校验未通过（${reasons.join('；')}）`,
    });
  });

  /* ---------- 2. 数据体检（能进来但值得看一眼） ---------- */
  valid.forEach(({ row, index }) => warnings.push(...collectWarnings(row, index)));

  /* ---------- 3. 判重：客户库 / 线索池 / 批内 ---------- */
  const emails = valid.map(({ row }) => row.email?.toLowerCase().trim()).filter((v): v is string => Boolean(v));
  const domains = [...new Set(valid.map(({ row }) => domainKeyOf(row)).filter(Boolean))];

  // 客户库查重走统一索引（邮箱 / 网站 / 公司名 / 电话），和手工新建、转客户同一套口径
  const duplicateIndex = await buildDuplicateIndex(
    projectId,
    valid.map(({ row }) => ({
      email: row.email,
      website: row.website || emailDomainOf(row),
      company: row.company,
      name: row.name,
      phone: row.phone,
    })),
  );

  const [prospectHits] = await Promise.all([
    Prospect.find({
      projectId,
      $or: [
        { domain: { $in: domains } },
        ...(emails.length > 0 ? [{ emails: { $in: emails } }] : []),
      ],
    })
      .select('domain emails status contactName')
      .lean(),
  ]);

  const prospectDomains = new Set(prospectHits.map((item) => String(item.domain ?? '').toLowerCase()));
  const prospectEmails = new Set(
    prospectHits.flatMap((item) => (item.emails ?? []).map((email) => String(email).toLowerCase())),
  );

  const config = await ProspectingConfig.findOne({ projectId }).select('timezone').lean();
  const day = dayIn((config?.timezone as string | undefined) ?? 'Asia/Shanghai');

  const seen = new Map<string, number>();
  const toInsert: Record<string, unknown>[] = [];

  valid.forEach(({ row, index }) => {
    const rowNumber = typeof row.__row === 'number' ? row.__row : index + 2;
    const label = { row: rowNumber, name: row.name, email: row.email };
    const domain = domainKeyOf(row);
    const email = row.email?.toLowerCase().trim() ?? '';

    if (!domain) {
      failures.push({ ...label, reason: '既没有官网也没有邮箱/公司名，无法生成线索' });
      return;
    }

    const firstSeen = seen.get(domain);
    if (firstSeen !== undefined) {
      failures.push({ ...label, reason: `与第 ${firstSeen} 行数据重复（同一网站），已跳过` });
      return;
    }
    seen.set(domain, rowNumber);

    // 客户库里已有这条（邮箱或网站撞上）→ 不建线索；只是同公司名 → 提醒，仍可入库
    const againstCustomers = lookupDuplicate(
      duplicateIndex,
      { email, website: row.website || emailDomainOf(row), company: row.company, name: row.name, phone: row.phone },
      { strictDomain: true },
    );
    if (againstCustomers.hard) {
      failures.push({
        ...label,
        reason: `已经是客户库里的客户（${describeDuplicate(againstCustomers.hard)}），跳过`,
      });
      return;
    }
    if (againstCustomers.soft) {
      warnings.push({
        ...label,
        level: 'warn',
        reason: `${describeDuplicate(againstCustomers.soft)}，可能是同一家，转客户前先核对`,
      });
    }

    if (prospectDomains.has(domain) || (email && prospectEmails.has(email))) {
      failures.push({ ...label, reason: '线索池里已有这条线索，跳过' });
      return;
    }

    const country = resolveCountry(row.country);
    const website = hostOf(row.website) ? (/^https?:\/\//i.test(row.website!.trim()) ? row.website!.trim() : `https://${row.website!.trim()}`) : domain.includes('.') ? `https://${domain}` : '';
    const notes = [row.notes, row.requirementNotes].map((value) => (value ?? '').trim()).filter(Boolean).join('\n');
    // 「Excel 导入」在卡片头部已有徽标，这里只放等级/优先级，避免重复
    const reasons = [
      row.grade ? `等级 ${row.grade.trim().toUpperCase()}` : '',
      row.priority === 'high' ? '优先级 高' : row.priority === 'low' ? '优先级 低' : '',
    ].filter(Boolean);

    toInsert.push({
      projectId,
      day,
      // 业务员自己导入的 Excel 直接进个人库；管理员导入的留在公共池
      ...(actor.role !== 'admin' ? { ownerId: new Types.ObjectId(actor.id) } : {}),
      domain,
      website,
      sourceUrl: website,
      source: 'excel',
      name: row.name,
      company: row.company,
      country: country.value || undefined,
      industry: row.industry,
      phone: row.phone,
      address: row.address,
      whatsapp: row.whatsapp,
      linkedin: row.linkedin,
      instagram: row.instagram,
      facebook: row.facebook,
      emails: email ? [email] : [],
      contactName: row.name,
      contactTitle: row.title,
      snippet: row.industry?.trim() || undefined,
      excerpt: notes ? notes.slice(0, 2000) : undefined,
      grade: row.grade?.trim().toUpperCase(),
      priority: row.priority,
      notes: notes ? notes.slice(0, 5000) : undefined,
      leadSource: row.leadSource,
      score: scoreOf(row),
      scoreReasons: reasons,
      status: (email ? 'ready' : 'needs_contact') satisfies ProspectStatus,
      contactSources: [],
    });
  });

  if (dryRun) {
    return {
      total: input.rows.length,
      created: toInsert.length,
      updated: 0,
      skipped: failures.length,
      failures: failures.slice(0, 100),
      warnings: warnings.slice(0, 300),
      dryRun: true,
    };
  }

  /* ---------- 4. 落库 ---------- */
  let created = 0;
  const CHUNK = 200;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    try {
      const docs = await Prospect.insertMany(chunk, { ordered: false });
      created += Array.isArray(docs) ? docs.length : 0;
    } catch (error) {
      const writeErrors = (error as { writeErrors?: { index: number; errmsg?: string }[] }).writeErrors;
      if (writeErrors?.length) {
        writeErrors.forEach((writeError) => {
          const failed = chunk[writeError.index] as { name?: string; emails?: string[] } | undefined;
          failures.push({
            name: failed?.name,
            email: failed?.emails?.[0],
            reason: writeError.errmsg?.includes('duplicate key') ? '线索池里已有同一网站的线索，跳过' : (writeError.errmsg ?? '写入失败'),
          });
        });
        created += chunk.length - writeErrors.length;
      } else {
        const message = error instanceof Error ? error.message : String(error);
        chunk.forEach((row) => {
          const failed = row as { name?: string; emails?: string[] };
          failures.push({ name: failed.name, email: failed.emails?.[0], reason: message });
        });
        logger.error('Excel 导入线索中断', message);
        break;
      }
    }
  }

  logger.info(`Excel 导入线索：提交 ${input.rows.length} 行，新增 ${created}，跳过 ${failures.length}`);

  return {
    total: input.rows.length,
    created,
    updated: 0,
    skipped: failures.length,
    failures: failures.slice(0, 100),
    warnings: warnings.slice(0, 300),
    dryRun: false,
  };
}
