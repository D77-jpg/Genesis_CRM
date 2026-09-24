/**
 * Genesis 权威报价 PDF
 * ------------------------------------------------------------------
 * - 数据只从当前项目的 Quotation / Customer 读取；
 * - 使用随 npm 依赖部署的 Noto Sans SC，避免中文乱码；
 * - 元数据时间取业务记录时间，关闭压缩并固定绘制顺序，使同一版本字节稳定；
 * - draft 报价每页带 DRAFT 水印；ETag 同时绑定 quotationId、version 和 PDF 内容。
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import env from '../config/env';
import { Customer, Quotation, type QuotationDocument } from '../models';
import { ApiError } from '../utils/ApiError';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_BOTTOM = PAGE_HEIGHT - 70;
const FONT_PATH = path.resolve(
  path.dirname(require.resolve('@embedpdf/fonts-sc')),
  '../fonts/NotoSansHans-Regular.otf',
);
const PDF_CACHE_LIMIT = 64;

interface PdfCustomer {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  country?: string;
  externalId: string;
}

export interface QuotationPdfResult {
  buffer: Buffer;
  etag: string;
  version: number;
  filename: string;
  asciiFilename: string;
}

const pdfCache = new Map<string, QuotationPdfResult>();

function getCachedPdf(key: string): QuotationPdfResult | undefined {
  const cached = pdfCache.get(key);
  if (!cached) return undefined;
  pdfCache.delete(key);
  pdfCache.set(key, cached);
  return cached;
}

function cachePdf(key: string, value: QuotationPdfResult): void {
  pdfCache.set(key, value);
  while (pdfCache.size > PDF_CACHE_LIMIT) {
    const oldest = pdfCache.keys().next().value as string | undefined;
    if (!oldest) break;
    pdfCache.delete(oldest);
  }
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function formatDate(value?: Date): string {
  return value ? value.toISOString().slice(0, 10) : '—';
}

function formatMoney(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

function drawLabelValue(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number): void {
  doc.fillColor('#64748b').fontSize(8).text(label, x, y, { width: 95 });
  doc.fillColor('#0f172a').fontSize(9).text(value || '—', x + 95, y, { width: 150 });
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 24).fill('#e2e8f0');
  doc.fillColor('#334155').fontSize(8);
  doc.text('产品 / Product', MARGIN + 6, y + 7, { width: 205 });
  doc.text('数量 / Qty', 263, y + 7, { width: 55, align: 'right' });
  doc.text('单价 / Unit', 327, y + 7, { width: 75, align: 'right' });
  doc.text('金额 / Amount', 411, y + 7, { width: 128, align: 'right' });
  return y + 24;
}

function addDocumentChrome(doc: PDFKit.PDFDocument, status: string): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    if (status === 'draft') {
      doc.save();
      doc.fillColor('#94a3b8').fillOpacity(0.14).fontSize(74);
      doc.rotate(-32, { origin: [PAGE_WIDTH / 2, PAGE_HEIGHT / 2] });
      doc.text('DRAFT', 118, PAGE_HEIGHT / 2 - 42, { width: 360, align: 'center' });
      doc.restore();
    }
    doc.save();
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor('#94a3b8').fillOpacity(1).fontSize(7);
    doc.text(
      `${env.COMPANY_NAME}  ·  ${index - range.start + 1} / ${range.count}`,
      MARGIN,
      PAGE_HEIGHT - 42,
      { width: PAGE_WIDTH - MARGIN * 2, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = originalBottomMargin;
    doc.restore();
  }
}

async function buildPdf(quotation: QuotationDocument, customer: PdfCustomer): Promise<Buffer> {
  const doc = new PDFDocument({
    autoFirstPage: true,
    bufferPages: true,
    compress: false,
    size: 'A4',
    margins: { top: MARGIN, right: MARGIN, bottom: 70, left: MARGIN },
    info: {
      Title: `Quotation ${quotation.quotationNo}`,
      Author: env.COMPANY_NAME,
      Subject: `${quotation.status.toUpperCase()} quotation version ${quotation.version ?? 1}`,
      Creator: 'Genesis_CRM',
      Producer: 'Genesis_CRM / PDFKit',
      CreationDate: quotation.createdAt,
      ModDate: quotation.updatedAt,
    },
  });
  const completed = collectPdf(doc);
  doc.registerFont('NotoSansSC', FONT_PATH);
  doc.font('NotoSansSC');

  doc.fillColor('#0f172a').fontSize(17).text(env.COMPANY_NAME, MARGIN, MARGIN, {
    width: PAGE_WIDTH - MARGIN * 2,
  });
  doc.fillColor('#475569').fontSize(9).text(env.COMPANY_WEBSITE, MARGIN, MARGIN + 24);
  doc.fillColor('#0f172a').fontSize(24).text('报价单 / QUOTATION', MARGIN, MARGIN + 58, {
    width: PAGE_WIDTH - MARGIN * 2,
    align: 'right',
  });
  doc.moveTo(MARGIN, MARGIN + 92).lineTo(PAGE_WIDTH - MARGIN, MARGIN + 92).strokeColor('#cbd5e1').stroke();

  let y = MARGIN + 108;
  drawLabelValue(doc, '报价编号 / No.', quotation.quotationNo, MARGIN, y);
  drawLabelValue(doc, '状态 / Status', quotation.status.toUpperCase(), 310, y);
  y += 22;
  drawLabelValue(doc, '客户 / Customer', customer.company || customer.name, MARGIN, y);
  drawLabelValue(doc, '联系人 / Contact', customer.name, 310, y);
  y += 22;
  drawLabelValue(doc, '邮箱 / Email', customer.email ?? '—', MARGIN, y);
  drawLabelValue(doc, '国家 / Country', customer.country ?? '—', 310, y);
  y += 22;
  drawLabelValue(doc, '有效期 / Valid until', formatDate(quotation.validityDate), MARGIN, y);
  drawLabelValue(doc, '版本 / Version', String(quotation.version ?? 1), 310, y);

  y += 34;
  doc.fillColor('#0f172a').fontSize(13).text(quotation.title, MARGIN, y, {
    width: PAGE_WIDTH - MARGIN * 2,
  });
  y = doc.y + 14;
  y = drawTableHeader(doc, y);

  for (const item of quotation.items) {
    const product = item.model ? `${item.productName}\n${item.model}` : item.productName;
    const productHeight = doc.heightOfString(product, { width: 205 });
    const rowHeight = Math.max(28, productHeight + 12);
    if (y + rowHeight > CONTENT_BOTTOM) {
      doc.addPage();
      y = MARGIN;
      y = drawTableHeader(doc, y);
    }
    doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, rowHeight).strokeColor('#e2e8f0').stroke();
    doc.fillColor('#0f172a').fontSize(8.5);
    doc.text(product, MARGIN + 6, y + 6, { width: 205 });
    doc.text(String(item.quantity), 263, y + 8, { width: 55, align: 'right' });
    doc.text(formatMoney(item.unitPrice, quotation.currency), 327, y + 8, { width: 75, align: 'right' });
    doc.text(formatMoney(item.amount, quotation.currency), 411, y + 8, { width: 128, align: 'right' });
    y += rowHeight;
  }

  if (y + 46 > CONTENT_BOTTOM) {
    doc.addPage();
    y = MARGIN;
  }
  doc.rect(327, y, 212, 38).fill('#f1f5f9');
  doc.fillColor('#334155').fontSize(9).text('总计 / TOTAL', 337, y + 13, { width: 74 });
  doc.fillColor('#0f172a').fontSize(12).text(
    formatMoney(quotation.totalAmount, quotation.currency),
    411,
    y + 11,
    { width: 118, align: 'right' },
  );
  y += 54;

  const detailRows = [
    ['付款方式 / Payment terms', quotation.paymentTerms],
    ['交期 / Lead time', quotation.leadTime],
    ['最低起订量 / MOQ', quotation.moq],
    ['备注 / Notes', quotation.notes],
  ] as const;
  for (const [label, raw] of detailRows) {
    if (!raw) continue;
    const height = Math.max(24, doc.heightOfString(raw, { width: 330 }) + 10);
    if (y + height > CONTENT_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    doc.fillColor('#64748b').fontSize(8).text(label, MARGIN, y + 3, { width: 145 });
    doc.fillColor('#0f172a').fontSize(9).text(raw, MARGIN + 150, y + 3, { width: 349 });
    y += height;
  }

  addDocumentChrome(doc, quotation.status);
  doc.end();
  return completed;
}

export async function renderIntegrationQuotationPdf(input: {
  projectId: string;
  quotationId: string;
}): Promise<QuotationPdfResult> {
  const quotation = await Quotation.findOne({
    _id: input.quotationId,
    projectId: input.projectId,
  });
  if (!quotation) throw ApiError.notFound('报价不存在或不属于当前项目');

  const version = quotation.version ?? 1;
  const cacheKey = `${input.projectId}:${input.quotationId}:${version}`;
  const cached = getCachedPdf(cacheKey);
  if (cached) return cached;

  const customer = await Customer.findOne({
    _id: quotation.customerId,
    projectId: input.projectId,
  }).select('name company email phone country externalId');
  if (!customer?.externalId) throw ApiError.notFound('报价未关联外部客户引用');

  try {
    const buffer = await buildPdf(quotation, {
      name: customer.name,
      company: customer.company,
      email: customer.email,
      phone: customer.phone,
      country: customer.country,
      externalId: customer.externalId,
    });
    const digest = createHash('sha256')
      .update(`${String(quotation._id)}:${version}:`)
      .update(buffer)
      .digest('hex');
    const quotationNo = quotation.quotationNo.replace(/[^A-Za-z0-9._-]/g, '_');
    const result = {
      buffer,
      etag: `"${digest}"`,
      version,
      filename: `报价单-${quotation.quotationNo}.pdf`,
      asciiFilename: `Quotation-${quotationNo || String(quotation._id)}.pdf`,
    };
    cachePdf(cacheKey, result);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.pdfUnavailable();
  }
}
