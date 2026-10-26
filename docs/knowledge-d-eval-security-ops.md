# D：评测、安全、运维

本批只使用虚构知识、虚构客户和本地/隔离环境。不声称生产上线、真实邮件质量或企业级多机高可用已完成。

## 结论

D 把“能否稳定运行、能否被发现、出事能否恢复”变成可执行的门禁：

- **评测**：冻结的 120 题人类标注集继续作为质量门禁；新增安全、健康/就绪和运维回归，不使用合成题冒充质量提升。
- **安全**：新增公开探针的最小信息暴露约束；保留既有项目/角色/版本/上传/提示注入/密钥/日志边界，训练数据仅管理员可见。
- **运维**：新增 liveness、readiness 和带主动 Mongo ping 的 health；新增进程指标、就绪时的 draining 状态和运维手册。

## D1 评测

最终本地门禁（真实本地 Embedding/Rerank，隔离临时 Mongo/SQLite，不调用 LLM、不发送邮件）：

| 指标 | 结果 |
|---|---|
| 用例 | 120（80 有答案 / 40 负例） |
| Recall@10 | **1.000** |
| MRR@10 | **0.98125** |
| 分类准确率 | **1.000** |
| 负向状态准确率 | **1.000** |
| 越权/禁止命中 | **0** |
| 非预期错误 | **0** |
| P50 / P95 / 最大 | **204.98 / 251.05 / 2480.22 ms** |
| dev（60） | Recall 1.000，MRR 0.975，负向 1.000 |
| holdout（60） | Recall 1.000，MRR 0.9875，负向 1.000 |

门禁：`recall≥0.9`、`negativeStateAccuracy≥0.95`、`forbiddenHits=0`、`unexpectedErrors=0`，全部通过。摘要见 [retrieval-summary.json](knowledge-d-results/retrieval-summary.json)。

### 为什么不拿 300 道合成题充数

现有 50 条语料只有 66 个 clause。把同一个 clause 自动改写成多道题，只能测“检索是否能找到自己”，不能代表真实客户语言、跨产品和冲突场景，也不能作为质量提升证据。D 保留 120 条冻结题作为质量门禁；扩充到 300–500 条必须先补新的、有业务审核的语料和标注，不能在本批伪称完成。安全/运维回归另行增加，不与质量题混算。

回归结果（本轮本地）：

- `test:security`：5/5
- `test:health`：5/5
- `test:knowledge-training`：7/7
- `test:knowledge-operations`：15/15（带本地组件环境）
- `test:mail`：116/116
- `test:knowledge-retrieval`：18/18
- `test:knowledge-facts`：48/48
- `test:knowledge-governance`：24/24
- `test:knowledge-evaluation`：9/9

## D2 安全

### 探针不成为泄漏面

新增的公开探针不返回连接串、JWT、管理员密码、模型目录、路径、异常栈或 Mongo 错误。只返回固定字段：

- `GET /api/health/live`：进程是否存活；不查数据库；
- `GET /api/health/ready`：Mongo 主动 ping + 是否正在 draining；只返回 `ok/unavailable`；
- `GET /api/health`：兼容旧监控，追加 `checks` 和进程内存/uptime。

公开探针不需要登录，但不返回任何项目/客户/知识内容；速率限制和访问日志均跳过 `/api/health*`，避免探针刷日志或误触发全局限流。

### 既有边界继续有效

| 边界 | 机制 |
|---|---|
| 身份与项目 | JWT + 每请求项目/角色重核；跨项目 ID 不泄露是否存在 |
| 知识权限 | 只检索当前发布清单中当前用户可见的条目；产品标签不是授权 |
| 管理操作 | 发布、停用、批量停用、训练开关、原文下载均为管理员 |
| 训练数据 | 只保存在本项目；概况/预览/开关仅管理员；删除客户/草稿同步清理样本 |
| 输入 | zod strict；JSON 25MB；上传大小/类型/签名/路径校验；解压、宏、外链拒绝 |
| 提示注入 | 检索内容是证据而非指令；模型不能选择任意项目/工具；最终核验与发送门禁独立 |
| 密钥 | 生产拒绝弱/默认/共享密钥；CI secret scan；日志不含凭据 |
| 输出 | HTML 清洗、追踪 URL 校验、未审核高风险承诺禁止发送 |
| 异常 | 固定错误码/状态；不把供应商原始错误或凭据写日志 |

安全归回的边界：没有第三方渗透测试，没有 Windows AppContainer/独立低权限账户级原生沙箱，也不是“任意恶意文档绝对安全”。高风险价格、交期、认证和客户专属条件仍由人确认。

## D3 运维

### 探针语义

| 探针 | 用途 | 失败动作 |
|---|---|---|
| `/api/health/live` | 进程是否活着 | 重启实例；不要因 Mongo 慢查询误杀 |
| `/api/health/ready` | 能否接业务流量 | 从负载均衡摘除；先排查 Mongo/ draining，不立即重启 |
| `/api/health` | 兼容旧监控、人工查看 | 503 表示数据库不可用或正在停机 |

### 监控与告警建议

管理员 `GET /api/knowledge-index/operations` 返回近 7 天解析、任务、草稿审核、引用、索引和组件状态，并新增 `process` 和 `mongo` 字段；不返回正文、邮件、查询文本或文档路径。

建议阈值（需按真实基线调整，不是已配置的自动分页）：

- `ready=503` 持续 1 分钟：P1；
- `/health` 的数据库 ping 连续失败：P1；
- 解析/语义组件 `circuitOpen=true` 或模型传输 `openCircuits>0`：P2，先限流/暂停重试；
- 最新索引代次 `failed`、`activeGeneration` 缺失或明显落后发布清单：P2，保留旧代次并人工确认；
- 进程 RSS 持续 >1.2 GiB、语义队列长期满、任务积压增长：容量告警；
- `no_match`/`retrieval_failed` 突增：先核对发布清单和索引代次，不要直接改阈值。

### 发布、回滚、备份

- 发布：`npm run typecheck && npm run build` → 保留上一份 `server/dist`、`web/dist` → 替换并重启 → 等 `/ready` 200 → 跑 smoke。
- 索引：修改检索源码会改变 `embeddingIdentity()`，需管理员重建一次；旧代次保持可用，新代次 ready 后切换，失败继续旧代次。
- 回滚：代码回滚重新部署上一份构建；索引回滚用既有 `POST /api/knowledge-index/:id/rollback`，重新核对发布清单/模型/权限/磁盘完整性；旧知识停用后不能因回滚重新生效。
- 停机：SIGTERM 后进程进入 draining，`/ready` 变 503，停止接收业务流量，保留 10 秒收尾；强杀留下的任务租约按既有恢复协议处理。
- 备份：现有 S7 加密快照/恢复只在 `s7_fictional_*` 隔离库验证，不是生产恢复按钮。生产必须另行准备停写/副本集一致性快照、独立加密介质、保留策略和真实目标空库演练。

### 已知边界

- 单机 Node + 单机 SQLite/本地模型进程；没有多实例共享索引、跨机滚动升级或 HA，不能把本机探针当成集群健康。
- 没有配置真实域名/TLS/凭据轮换/生产 SMTP；本批验证不代表真实客户邮件送达。
- 备份恢复、真实模型质量和第三方渗透仍需上线前独立演练。

## 验收命令

```powershell
cd server
npx tsc --noEmit -p tsconfig.json
npm run test:security
npm run test:health
npm run test:knowledge-training
node --env-file=.env --require ./tests/os-user-info.cjs --import tsx --test tests/knowledge-operations.test.ts
npm run test:mail
npm run test:knowledge-retrieval
npm run test:knowledge-facts
npm run test:knowledge-governance
npm run test:knowledge-evaluation

# 冻结质量门禁（真实本地模型，隔离库）
node --env-file=.env --require ./tests/os-user-info.cjs --import tsx evaluation\knowledge\retrieval.ts --mode=hybrid_rerank --split=all --enforce-gates --output=..\server\tmp\d-final.json

cd ..\web
npm run typecheck
npm run build
```

CI `integration-release-gate` 已加入 security/health 测试和严格类型检查；本地通过不等于远端 CI 已通过，PR 创建后需以实际 Actions 结果为准。
