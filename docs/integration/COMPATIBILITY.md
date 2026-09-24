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

## 正式标签（合并完成、远程门禁全绿后由人工创建）

实现基线用于契约追踪；正式标签用于复现「最终通过远程门禁的完整发布状态」，两者不同：

- Genesis_CRM：`genesis-integration-v1.0.0` → 指向合并后 `main` 上包含 Integration API、测试修复、CI 门禁与兼容性记录的最终 release commit（**不**固定到 `e2e3486`）
- AutoForceAI：`autoforce-phase2-core-v1.0.0` → 指向合并后 `main` 上包含阶段 2 核心、worker 保护、migration、运维手册与 CI 门禁的最终 release commit（**不**固定到 `491b1d3`）

## 对端（AutoForceAI）

- 发布分支：`codex/phase2-release-ready`
- 必需 scope（阶段 2 核心）：`customers:upsert, outcomes:read, stats:read`
- 阶段 4 报价草稿：`quotations:draft, quotations:read`（按需最小权限签发）
- 凭证管理：`server/` 下 `npm run integration:credential -- create|list|rotate|revoke`
- 运维手册：见 AutoForceAI `docs/PHASE2_OPS_RUNBOOK.md`

## 向后兼容扩展：quotation-draft.v1

- 契约文件：`docs/integration/quotation-draft-v1.1.openapi.yaml`
- 能力标识：`quotation-draft.v1`
- 契约 SHA-256：`c2b7921dfe076dd1748ca220a2435de26eabc05161264f01514c4a5def397e33`
- 基础 `contractVersion: 1.0` 与基础契约哈希保持不变
- Wave A 已实现：报价草稿幂等创建、权威金额重算、报价详情查询
- Wave B 待实现：服务端 PDF、稳定 ETag 与 draft 水印
