/**
 * 产品价格 Excel 导入
 * ------------------------------------------------------------------
 * 模板是「产品 / 规格 / 阶梯价」三张表，前端先解析成产品数组再交给
 * /api/products/import，和现有 JSON 导入接口共用一套后端校验。
 */
import { normalizeHeader, readWorkbookFile, type ParsedRow, type ParsedSheet } from './excel';
import type { ProductPriceTier, ProductSpec } from '@/types';

export const PRODUCT_IMPORT_TEMPLATE_URL = '/templates/product-price-import-template.xlsx';

export interface ProductImportDraft {
  sku: string;
  name: string;
  category?: string;
  description?: string;
  status: 'active' | 'archived';
  moq?: string;
  leadTime?: string;
  notes?: string;
  specs: ProductSpec[];
  priceTiers: ProductPriceTier[];
}

type ProductWithRow = ProductImportDraft & { row: number };

const CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CNY']);

function key(value: string): string {
  return normalizeHeader(value).replace(/\*/g, '');
}

function sheetByName(sheets: ParsedSheet[], aliases: string[]): ParsedSheet | undefined {
  const wanted = aliases.map(key).filter(Boolean);
  return sheets.find((sheet) => {
    const name = key(sheet.name);
    return wanted.some((alias) => name === alias || name.includes(alias) || alias.includes(name));
  });
}

function valueOf(row: ParsedRow, aliases: string[]): string {
  const wanted = aliases.map(key).filter(Boolean);
  const entries = Object.entries(row.values);
  const exact = entries.find(([header]) => wanted.includes(key(header)));
  if (exact) return exact[1].trim();
  const fuzzy = entries.find(([header]) => {
    const normalized = key(header);
    return normalized.length > 1 && wanted.some((alias) => normalized.startsWith(alias) || alias.startsWith(normalized));
  });
  return fuzzy?.[1].trim() ?? '';
}

function required(value: string, label: string, row: ParsedRow): string {
  if (!value) throw new Error(`第 ${row.row} 行：请填写${label}`);
  return value;
}

function numberValue(value: string, label: string, row: ParsedRow, optional = false): number | undefined {
  const cleaned = value.replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned) {
    if (optional) return undefined;
    throw new Error(`第 ${row.row} 行：请填写${label}`);
  }
  const number = Number(cleaned);
  if (!Number.isFinite(number)) throw new Error(`第 ${row.row} 行：${label}不是有效数字`);
  return number;
}

function statusValue(value: string, row: ParsedRow): 'active' | 'archived' {
  const normalized = key(value);
  if (!normalized || ['active', '启用', '正常'].includes(normalized)) return 'active';
  if (['archived', '归档', '已归档', '停用'].includes(normalized)) return 'archived';
  throw new Error(`第 ${row.row} 行：状态请填写「启用」或「已归档」`);
}

export async function parseProductWorkbook(file: File): Promise<ProductImportDraft[]> {
  const workbook = await readWorkbookFile(file);
  const productSheet = sheetByName(workbook.sheets, ['产品', '产品目录', 'products']);
  if (!productSheet) throw new Error('没有找到「产品」工作表，请使用系统提供的 Excel 模板');

  const products = new Map<string, ProductWithRow>();
  for (const row of productSheet.rows) {
    const sku = required(valueOf(row, ['SKU', '产品SKU', 'sku']), 'SKU', row).toUpperCase();
    if (products.has(sku)) throw new Error(`产品表第 ${row.row} 行：SKU ${sku} 重复`);
    const name = required(valueOf(row, ['产品名称', '名称', 'name']), '产品名称', row);
    products.set(sku, {
      row: row.row,
      sku,
      name,
      category: valueOf(row, ['分类', '产品分类', 'category']) || undefined,
      description: valueOf(row, ['说明', '产品说明', 'description']) || undefined,
      status: statusValue(valueOf(row, ['状态', 'status']), row),
      moq: valueOf(row, ['MOQ', '起订量', 'moq']) || undefined,
      leadTime: valueOf(row, ['交期', 'leadTime']) || undefined,
      notes: valueOf(row, ['备注', 'notes']) || undefined,
      specs: [],
      priceTiers: [],
    });
  }
  if (!products.size) throw new Error('产品表没有可导入的数据');

  const specSheet = sheetByName(workbook.sheets, ['规格', '规格字段', 'specs']);
  if (specSheet) {
    for (const row of specSheet.rows) {
      const sku = required(valueOf(row, ['SKU', '产品SKU', 'sku']), 'SKU', row).toUpperCase();
      const product = products.get(sku);
      if (!product) throw new Error(`规格表第 ${row.row} 行：SKU ${sku} 不在产品表中`);
      const code = required(valueOf(row, ['规格编码', 'code']), '规格编码', row);
      const name = required(valueOf(row, ['规格名称', 'name']), '规格名称', row);
      const value = required(valueOf(row, ['规格值', 'value']), '规格值', row);
      if (product.specs.some((spec) => spec.code.toUpperCase() === code.toUpperCase())) {
        throw new Error(`规格表第 ${row.row} 行：SKU ${sku} 的规格编码 ${code} 重复`);
      }
      product.specs.push({
        code,
        name,
        value,
        unit: valueOf(row, ['单位', 'unit']) || undefined,
      });
    }
  }

  const tierSheet = sheetByName(workbook.sheets, ['阶梯价', '价格档', 'prices', 'price tiers']);
  if (tierSheet) {
    for (const row of tierSheet.rows) {
      const sku = required(valueOf(row, ['SKU', '产品SKU', 'sku']), 'SKU', row).toUpperCase();
      const product = products.get(sku);
      if (!product) throw new Error(`阶梯价表第 ${row.row} 行：SKU ${sku} 不在产品表中`);
      const minQuantity = numberValue(valueOf(row, ['起订数量', 'minQuantity']), '起订数量', row);
      const unitPrice = numberValue(valueOf(row, ['单价', 'unitPrice']), '单价', row);
      if (!Number.isInteger(minQuantity) || (minQuantity ?? 0) <= 0) {
        throw new Error(`阶梯价表第 ${row.row} 行：起订数量必须是大于 0 的整数`);
      }
      if (unitPrice === undefined || unitPrice <= 0) {
        throw new Error(`阶梯价表第 ${row.row} 行：单价必须大于 0`);
      }
      const maxQuantity = numberValue(valueOf(row, ['最高数量', 'maxQuantity']), '最高数量', row, true);
      if (maxQuantity !== undefined && (!Number.isInteger(maxQuantity) || maxQuantity < (minQuantity ?? 0))) {
        throw new Error(`阶梯价表第 ${row.row} 行：最高数量必须为空或大于等于起订数量`);
      }
      const currency = (valueOf(row, ['币种', 'currency']) || 'USD').toUpperCase();
      if (!CURRENCIES.has(currency)) throw new Error(`阶梯价表第 ${row.row} 行：币种只支持 USD / EUR / GBP / CNY`);
      product.priceTiers.push({
        minQuantity: minQuantity as number,
        maxQuantity,
        unitPrice,
        currency: currency as ProductPriceTier['currency'],
        moq: valueOf(row, ['该档MOQ', '档MOQ', 'moq']) || undefined,
        leadTime: valueOf(row, ['该档交期', '档交期', 'leadTime']) || undefined,
      });
    }
  }

  for (const product of products.values()) {
    product.priceTiers.sort((left, right) => left.minQuantity - right.minQuantity);
    for (let index = 1; index < product.priceTiers.length; index += 1) {
      const previous = product.priceTiers[index - 1];
      if (previous.maxQuantity === undefined || product.priceTiers[index].minQuantity <= previous.maxQuantity) {
        throw new Error(`${product.sku} 的阶梯价必须按数量升序且区间不重叠；上一档请填写最高数量`);
      }
    }
  }

  return Array.from(products.values()).map(({ row: _row, ...product }) => product);
}
