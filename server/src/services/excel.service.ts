/**
 * Excel 服务（服务端导出 / 模板生成）
 * ------------------------------------------------------------------
 * 使用 SheetJS(xlsx) 生成 .xlsx Buffer，由 controller 直接写回响应流。
 * 导入解析放在浏览器端完成（避免大文件上传与临时磁盘占用），
 * 服务端只接收映射后的 JSON 行数据。
 */
import * as XLSX from 'xlsx';
import { CUSTOMER_PRIORITY_LABEL, CUSTOMER_STATUS_LABEL, type CustomerPriority, type CustomerStatus } from '../constants';
import type { ICustomer } from '../models';

/** 导出列定义：中文表头 ↔ 数据取值函数 */
interface ExportColumn {
  header: string;
  width: number;
  value: (row: ICustomer) => string | number;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: '姓名', width: 20, value: (r) => r.name ?? '' },
  { header: '公司', width: 30, value: (r) => r.company ?? '' },
  { header: '邮箱', width: 32, value: (r) => r.email ?? '' },
  { header: '手机号', width: 18, value: (r) => r.phone ?? '' },
  { header: 'WhatsApp', width: 20, value: (r) => r.whatsapp ?? '' },
  { header: 'Skype', width: 18, value: (r) => r.skype ?? '' },
  { header: 'LinkedIn', width: 32, value: (r) => r.linkedin ?? '' },
  { header: 'Facebook', width: 32, value: (r) => r.facebook ?? '' },
  { header: 'Instagram', width: 24, value: (r) => r.instagram ?? '' },
  { header: '职位', width: 18, value: (r) => r.title ?? '' },
  { header: '行业', width: 20, value: (r) => r.industry ?? '' },
  { header: '国家', width: 14, value: (r) => r.country ?? '' },
  { header: '官网', width: 32, value: (r) => r.website ?? '' },
  { header: '地址', width: 40, value: (r) => r.address ?? '' },
  { header: '等级', width: 8, value: (r) => r.grade ?? '' },
  { header: '来源', width: 16, value: (r) => r.leadSource ?? '' },
  { header: '优先级', width: 10, value: (r) => CUSTOMER_PRIORITY_LABEL[(r.priority ?? 'medium') as CustomerPriority] },
  { header: '感兴趣产品', width: 24, value: (r) => r.interestedProducts ?? '' },
  { header: '产品型号', width: 18, value: (r) => r.productModel ?? '' },
  { header: '产品分类', width: 18, value: (r) => r.productCategory ?? '' },
  { header: '预计采购数量', width: 16, value: (r) => r.expectedQuantity ?? '' },
  { header: '目标价格', width: 14, value: (r) => r.targetPrice ?? '' },
  { header: 'MOQ', width: 12, value: (r) => r.moq ?? '' },
  { header: '需求备注', width: 40, value: (r) => r.requirementNotes ?? '' },
  { header: '备注', width: 50, value: (r) => r.notes ?? '' },
  { header: '状态', width: 10, value: (r) => CUSTOMER_STATUS_LABEL[(r.status ?? 'pending') as CustomerStatus] },
  { header: '标签', width: 24, value: (r) => (r.tags ?? []).join(', ') },
  { header: '开发信数', width: 10, value: (r) => r.letterCount ?? 0 },
  {
    header: '最近联系时间',
    width: 20,
    value: (r) => (r.lastContactAt ? new Date(r.lastContactAt).toISOString().replace('T', ' ').slice(0, 16) : ''),
  },
  {
    header: '创建时间',
    width: 20,
    value: (r) => (r.createdAt ? new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 16) : ''),
  },
];

/** 生成 .xlsx Buffer */
export function buildCustomersWorkbook(customers: ICustomer[], sheetName = '客户列表'): Buffer {
  const aoa: (string | number)[][] = [EXPORT_COLUMNS.map((c) => c.header)];
  customers.forEach((row) => {
    aoa.push(EXPORT_COLUMNS.map((c) => safeValue(c.value(row))));
  });

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = EXPORT_COLUMNS.map((c) => ({ wch: c.width }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * 生成空白导入模板（含表头 + 2 行示例）。
 * 用户下载后直接填数据再导入，零学习成本。
 */
export function buildImportTemplate(): Buffer {
  const headers = [
    '姓名', '公司', '邮箱', '手机号', 'WhatsApp', 'Skype', 'LinkedIn', 'Facebook', 'Instagram',
    '职位', '行业', '国家', '官网', '地址', '等级', '来源', '优先级',
    '感兴趣产品', '产品型号', '产品分类', '预计采购数量', '目标价格', 'MOQ', '需求备注', '备注', '状态',
  ];
  const examples: (string | number)[][] = [
    [
      'Ella Drake',
      'Monarc Jewellery',
      'ella@monarcjewellery.com',
      '+64 21 000 0000',
      '+64 21 000 0000',
      '',
      'https://www.linkedin.com/in/elladrake',
      '',
      '@monarcjewellery',
      'Founder',
      'Jewellery',
      'New Zealand',
      'https://monarcjewellery.com',
      'Auckland, New Zealand',
      'A',
      'Exhibition',
      '高',
      'Silver Necklace, Gift Box',
      'MN-2024',
      'Jewellery Packaging',
      '500 pcs',
      'USD 3.5 / pc',
      '100 pcs',
      'FSC / plastic-free 包装，低库存小批量补货，主攻 100 pcs 低 MOQ',
      '老客户复购意向强',
      '待开发',
    ],
    [
      'John Smith',
      'Aurora Silver Co.',
      'john@aurorasilver.com',
      '+44 7700 900000',
      '+44 7700 900000',
      'john.aurora',
      '',
      '',
      '',
      'Purchasing Manager',
      'Jewellery',
      'United Kingdom',
      'https://aurorasilver.co.uk',
      'London, UK',
      'B',
      'Google',
      '中',
      'Ring Box',
      '',
      'Packaging',
      '1000 pcs',
      '',
      '500 pcs',
      '关注可降解内托与丝带定制',
      '',
      '已联系',
    ],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  worksheet['!cols'] = [
    { wch: 20 }, { wch: 28 }, { wch: 32 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 32 }, { wch: 24 }, { wch: 20 },
    { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 32 }, { wch: 32 }, { wch: 8 }, { wch: 16 }, { wch: 10 },
    { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 60 }, { wch: 10 },
  ];

  // 第二个工作表：填写说明
  const instructions = XLSX.utils.aoa_to_sheet([
    ['字段', '是否必填', '说明'],
    ['姓名', '必填', '联系人姓名。中文名或英文名均可，英文名会自动提取 First Name 用于 {{firstName}} 占位符。'],
    ['公司', '选填', '客户公司名称，对应 {{company}} 占位符。'],
    ['邮箱', '建议必填', '发送开发信的必要条件；为空时无法直接发信，需要发送时手动指定收件人。'],
    ['手机号', '选填', '支持任意格式，原样保存。'],
    ['WhatsApp', '选填', 'WhatsApp 号码或链接；详情页会拼为 https://wa.me/ 快捷聊天。'],
    ['Skype', '选填', 'Skype 账号。'],
    ['LinkedIn', '选填', 'LinkedIn 主页完整 URL 或用户名；仅完整 URL 可点击打开。'],
    ['Facebook', '选填', 'Facebook 主页完整 URL 或用户名；仅完整 URL 可点击打开。'],
    ['Instagram', '选填', 'Instagram 完整 URL 或用户名；仅完整 URL 可点击打开。'],
    ['职位', '选填', '如 Founder / Purchasing Manager。'],
    ['行业', '选填', '如 Jewellery / Fashion，可用于列表筛选。'],
    ['国家', '选填', '国家或地区。'],
    ['官网', '选填', '客户官网。'],
    ['地址', '选填', '详细地址。'],
    ['等级', '选填', '自定义客户分级，如 A / B / C。'],
    ['来源', '选填', '客户业务来源。建议值：Excel Import / Website / Alibaba / Made-in-China / Google / Facebook / LinkedIn / WhatsApp / Exhibition / Referral / Existing Customer / Other；也接受任意自定义值（如 Dubai Exhibition），原样保存。'],
    ['优先级', '选填', '跟进优先级：高 / 中 / 低（也接受 High / Medium / Low）。留空默认「中」。与「等级」是不同维度。'],
    ['感兴趣产品', '选填', '客户感兴趣的产品，可逗号分隔多个。'],
    ['产品型号', '选填', '客户关注的产品型号。'],
    ['产品分类', '选填', '产品分类。'],
    ['预计采购数量', '选填', '如 500 pcs。'],
    ['目标价格', '选填', '如 USD 3.5 / pc。'],
    ['MOQ', '选填', '客户可接受 / 关注的最低起订量。'],
    ['需求备注', '选填', '客户其它需求说明，最长 5000 字符。'],
    ['备注', '选填', '最长 5000 字符。'],
    ['状态', '选填', '可填：待开发 / 已联系 / 已回复 / 有意向 / 报价中 / 谈判中 / 已成交 / 已流失（也接受对应英文 pending / contacted / replied / interested / quoting / negotiating / won / lost）。旧值「已开发 / developed」会自动归为「已联系」。留空默认「待开发」。'],
    [],
    ['提示', '', '导入时系统会自动识别中英文表头；无法识别的列可在导入向导里手动指定映射。'],
    ['提示', '', '邮箱重复时可选择「跳过」或「覆盖更新」。'],
  ]);
  instructions['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 100 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '客户导入模板');
  XLSX.utils.book_append_sheet(workbook, instructions, '填写说明');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 生成开发信记录的导出表 */
export function buildLettersWorkbook(
  letters: Array<{
    recipientName: string;
    recipientEmail: string;
    subject: string;
    contentText: string;
    status: string;
    channel: string;
    sentAt?: Date;
    customerName?: string;
    customerCompany?: string;
  }>,
): Buffer {
  const headers = ['客户姓名', '客户公司', '收件人', '收件邮箱', '主题', '正文（纯文本）', '状态', '通道', '发送时间'];
  const statusLabel: Record<string, string> = { sent: '已发送', draft: '草稿', failed: '发送失败' };

  const aoa: (string | number)[][] = [headers];
  letters.forEach((l) => {
    aoa.push([
      l.customerName ?? '',
      l.customerCompany ?? '',
      l.recipientName ?? '',
      l.recipientEmail ?? '',
      l.subject ?? '',
      (l.contentText ?? '').slice(0, 32000),
      statusLabel[l.status] ?? l.status,
      l.channel ?? '',
      l.sentAt ? new Date(l.sentAt).toISOString().replace('T', ' ').slice(0, 19) : '',
    ]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = [
    { wch: 20 },
    { wch: 28 },
    { wch: 20 },
    { wch: 32 },
    { wch: 40 },
    { wch: 80 },
    { wch: 10 },
    { wch: 8 },
    { wch: 20 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '开发信记录');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Excel 单元格禁止出现控制字符与公式前缀，统一清洗 */
function safeValue(value: string | number): string | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  const cleaned = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, 32767); // Excel 单元格上限
  // 以 = + - @ 开头的内容会被 Excel 当公式执行，加前导单引号规避 CSV/XLSX 注入
  return /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}
