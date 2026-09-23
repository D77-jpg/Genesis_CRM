# Genesis Integration API v1

> 阶段 2 Wave A/B 交付。基线：`codex/agent-v1-4-hardening@356a21d`，开发分支 `feat/integration-api-v1`。

## 这是什么

Genesis_CRM 对外集成接口，供 AutoForceAI 等获客系统以**服务凭证**接入：
线索交接（幂等 upsert）、成交/流失回流（游标 feed）、门户摘要（stats），
以及阶段 5.2 预留的客户状态 / 报价只读查询。

**权威契约：[`integration-v1.openapi.yaml`](./integration-v1.openapi.yaml)**。
v1 内只允许向后兼容地新增可选字段；删除/改名/改变语义必须发布 v2。

## 快速开始（本地联调）

```bash
cd server
npm run dev                                          # 启动 CRM API（:5000）
npm run integration:credential -- create \
  --name "AutoForceAI 本地" --project default        # 签发凭证；token 只显示一次
npm run integration:credential -- list               # 查看凭证（脱敏）
npm run integration:credential -- rotate --id <id>   # 轮换（旧 token 立即失效）
npm run integration:credential -- revoke --id <id>   # 撤销
```

调用约定：

```
Authorization: Bearer gci_...
X-Project-Id: <24 位项目 ObjectId>     # 必填，且必须在凭证绑定集合内（无默认项目回退）
Idempotency-Key: <1-128 字符>          # 写端点必填；重试必须复用原键
```

## 端点一览

| 方法与路径 | scope | 用途 |
|---|---|---|
| `GET /api/integrations/v1/health` | 任意有效凭证 | 校验契约版本 / 凭证 / 项目绑定 / scope |
| `POST /api/integrations/v1/customers/upsert` | `customers:upsert` | 幂等创建/关联客户（`created`/`linked`/`unchanged`） |
| `GET /api/integrations/v1/outcomes?cursor=&limit=` | `outcomes:read` | 游标式增量读取 won/lost 事件 |
| `GET /api/integrations/v1/stats/overview` | `stats:read` | 客户总数 / 8 段漏斗 / 报价状态摘要 |
| `GET /api/integrations/v1/customers/{externalRef}` | `customers:upsert` | （5.2 预留）客户状态查询 |
| `GET /api/integrations/v1/customers/{externalRef}/quotations` | `quotations:read` | （5.2 预留）报价状态查询 |

## 幂等与一致性

- 业务唯一键：`(projectId, sourceSystem, externalId)`（Customer partial unique 索引）。
- 请求幂等键：`IntegrationIdempotency`（同键同载荷重放首次响应；同键不同载荷 409）。
- 邮箱只是「可能重复」的辅助匹配：同项目邮箱已存在时建立外部引用并返回 `linked`。
- 更新边界：已关联客户的后续同步只补齐空字段，不覆盖销售人工维护字段。

## 审计与安全

- 每次请求落 `IntegrationRequestLog`：requestId / 凭证 / 项目 / 路由 / 状态码 / 错误码 / 耗时；
  **绝不记录 token、请求体全文、询盘内容**。响应携带 `X-Request-Id` 供两端对账。
- 凭证只存 SHA-256 哈希；支持过期、撤销、轮换；与用户 JWT 体系完全隔离。

## 测试

```bash
npm run test:integration   # node:test + mongodb-memory-server，13 个用例
```

覆盖：认证/scope/项目隔离错误码、幂等键重放与冲突、并发 10 次只产生 1 个客户、
邮箱 linked、游标增量推进、审计日志不含敏感内容。
