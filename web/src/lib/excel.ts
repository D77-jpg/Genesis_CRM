/**
 * Excel 解析与列映射（浏览器端）
 * ------------------------------------------------------------------
 * 设计取舍：
 *  1. 解析放在前端完成，后端只接收「映射好的 JSON」——避免文件上传、
 *     临时磁盘与 multipart 依赖，也让用户在导入前就能看到预览与纠错。
 *  2. 表头自动识别基于 IMPORT_FIELDS 的别名表（中英文混合），
 *     识别不到时用户可在映射界面手动指定。
 *  3. 行级校验尽量与后端 zod 规则对齐，减少「前端过了后端拒」的情况。
 */
import { format, isValid } from 'date-fns';
import * as XLSX from 'xlsx';
import { CUSTOMER_STATUS_VALUES, EMAIL_PATTERN, IMPORT_FIELDS, PRIORITY_TEXT_MAP, STATUS_TEXT_MAP } from '@/constants';
import type { CustomerPriority, CustomerStatus, ImportField } from '@/types';

/* ---------------------------- 常量 ---------------------------- */

/** 前端选择 Excel 文件的大小上限（客户端预校验）；文件本身不上传，仅解析后的 JSON 提交后端（body 上限 25mb） */
export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;
/** 后端单次导入上限：MAX_BULK_SIZE(1000) * 5 */
export const MAX_IMPORT_ROWS = 5000;
/** 映射界面预览的行数 */
export const MAPPING_PREVIEW_ROWS = 8;

const SUPPORTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv', '.ods'];

/* ---------------------------- 类型 ---------------------------- */

export interface ParsedRow {
  /** Excel 中的真实行号（1-based，与用户在表格里看到的一致） */
  row: number;
  /** key 为表头文本，value 已统一转成字符串 */
  values: Record<string, string>;
}

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: ParsedRow[];
  /** 表头所在行号 */
  headerRow: number;
  /** 是否因超出 MAX_IMPORT_ROWS 被截断 */
  truncated: boolean;
}

export interface ParsedWorkbook {
  fileName: string;
  fileSize: number;
  sheets: ParsedSheet[];
}

/** 字段 → Excel 表头文本；未映射的字段不出现在对象里 */
export type ColumnMapping = Partial<Record<ImportField, string>>;

export interface RowIssue {
  row: number;
  field: ImportField | '_row';
  level: 'error' | 'warning';
  message: string;
}

/** 映射 + 校验后的单行数据，可直接提交给 POST /api/customers/import */
export interface ImportRowDraft {
  __row: number;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  title?: string;
  industry?: string;
  address?: string;
  country?: string;
  website?: string;
  grade?: string;
  notes?: string;
  // 联系渠道
  whatsapp?: string;
  skype?: string;
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  // 产品 / 需求信息
  interestedProducts?: string;
  productModel?: string;
  productCategory?: string;
  expectedQuantity?: string;
  targetPrice?: string;
  moq?: string;
  requirementNotes?: string;
  // 业务来源（自由文本）+ 优先级
  leadSource?: string;
  priority?: CustomerPriority;
  status?: CustomerStatus;
  tags?: string[];
}

export interface MappingStats {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  withEmail: number;
  withoutEmail: number;
  /** 各销售状态命中行数（8 段状态，未命中的为 0） */
  byStatus: Record<CustomerStatus, number>;
  errorCount: number;
  warningCount: number;
}

export interface MappingResult {
  customers: ImportRowDraft[];
  issues: RowIssue[];
  stats: MappingStats;
}

/** 生成一个所有状态计数为 0 的分布对象 */
function createStatusCount(): Record<CustomerStatus, number> {
  return CUSTOMER_STATUS_VALUES.reduce<Record<CustomerStatus, number>>((acc, value) => {
    acc[value] = 0;
    return acc;
  }, {} as Record<CustomerStatus, number>);
}

/* ---------------------------- 基础转换 ---------------------------- */

/** 单元格值 → 字符串。日期按 yyyy-MM-dd，数字去掉浮点尾巴 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isValid(value) ? format(value, 'yyyy-MM-dd') : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  return String(value).replace(/\r?\n/g, ' ').trim();
}

/**
 * 表头归一化：去掉 BOM、括号说明、空白与常见标点，转小写。
 * 「客户姓名 (必填)」与「客户姓名」会归一到同一个 key。
 */
export function normalizeHeader(input: unknown): string {
  return cellToText(input)
    .replace(/\uFEFF/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/[[\]【】]/g, '')
    .replace(/[\s_\-.:：*#/\\|，,]/g, '')
    .toLowerCase();
}

/** 0 → A，26 → AA，用于给空表头列生成占位名 */
function columnLabel(index: number): string {
  let label = '';
  let cursor = index;
  do {
    label = String.fromCharCode(65 + (cursor % 26)) + label;
    cursor = Math.floor(cursor / 26) - 1;
  } while (cursor >= 0);
  return label;
}

/* ---------------------------- 文件校验 ---------------------------- */

/** 返回错误提示；通过校验时返回 null */
export function validateSpreadsheetFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return `不支持的文件类型，请上传 ${SUPPORTED_EXTENSIONS.join(' / ')} 文件`;
  }
  if (file.size <= 0) return '文件为空，请检查后重新选择';
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    return `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请控制在 10 MB 以内`;
  }
  return null;
}

/* ---------------------------- 解析 ---------------------------- */

function parseSheet(name: string, sheet: XLSX.WorkSheet | undefined): ParsedSheet | null {
  if (!sheet) return null;

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });
  if (matrix.length === 0) return null;

  // 兼容「表头上方还有标题行/说明行」的文件：取第一行有内容的作为表头
  const headerIndex = matrix.findIndex((row) => row.some((cell) => cellToText(cell) !== ''));
  if (headerIndex === -1) return null;

  const headerRow = matrix[headerIndex]!;
  const dataRows = matrix.slice(headerIndex + 1);

  // 有效列数：表头有文本，或至少一行在该列有值（避免解析出上百个空列）
  const maxColumns = dataRows.reduce((max, row) => Math.max(max, row.length), headerRow.length);
  let columnCount = 0;
  for (let c = 0; c < maxColumns; c += 1) {
    const hasHeader = cellToText(headerRow[c]) !== '';
    const hasData = dataRows.some((row) => cellToText(row[c]) !== '');
    if (hasHeader || hasData) columnCount = c + 1;
  }
  if (columnCount === 0) return null;

  // 生成表头：空表头补「列 A」，重名补序号，保证 key 唯一
  const headers: string[] = [];
  const used = new Map<string, number>();
  for (let c = 0; c < columnCount; c += 1) {
    const text = cellToText(headerRow[c]) || `列 ${columnLabel(c)}`;
    const count = used.get(text) ?? 0;
    used.set(text, count + 1);
    headers.push(count === 0 ? text : `${text} (${count + 1})`);
  }

  const rows: ParsedRow[] = [];
  let truncated = false;
  for (let r = 0; r < dataRows.length; r += 1) {
    if (rows.length >= MAX_IMPORT_ROWS) {
      truncated = true;
      break;
    }
    const raw = dataRows[r]!;
    const values: Record<string, string> = {};
    let hasValue = false;
    for (let c = 0; c < columnCount; c += 1) {
      const text = cellToText(raw[c]);
      values[headers[c]!] = text;
      if (text !== '') hasValue = true;
    }
    // 全空行直接跳过，不计入行号统计之外的噪音
    if (!hasValue) continue;
    rows.push({ row: headerIndex + r + 2, values });
  }

  if (rows.length === 0) return null;
  return { name, headers, rows, headerRow: headerIndex + 1, truncated };
}

/** 读取并解析工作簿，只保留「有数据」的工作表 */
export async function readWorkbookFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch {
    throw new Error('文件解析失败，请确认它是有效的 Excel 文件（未加密、未损坏）');
  }

  const sheets = workbook.SheetNames.map((name) => parseSheet(name, workbook.Sheets[name]))
    .filter((sheet): sheet is ParsedSheet => sheet !== null);

  if (sheets.length === 0) {
    throw new Error('文件中没有找到可导入的数据行，请检查内容后重试');
  }
  return { fileName: file.name, fileSize: file.size, sheets };
}

/* ---------------------------- 自动列映射 ---------------------------- */

/**
 * 基于别名表自动匹配列。
 * 两轮策略：先精确匹配（归一化后完全相等），再包含匹配（兼容「客户姓名*」这类表头）。
 * 每一列最多分配给一个字段，避免同列被多个字段争抢。
 */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const candidates = headers
    .map((header) => ({ header, key: normalizeHeader(header) }))
    .filter((item) => item.key.length > 0);

  for (const def of IMPORT_FIELDS) {
    const aliases = def.aliases.map((alias) => normalizeHeader(alias)).filter(Boolean);
    const hit = candidates.find((item) => !used.has(item.header) && aliases.includes(item.key));
    if (hit) {
      mapping[def.field] = hit.header;
      used.add(hit.header);
    }
  }

  for (const def of IMPORT_FIELDS) {
    if (mapping[def.field]) continue;
    const aliases = def.aliases.map((alias) => normalizeHeader(alias)).filter((alias) => alias.length >= 2);
    const hit = candidates.find(
      (item) =>
        !used.has(item.header) &&
        item.key.length >= 2 &&
        aliases.some((alias) => item.key.includes(alias) || alias.includes(item.key)),
    );
    if (hit) {
      mapping[def.field] = hit.header;
      used.add(hit.header);
    }
  }

  return mapping;
}

/** 已映射的字段数量，用于判断「至少映射了姓名」 */
export function countMappedFields(mapping: ColumnMapping): number {
  return Object.values(mapping).filter(Boolean).length;
}

/* ---------------------------- 应用映射 + 校验 ---------------------------- */

/** 标签列拆分：兼容英文逗号、中文逗号、顿号、分号、竖线 */
function splitTags(raw: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,，、;；|/]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= 40),
    ),
  ).slice(0, 30);
}

/** 电话：去掉 Excel 千分位与多余空白，保留 + - ( ) */
function cleanPhone(raw: string): string {
  return raw.replace(/[\s-]{2,}/g, ' ').replace(/,(?=\d{3}\b)/g, '').trim();
}

/** 网址：补协议，方便前端渲染成可点击链接 */
function cleanWebsite(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, '')}`;
}

const TEXT_FIELDS = [
  'company',
  'phone',
  'title',
  'industry',
  'address',
  'country',
  'grade',
  'notes',
  // 联系渠道（保留原始文本，是否可点击由详情页按 URL 形态判断）
  'whatsapp',
  'skype',
  'linkedin',
  'facebook',
  'instagram',
  // 产品 / 需求信息
  'interestedProducts',
  'productModel',
  'productCategory',
  'expectedQuantity',
  'targetPrice',
  'moq',
  'requirementNotes',
  // 业务来源（自由文本，兼容自定义值）
  'leadSource',
] as const satisfies readonly ImportField[];

/**
 * 把原始行按映射转换成可提交的数据，同时产出行级问题清单。
 * error 级别的行会被剔除（不进 customers），warning 只提示不阻断。
 */
export function applyMapping(
  rows: ParsedRow[],
  mapping: ColumnMapping,
  defaultStatus: CustomerStatus,
): MappingResult {
  const customers: ImportRowDraft[] = [];
  const issues: RowIssue[] = [];
  const seenEmail = new Map<string, number>();
  const seenIdentity = new Map<string, number>();

  let invalidRows = 0;
  let withEmail = 0;
  const byStatus = createStatusCount();

  if (!mapping.name) {
    return {
      customers: [],
      issues: [{ row: 0, field: 'name', level: 'error', message: '请先为「姓名」指定对应的 Excel 列' }],
      stats: {
        totalRows: rows.length,
        validRows: 0,
        invalidRows: rows.length,
        withEmail: 0,
        withoutEmail: 0,
        byStatus: createStatusCount(),
        errorCount: 1,
        warningCount: 0,
      },
    };
  }

  for (const { row, values } of rows) {
    const rowIssues: RowIssue[] = [];
    const pick = (field: ImportField): string => {
      const header = mapping[field];
      return header ? (values[header] ?? '').trim() : '';
    };

    const name = pick('name');
    if (!name) {
      rowIssues.push({ row, field: 'name', level: 'error', message: '姓名为空，该行已跳过' });
    } else if (name.length > 120) {
      rowIssues.push({ row, field: 'name', level: 'error', message: '姓名超过 120 个字符' });
    }

    const rawEmail = pick('email');
    let email = '';
    if (rawEmail) {
      email = rawEmail.toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        rowIssues.push({ row, field: 'email', level: 'error', message: `邮箱格式不正确：${rawEmail}` });
        email = '';
      } else if (seenEmail.has(email)) {
        rowIssues.push({
          row,
          field: 'email',
          level: 'warning',
          message: `邮箱与第 ${seenEmail.get(email)} 行重复，该行已跳过`,
        });
      }
    }

    // 文件内去重：有邮箱按邮箱，没邮箱按「姓名 + 公司」
    const identity = email || `${name}::${pick('company').toLowerCase()}`;
    const duplicatedIdentity = !email && name ? seenIdentity.has(identity) : false;
    if (duplicatedIdentity) {
      rowIssues.push({
        row,
        field: '_row',
        level: 'warning',
        message: `与第 ${seenIdentity.get(identity)} 行的姓名/公司完全相同，该行已跳过`,
      });
    }

    const rawStatus = pick('status');
    let status: CustomerStatus | undefined;
    if (rawStatus) {
      const mapped = STATUS_TEXT_MAP[normalizeHeader(rawStatus)] ?? STATUS_TEXT_MAP[rawStatus.trim().toLowerCase()];
      if (mapped) {
        status = mapped;
      } else {
        status = defaultStatus;
        rowIssues.push({
          row,
          field: 'status',
          level: 'warning',
          message: `无法识别的状态「${rawStatus}」，已按默认状态处理`,
        });
      }
    }

    const rawPriority = pick('priority');
    let priority: CustomerPriority | undefined;
    if (rawPriority) {
      // 与后端一致：无法识别的优先级静默忽略（落库走默认 medium），不阻断整行
      priority =
        PRIORITY_TEXT_MAP[normalizeHeader(rawPriority)] ??
        PRIORITY_TEXT_MAP[rawPriority.trim().toLowerCase()];
    }

    const hasError = rowIssues.some((issue) => issue.level === 'error');
    const isDuplicate = Boolean(email && seenEmail.has(email)) || duplicatedIdentity;
    issues.push(...rowIssues);

    if (hasError || isDuplicate || !name) {
      invalidRows += 1;
      continue;
    }

    const draft: ImportRowDraft = { __row: row, name, status: status ?? defaultStatus };

    for (const field of TEXT_FIELDS) {
      const value = pick(field);
      if (!value) continue;
      if (field === 'phone') draft.phone = cleanPhone(value);
      else draft[field] = value;
    }

    if (email) {
      draft.email = email;
      seenEmail.set(email, row);
      withEmail += 1;
    }
    const website = pick('website');
    if (website) draft.website = cleanWebsite(website);

    const tags = splitTags(pick('tags'));
    if (tags.length > 0) draft.tags = tags;

    if (priority) draft.priority = priority;

    if (!seenIdentity.has(identity)) seenIdentity.set(identity, row);
    if (draft.status) byStatus[draft.status] += 1;

    customers.push(draft);
  }

  return {
    customers,
    issues,
    stats: {
      totalRows: rows.length,
      validRows: customers.length,
      invalidRows,
      withEmail,
      withoutEmail: customers.length - withEmail,
      byStatus,
      errorCount: issues.filter((issue) => issue.level === 'error').length,
      warningCount: issues.filter((issue) => issue.level === 'warning').length,
    },
  };
}

/** 供导入结果弹窗使用：把问题按行号排序并截断，避免渲染上万条 */
export function sortIssues(issues: RowIssue[], limit = 200): RowIssue[] {
  return [...issues]
    .sort((a, b) => a.row - b.row || a.level.localeCompare(b.level))
    .slice(0, limit);
}
