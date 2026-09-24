/**
 * Integration API v1 控制器
 */
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { INTEGRATION_CONTRACT_VERSION } from '../constants';
import { renderIntegrationQuotationPdf } from '../services/quotation-pdf.service';
import {
  createQuotationDraft,
  getIntegrationQuotation,
  getCustomerQuotationsByExternalRef,
  getCustomerStatusByExternalRef,
  getIntegrationStats,
  listOutcomes,
  upsertCustomer,
} from '../services/integration.service';
import type {
  CreateQuotationDraftBody,
  OutcomesQuery,
  UpsertCustomerBody,
} from '../validators/integration.validator';

function requireIntegration(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) {
  if (!req.integration || !req.project) throw ApiError.unauthorized('缺少服务凭证或项目上下文');
  return { integration: req.integration, project: req.project };
}

/** GET /health —— 校验契约版本、凭证、项目绑定与 scope */
export const healthHandler = asyncHandler(async (req, res) => {
  const { integration, project } = requireIntegration(req);
  sendSuccess(res, {
    ok: true,
    contractVersion: INTEGRATION_CONTRACT_VERSION,
    capabilities: ['quotation-draft.v1'],
    serverTime: new Date().toISOString(),
    projectId: project.id,
    projectName: project.name,
    scopes: integration.scopes,
    credentialId: integration.credentialId,
  });
});

/** POST /customers/upsert —— 幂等创建/关联客户（需要 Idempotency-Key） */
export const upsertCustomerHandler = asyncHandler(async (req, res) => {
  const { integration, project } = requireIntegration(req);
  const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw ApiError.badRequest('缺少或非法的 Idempotency-Key 请求头（1-128 字符）');
  }

  const { result, statusCode } = await upsertCustomer({
    credentialId: integration.credentialId,
    projectId: project.id,
    idempotencyKey,
    body: req.body as UpsertCustomerBody,
  });
  sendSuccess(res, result, statusCode);
});

/** GET /outcomes —— 游标式增量读取成交/流失事件 */
export const outcomesHandler = asyncHandler(async (req, res) => {
  const { project } = requireIntegration(req);
  const query = req.query as unknown as OutcomesQuery;
  const feed = await listOutcomes({ projectId: project.id, cursor: query.cursor, limit: query.limit });
  sendSuccess(res, feed);
});

/** GET /stats/overview —— 集成门户摘要 */
export const statsOverviewHandler = asyncHandler(async (req, res) => {
  const { project } = requireIntegration(req);
  sendSuccess(res, await getIntegrationStats(project.id));
});

/** GET /customers/:externalRef —— 5.2 预留：客户状态查询 */
export const customerStatusHandler = asyncHandler(async (req, res) => {
  const { project } = requireIntegration(req);
  sendSuccess(
    res,
    await getCustomerStatusByExternalRef({
      projectId: project.id,
      externalRef: req.params.externalRef,
      sourceSystem: typeof req.query.sourceSystem === 'string' ? req.query.sourceSystem : undefined,
    }),
  );
});

/** GET /customers/:externalRef/quotations —— 5.2 预留：报价状态查询 */
export const customerQuotationsHandler = asyncHandler(async (req, res) => {
  const { project } = requireIntegration(req);
  sendSuccess(
    res,
    await getCustomerQuotationsByExternalRef({
      projectId: project.id,
      externalRef: req.params.externalRef,
      sourceSystem: typeof req.query.sourceSystem === 'string' ? req.query.sourceSystem : undefined,
    }),
  );
});

/** POST /customers/:externalRef/quotation-drafts —— 人工确认后创建正式草稿 */
export const createQuotationDraftHandler = asyncHandler(async (req, res) => {
  const { integration, project } = requireIntegration(req);
  const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw ApiError.badRequest('缺少或非法的 Idempotency-Key 请求头（8-128 字符）');
  }

  const { result, statusCode } = await createQuotationDraft({
    credentialId: integration.credentialId,
    projectId: project.id,
    externalRef: req.params.externalRef,
    idempotencyKey,
    body: req.body as CreateQuotationDraftBody,
  });
  sendSuccess(res, result, statusCode);
});

/** GET /quotations/:quotationId —— 项目内报价权威详情 */
export const integrationQuotationHandler = asyncHandler(async (req, res) => {
  const { project } = requireIntegration(req);
  sendSuccess(
    res,
    await getIntegrationQuotation({
      projectId: project.id,
      quotationId: req.params.quotationId,
    }),
  );
});

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const target = etag.replace(/^W\//, '');
  return ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value.replace(/^W\//, '') === target);
}

/** GET /quotations/:quotationId/pdf —— 下载 Genesis 权威报价 PDF */
export const integrationQuotationPdfHandler = asyncHandler(async (req, res) => {
  const { project } = requireIntegration(req);
  const pdf = await renderIntegrationQuotationPdf({
    projectId: project.id,
    quotationId: req.params.quotationId,
  });

  res.setHeader('ETag', pdf.etag);
  res.setHeader('X-Quotation-Version', String(pdf.version));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  if (etagMatches(req.headers['if-none-match'], pdf.etag)) {
    res.status(304).end();
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${pdf.asciiFilename}"; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
  );
  res.setHeader('Content-Length', String(pdf.buffer.length));
  res.status(200).send(pdf.buffer);
});
