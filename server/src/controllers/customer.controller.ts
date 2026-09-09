/**
 * 客户接口
 * ------------------------------------------------------------------
 * GET    /api/customers                列表（搜索 / 状态筛选 / 分页 / 排序）
 * GET    /api/customers/export         导出 Excel（当前筛选条件下的全量）
 * GET    /api/customers/template       下载导入模板
 * GET    /api/customers/industries     行业下拉数据
 * GET    /api/customers/:id            详情
 * POST   /api/customers                新建
 * PUT    /api/customers/:id            更新
 * DELETE /api/customers/:id            删除（级联删开发信）
 * POST   /api/customers/import         Excel 批量导入
 * POST   /api/customers/bulk/status    批量改状态
 * POST   /api/customers/bulk/delete    批量删除
 * POST   /api/customers/bulk/tags/add     批量添加标签
 * POST   /api/customers/bulk/tags/remove  批量删除标签
 * POST   /api/customers/bulk/owner        批量分配负责人
 * POST   /api/customers/bulk/follow-up    批量设置下一次跟进时间
 */
import type { Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import {
  bulkDelete,
  bulkUpdateStatus,
  bulkAddTags,
  bulkRemoveTags,
  bulkAssignOwner,
  bulkSetFollowUp,
  createCustomer,
  deleteCustomer,
  exportCustomers,
  getCustomer,
  importCustomers,
  listCustomers,
  listIndustries,
  listOwners,
  listTags,
  updateCustomer,
} from '../services/customer.service';
import { buildCustomersWorkbook, buildImportTemplate } from '../services/excel.service';
import type { CustomerStatus } from '../constants';
import type {
  CreateCustomerInput,
  ImportCustomersInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from '../validators/customer.validator';

/** 设置 .xlsx 下载响应头（兼容中文文件名） */
function setExcelHeaders(res: Response, filename: string, chineseName: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(chineseName)}`,
  );
  res.setHeader('Cache-Control', 'no-store');
}

export const listCustomersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListCustomersQuery;
  const data = await listCustomers(query, req.user);
  sendSuccess(res, data);
});

export const getCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = await getCustomer(id, req.user);
  sendSuccess(res, data);
});

export const createCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateCustomerInput;
  const data = await createCustomer(input, req.user);
  sendSuccess(res, data, 201);
});

export const updateCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const input = req.body as UpdateCustomerInput;
  const data = await updateCustomer(id, input, req.user);
  sendSuccess(res, data);
});

export const deleteCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = await deleteCustomer(id, req.user);
  sendSuccess(res, data);
});

export const bulkStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids, status } = req.body as { ids: string[]; status: CustomerStatus };
  const result = await bulkUpdateStatus(ids, status, req.user);

  if (result.matched === 0) {
    throw ApiError.notFound('所选客户均不存在或已被删除');
  }
  sendSuccess(res, {
    ...result,
    requested: ids.length,
    notFound: ids.length - result.matched,
  });
});

export const bulkDeleteHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: string[] };
  const result = await bulkDelete(ids, req.user);
  if (result.deleted === 0) {
    throw ApiError.notFound('所选客户均不存在或已被删除');
  }
  sendSuccess(res, { ...result, requested: ids.length });
});

export const bulkAddTagsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids, tags } = req.body as { ids: string[]; tags: string[] };
  const result = await bulkAddTags(ids, tags, req.user);
  if (result.matched === 0) {
    throw ApiError.notFound('所选客户均不存在或已被删除');
  }
  sendSuccess(res, { ...result, requested: ids.length, notFound: ids.length - result.matched });
});

export const bulkRemoveTagsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids, tags } = req.body as { ids: string[]; tags: string[] };
  const result = await bulkRemoveTags(ids, tags, req.user);
  if (result.matched === 0) {
    throw ApiError.notFound('所选客户均不存在或已被删除');
  }
  sendSuccess(res, { ...result, requested: ids.length, notFound: ids.length - result.matched });
});

export const bulkAssignOwnerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids, ownerId } = req.body as { ids: string[]; ownerId: string | null };
  const result = await bulkAssignOwner(ids, ownerId ?? null, req.user);
  if (result.matched === 0) {
    throw ApiError.notFound('所选客户均不存在或已被删除');
  }
  sendSuccess(res, { ...result, requested: ids.length, notFound: ids.length - result.matched });
});

export const bulkSetFollowUpHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids, nextFollowUpAt } = req.body as { ids: string[]; nextFollowUpAt: Date | null };
  const result = await bulkSetFollowUp(ids, nextFollowUpAt ?? null, req.user);
  if (result.matched === 0) {
    throw ApiError.notFound('所选客户均不存在或已被删除');
  }
  sendSuccess(res, { ...result, requested: ids.length, notFound: ids.length - result.matched });
});

export const importCustomersHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ImportCustomersInput;
  const result = await importCustomers(input, req.user);
  // dryRun 返回 200 但通过 meta 标明是预检
  sendSuccess(res, result, 200, { dryRun: result.dryRun });
});

export const exportCustomersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListCustomersQuery;
  const rows = await exportCustomers(query, req.user);

  if (rows.length === 0) {
    throw ApiError.notFound('当前筛选条件下没有可导出的客户');
  }

  const buffer = buildCustomersWorkbook(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  setExcelHeaders(res, `customers-${stamp}.xlsx`, `客户列表-${stamp}.xlsx`);
  res.send(buffer);
});

export const downloadTemplateHandler = asyncHandler(async (_req: Request, res: Response) => {
  const buffer = buildImportTemplate();
  setExcelHeaders(res, 'customer-import-template.xlsx', '客户导入模板.xlsx');
  res.send(buffer);
});

export const listIndustriesHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await listIndustries(req.user);
  sendSuccess(res, data);
});

export const listTagsHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await listTags(req.user);
  sendSuccess(res, data);
});

export const listOwnersHandler = asyncHandler(async (_req: Request, res: Response) => {
  const data = await listOwners();
  sendSuccess(res, data);
});
