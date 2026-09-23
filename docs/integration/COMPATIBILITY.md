# 阶段 2 兼容性记录（Genesis_CRM 侧）

> Integration API v1 已冻结。本文件与 AutoForceAI 侧 `docs/integration/COMPATIBILITY.md` 互为镜像，
> 是 CI 门禁检查项；契约变更必须先解冻流程并同步两端记录。

## 冻结契约

- 契约文件：`docs/integration/integration-v1.openapi.yaml`
- 契约版本：**1.0**
- 契约 SHA-256：`7798eb621795e8dc405ff56c0fdfb806622ec5a6144d85d6e839ee85d9061679`

## 双方实现基线（不可变 commit，CI 门禁校验）

| 仓库 | 实现基线 commit | 内容 |
|---|---|---|
| Genesis_CRM | `e2e3486` | Integration API v1 冻结实现（13/13 契约测试） |
| AutoForceAI | `491b1d3` | 阶段 2 核心：Wave A–D + 2.9 五项 P0 + §3.6 worker 租约（发布分支 `codex/phase2-release-ready` 上） |

> CI/文档提交不属于 API 实现基线；基线只记录契约实现 commit，不随门禁提交变化。

## 待创建的正式标签（推送验收通过后由人工创建）

- Genesis_CRM：`genesis-integration-v1.0.0` → 打在 `e2e3486`
- AutoForceAI：`autoforce-phase2-core-v1.0.0` → 打在 `491b1d3`

## 对端（AutoForceAI）

- 发布分支：`codex/phase2-release-ready`
- 必需 scope（阶段 2 核心）：`customers:upsert, outcomes:read, stats:read`
  （`quotations:read` 预留给阶段 4.3，签发凭证时按需追加）
- 凭证管理：`server/` 下 `npm run integration:credential -- create|list|rotate|revoke`
- 运维手册：见 AutoForceAI `docs/PHASE2_OPS_RUNBOOK.md`
