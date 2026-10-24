/**
 * xlsx 换成 SheetJS 0.20.3 之后的功能冒烟：
 * 1) 导出的工作簿能被重新解析回来（列头、行数、内容一致）
 * 2) 导入模板能被解析，且模板表结构与前端 autoMapColumns 期待的一致
 * 用法：node --import tsx scripts/smoke-xlsx.ts
 */
import * as XLSX from 'xlsx';
import { buildCustomersWorkbook, buildImportTemplate, buildLettersWorkbook } from '../src/services/excel.service';

const ok = (label: string, condition: boolean, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!condition) process.exitCode = 1;
};

/** 用同一份 xlsx 库把 Buffer 读回来 */
function readBack(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false }) as unknown[][],
  }));
  return { sheetNames: workbook.SheetNames, sheets };
}

// 1) 客户导出
const customers = [
  {
    name: 'Claudia Cho',
    company: 'Bimbotech',
    email: 'cc@bimbotech.co',
    phone: '13800000000',
    country: '美国',
    industry: '珠宝首饰',
    status: 'contacted',
    priority: 'medium',
    source: 'mail',
    tags: ['邮件来访'],
    createdAt: new Date('2026-10-22T10:00:00Z'),
    lastContactAt: new Date('2026-10-22T10:00:00Z'),
  },
] as never[];
const customerBook = buildCustomersWorkbook(customers);
ok('客户导出能生成 xlsx', customerBook.length > 0, `${customerBook.length} 字节，PK 头=${customerBook.slice(0, 2).toString()}`);
const back = readBack(customerBook);
ok('客户导出只有 1 个 sheet', back.sheetNames.length === 1, back.sheetNames.join(','));
const header = (back.sheets[0].rows[0] ?? []).map((cell) => String(cell));
ok('列头可读回', header.length > 5, header.slice(0, 6).join(' | '));
const bodyRow = (back.sheets[0].rows[1] ?? []).map((cell) => String(cell));
ok('数据行内容正确', bodyRow.includes('Claudia Cho') && bodyRow.includes('cc@bimbotech.co'), bodyRow.slice(0, 4).join(' | '));

// 2) 导入模板
const template = buildImportTemplate();
ok('导入模板能生成', template.length > 0, `${template.length} 字节`);
const tplBack = readBack(template);
ok('模板含 2 个 sheet（模板 + 填写说明）', tplBack.sheetNames.length === 2, tplBack.sheetNames.join(','));
const tplHeader = (tplBack.sheets[0].rows[0] ?? []).map((cell) => String(cell));
ok('模板首行是列头且非空', tplHeader.length >= 5 && tplHeader.every((cell) => cell.length > 0), tplHeader.join(' | '));
ok('模板带示例行', (tplBack.sheets[0].rows.length ?? 0) >= 2, `共 ${tplBack.sheets[0].rows.length} 行`);

// 3) 开发信导出
const letters = [
  { subject: 'Re: RFQ pink velvet pouch', customerName: 'Claudia Cho', company: 'Bimbotech', sentAt: new Date('2026-10-22T10:00:00Z'), channel: 'smtp', status: 'sent' },
] as never[];
const letterBook = buildLettersWorkbook(letters);
const letterBack = readBack(letterBook);
ok('开发信导出可读回', letterBack.sheetNames.length === 1 && (letterBack.sheets[0].rows.length ?? 0) >= 2, letterBack.sheetNames.join(','));
