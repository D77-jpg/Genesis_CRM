export type ProductStatus = 'active' | 'archived';

export interface ProductSpec {
  code: string;
  name: string;
  value: string;
  unit?: string;
  notes?: string;
}

export interface ProductPriceTier {
  minQuantity: number;
  maxQuantity?: number;
  unitPrice: number;
  currency: 'USD' | 'EUR' | 'GBP' | 'CNY';
  moq?: string;
  leadTime?: string;
  notes?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category?: string;
  description?: string;
  status: ProductStatus;
  specs: ProductSpec[];
  priceTiers: ProductPriceTier[];
  moq?: string;
  leadTime?: string;
  notes?: string;
  source?: string;
  effectiveFrom?: string | Date;
  effectiveUntil?: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ProductImportResult {
  created: number;
  updated: number;
  products: Product[];
}

export interface QuoteCheckItem {
  requestedName: string;
  requestedQuantity?: number;
  product?: { id: string; sku: string; name: string; category?: string };
  tier?: { minQuantity: number; maxQuantity?: number; unitPrice: number; currency: string; moq?: string; leadTime?: string };
  quoted?: { quotationId: string; quotationNo: string; productName: string; quantity: number; unitPrice: number; currency: string; createdAt: string | Date };
  status: 'matched' | 'catalog_missing' | 'product_missing' | 'quantity_missing' | 'price_mismatch' | 'below_catalog' | 'review_required';
  messages: string[];
}

export interface QuoteCheckResult {
  customerId?: string;
  analysisId?: string;
  checkedAt: string;
  items: QuoteCheckItem[];
  summary: { matched: number; warnings: number; blockers: number; message: string };
  sources: {
    products: { id: string; sku: string; name: string }[];
    quotations: { id: string; quotationNo: string; createdAt: string | Date }[];
  };
}
