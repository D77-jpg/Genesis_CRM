import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildImportTemplate } from '../src/services/excel.service';

const dir = 'D:/Trade/genesis/CRM/Genesis_CRM/.dsh/fixtures';
mkdirSync(dir, { recursive: true });

// 1) 官方模板
writeFileSync(`${dir}/customers-template.xlsx`, buildImportTemplate());

// 2) 业务员自己整理的表格（列名不标准、带空格、中英混排）
const rows = [
  ['客户名字', 'Company Name', 'E-mail', 'WhatsApp', '国家/地区'],
  ['Test Smoke A', 'Smoke Trading LLC', 'smoke.a@example.com', '+1 555 0100', '美国'],
  ['Test Smoke B', 'Smoke Candle Co', 'smoke.b@example.com', '', '德国'],
];
const sheet = XLSX.utils.aoa_to_sheet(rows);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
writeFileSync(`${dir}/customers-messy.xlsx`, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
console.log('fixtures 已生成');
