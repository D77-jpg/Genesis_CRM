/**
 * 分页 / 排序 / 统一响应体工具
 */
import type { Response } from 'express';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants';

export interface PaginationQuery {
  page: number;
  limit: number;
  skip: number;
  sortBy: string;
  sortOrder: 1 | -1;
}

const SORTABLE_CUSTOMER_FIELDS = new Set([
  'name',
  'company',
  'email',
  'status',
  'industry',
  'letterCount',
  'lastContactAt',
  'nextFollowUpAt',
  'createdAt',
  'updatedAt',
]);

const SORTABLE_LETTER_FIELDS = new Set([
  'subject',
  'recipientName',
  'recipientEmail',
  'status',
  'channel',
  'sentAt',
  'createdAt',
  'updatedAt',
]);

const SORTABLE_QUOTATION_FIELDS = new Set([
  'quotationNo',
  'title',
  'currency',
  'totalAmount',
  'status',
  'validityDate',
  'createdAt',
  'updatedAt',
]);

function toPositiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

/**
 * 解析分页参数，白名单校验排序字段，避免 NoSQL 注入 / 越权排序。
 */
export function parsePagination(
  query: Record<string, unknown>,
  options: { allowedSortFields: Set<string>; defaultSortBy?: string } = {
    allowedSortFields: SORTABLE_CUSTOMER_FIELDS,
  },
): PaginationQuery {
  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit ?? query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  const requestedSort = String(query.sortBy ?? options.defaultSortBy ?? 'updatedAt');
  const sortBy = options.allowedSortFields.has(requestedSort) ? requestedSort : 'updatedAt';
  const sortOrder: 1 | -1 = String(query.sortOrder ?? 'desc').toLowerCase() === 'asc' ? 1 : -1;

  return { page, limit, skip: (page - 1) * limit, sortBy, sortOrder };
}

export const sortableFields = {
  customer: SORTABLE_CUSTOMER_FIELDS,
  letter: SORTABLE_LETTER_FIELDS,
  quotation: SORTABLE_QUOTATION_FIELDS,
};

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function buildPaginated<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/** 统一成功响应包装：{ success: true, data, meta? } */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200, meta?: Record<string, unknown>): Response {
  return res.status(statusCode).json({ success: true, data, ...(meta ? { meta } : {}) });
}
