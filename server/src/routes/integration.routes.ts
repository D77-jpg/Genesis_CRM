/**
 * Integration API v1 路由
 * ------------------------------------------------------------------
 * 挂载于 /api/integrations/v1（见 routes/index.ts）。
 * 全部端点：requireServiceToken → requireIntegrationProject → requireScope → handler。
 * 契约：docs/integration/integration-v1.openapi.yaml
 */
import { Router } from 'express';
import { validate } from '../middleware/validate.middleware';
import {
  integrationAuditLog,
  requireIntegrationProject,
  requireScope,
  requireServiceToken,
} from '../middleware/service-token.middleware';
import {
  customerQuotationsHandler,
  customerStatusHandler,
  healthHandler,
  outcomesHandler,
  statsOverviewHandler,
  upsertCustomerHandler,
} from '../controllers/integration.controller';
import {
  externalRefParams,
  outcomesQuery,
  upsertCustomerBody,
} from '../validators/integration.validator';

const router = Router();

// 全部集成端点：审计先行（认证失败也要留痕）→ 服务凭证认证 → 显式项目绑定
router.use(integrationAuditLog, requireServiceToken, requireIntegrationProject);

router.get('/health', healthHandler);

router.post(
  '/customers/upsert',
  requireScope('customers:upsert'),
  validate({ body: upsertCustomerBody }),
  upsertCustomerHandler,
);

router.get(
  '/outcomes',
  requireScope('outcomes:read'),
  validate({ query: outcomesQuery }),
  outcomesHandler,
);

router.get('/stats/overview', requireScope('stats:read'), statsOverviewHandler);

// 阶段 5.2 预留只读（注意：必须位于 /customers/upsert 之后，避免 :externalRef 抢占）
router.get(
  '/customers/:externalRef',
  requireScope('customers:upsert'),
  validate({ params: externalRefParams }),
  customerStatusHandler,
);

router.get(
  '/customers/:externalRef/quotations',
  requireScope('quotations:read'),
  validate({ params: externalRefParams }),
  customerQuotationsHandler,
);

export default router;
