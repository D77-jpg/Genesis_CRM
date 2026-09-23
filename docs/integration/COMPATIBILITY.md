# 阶段 2 兼容性记录（Genesis_CRM 侧）

> Integration API v1 已冻结。本文件与 AutoForceAI 侧 `docs/integration/COMPATIBILITY.md` 互为镜像，
> 是 CI 门禁检查项；契约变更必须先解冻流程并同步两端记录。

## 冻结契约

- 契约文件：`docs/integration/integration-v1.openapi.yaml`
- 契约版本：**1.0**
- 契约 SHA-256：`7798eb621795e8dc405ff56c0fdfb806622ec5a6144d85d6e839ee85d9061679`
- 冻结实现基线：`feat/integration-api-v1 @ e2e3486`（13/13 契约测试）

## 对端（AutoForceAI）

- 发布分支：`codex/phase2-release-ready`
- 必需 scope（阶段 2 核心）：`customers:upsert, outcomes:read, stats:read`
  （`quotations:read` 预留给阶段 4.3，签发凭证时按需追加）
- 凭证管理：`server/` 下 `npm run integration:credential -- create|list|rotate|revoke`
- 运维手册：见 AutoForceAI `docs/PHASE2_OPS_RUNBOOK.md`
