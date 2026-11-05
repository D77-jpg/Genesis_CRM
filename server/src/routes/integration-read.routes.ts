import type { Router } from 'express';
import { requireScope } from '../middleware/service-token.middleware';
import { integrationCredentialLimit } from '../middleware/integration-limit.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/pagination';
import { getIntegrationImage, getIntegrationProduct, listIntegrationRead } from '../services/integration-read.service';
import { readFeedQuery, readImageParams, readImageQuery, readProductParams, type ReadFeedQuery } from '../validators/integration-read.validator';

export function installIntegrationReadRoutes(router: Router): void {
  const context = (req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) => {
    if (!req.integration || !req.project) throw ApiError.unauthorized();
    return { credentialId: req.integration.credentialId, projectId: req.project.id };
  };
  for (const [path, scope, kind] of [
    ['/products', 'products:read', 'product'], ['/company-profile', 'company:read', 'company'],
    ['/playbook', 'playbook:read', 'playbook'], ['/knowledge/summaries', 'knowledge:read', 'knowledge'],
  ] as const) {
    router.get(path, requireScope(scope), integrationCredentialLimit, validate({ query: readFeedQuery }), asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      sendSuccess(res, await listIntegrationRead(kind, context(req), req.query as unknown as ReadFeedQuery));
    }));
  }
  router.get('/products/:id', requireScope('products:read'), integrationCredentialLimit,
    validate({ params: readProductParams }), asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      sendSuccess(res, await getIntegrationProduct(context(req), req.params.id));
    }));
  router.get('/products/:id/images/:imageId', requireScope('products:read'), integrationCredentialLimit,
    validate({ params: readImageParams, query: readImageQuery }), asyncHandler(async (req, res) => {
      const q = req.query as unknown as { expires: number; signature: string };
      const image = await getIntegrationImage(context(req), req.params.id, req.params.imageId, q.expires, q.signature);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'attachment');
      res.type(image.mime).send(image.buffer);
    }));
}
