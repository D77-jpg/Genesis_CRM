import type { RequestHandler } from 'express';
import { IntegrationRateLimit } from '../models/IntegrationPublicResource';
import { runWithTenant } from '../models/tenant-context';
import { ApiError } from '../utils/ApiError';

export const integrationCredentialLimit: RequestHandler = async (req, res, next) => {
  try {
    if (!req.integration) throw ApiError.unauthorized();
    const credentialId = req.integration.credentialId;
    const window = Math.floor(Date.now() / 60_000);
    const filter = { credentialId, window };
    await runWithTenant({ bypass: true, source: 'integration-counter' }, async () => {
      // Two-step create/increment avoids an unbounded overflow counter and tolerates
      // concurrent first requests. The unique index is installed before deployment.
      try {
        await IntegrationRateLimit.updateOne(filter, { $setOnInsert: {
          ...filter, count: 0, expiresAt: new Date((window + 2) * 60_000),
        } }, { upsert: true });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      const used = await IntegrationRateLimit.findOneAndUpdate(
        { ...filter, count: { $lt: 120 } }, { $inc: { count: 1 } }, { new: true },
      );
      if (!used) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(((window + 1) * 60_000 - Date.now()) / 1000))));
        throw ApiError.tooManyRequests();
      }
    });
    next();
  } catch (error) { next(error); }
};
