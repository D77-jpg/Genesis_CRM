# RAG 两天版：提交说明与验收清单

日期：2026-10-26
范围：安全演示 / 灰度发布版，不是完整五批 RAG 优化。

## 一、本次改动摘要

| 模块 | 主要内容 |
|---|---|
| 核验 | 失败不再保留模型原稿；任一引用片段对不上就整段失败；确定性安全兜底 |
| 对话检索 | 聊天工具结果并入最终核验；短追问继续检索；保留来源版本 |
| 发送门禁 | 老模型原稿、索引过期/冲突、条件超预算、无权限来源、高风险未批准均拦截 |
| 风险审核 | 复用现有草稿审核页；价格/样品/运费/付款/库存/独家/认证/合同等高风险必须人工批准；改正文后审批失效 |
| 证据补全 | 命中窗口补前后窗口；短节整节读取；长节保留末尾脚注/价格/交期条件 |
| 历史资料 | 超过 128 条只发 `diagnostic_budget` 警告；500 条内正常查询不阻断；超过只检查前 500 条并提示 |
| 审核快照 | `knowledgeForAudit` 保留窗口位置和受限来源引用；模型继续使用精简版 `knowledgeForModel` |
| 发布 | 新增 `docs/knowledge-rag-2day-release.md` |

## 二、建议提交说明

标题：

```text
feat(knowledge): 完成 RAG 两天版证据补全与发送门禁
```

正文：

```text
- 核验失败不再保留模型原稿，逐条引用不匹配即 fail closed
- 合并聊天工具证据，短追问继续检索
- 新增发送门禁：未审核高风险、过期/冲突、保留原稿一律拦截
- 检索命中补相邻窗口、短节整节、长节脚注，审核保留定位
- 历史状态超过 128 条只告警，500 条内不阻断
- 审核/核验用完整快照，模型继续用精简版
- 增加回归、发布与回滚说明
```

## 三、提交前检查

- [ ] `git status` 只包含本次 RAG 改动。
- [ ] 不把 `docs/manual/` 一起提交；它是独立的系统说明书，不属于本次代码变更。
- [ ] 检查 `git diff` 没有真实客户信息、密钥、SMTP 密码、真实邮箱。
- [ ] 服务端 `npm run typecheck` 通过。
- [ ] 前端 `npm run typecheck` 通过。
- [ ] 服务端 `npm run build` 通过。
- [ ] 前端 `npm run build` 通过。

建议提交命令（在仓库根目录执行，先用 `git status` 确认）：

```powershell
git add server/src server/semantic/retrieval.py server/tests web/src
git add docs/agent-letter-pipeline.md docs/knowledge-s3-retrieval.md
git add docs/knowledge-rag-2day-release.md docs/knowledge-rag-2day-acceptance.md
git add docs/knowledge-rag-2day-plan.docx docs/knowledge-rag-2day-plan.pdf scripts/build_rag_2day_plan.py
git status --short
git commit
git tag rag-2day-20261026
```

`git commit` 会打开编辑器，把上面的标题和正文粘贴进去。确认无误后再推送；推送前先确认远程分支和 PR 流程。

## 四、自动化验收

在 `server/` 下执行：

```text
npm run test:knowledge-facts
npm run test:agent
npm run test:mail
npm run test:knowledge-retrieval
npm run test:knowledge
npm run test:knowledge-workflow
npm run test:knowledge-evaluation
```

本次结果：

- 核验 48 项通过
- Agent 64 项通过
- 邮件 116 项通过
- 检索 17 项通过
- 知识 15 项通过
- 工作流 28 项通过
- 评测 9 项通过
- 治理 24 项、安全 5 项、索引 23 项、故障/运维 15 项、导入 14 项通过
- 合计 378 项相关回归通过

需要真实本地模型/解析器的补充检查（在 `server/` 下，使用本机 `.env`）：

```powershell
npm run test:knowledge-governance
npm run test:security
npm run test:knowledge-ingestion
node --env-file=.env --require ./tests/os-user-info.cjs --import tsx --test tests/knowledge-index.test.ts
node --env-file=.env --require ./tests/os-user-info.cjs --import tsx --test tests/knowledge-operations.test.ts
```

## 五、人工验收流程（只用 mock，不发真实邮件）

1. 确认 `AI_PROVIDER=mock`、`MAIL_CHANNEL=mock`，不要配置真实 SMTP。
2. 发布一条带价格/交期/脚注的虚构知识，生成一封涉及价格或交期的草稿。
3. 不点审核，直接尝试发送：应被拦截，提示高风险内容未人工批准。
4. 点现有审核页的“审核通过”，再发送：只应产生 mock 记录，不能出现真实投递。
5. 审核通过后修改正文，再发送：审批应失效，必须重新审核。
6. 把知识改成过期/冲突/索引未就绪，再发送：应被拦截。
7. 在聊天里先问产品问题，再追问“那这个呢？”：最终审核应能看到两次检索的来源。
8. 查看草稿的引用详情：应能定位到具体窗口/段落，而不是只有标题。

验收签字：

- [ ] 业务验收：高风险未批不能发；审核后可发；改正文后重新审核
- [ ] 技术验收：typecheck/build/回归通过；无真实 SMTP
- [ ] 发布验收：上一版构建已备份；回滚步骤已确认

## 六、回滚

按 `docs/knowledge-rag-2day-release.md` 执行：

- 代码：重新部署上一份 `dist` 或 revert 本次提交。
- 索引：使用现有 `POST /api/knowledge-index/:id/rollback`。
- 数据：不回滚 Mongo 业务数据；旧代码没有新发送门禁，回滚期间必须停发。
- 真实发送：保持 0；任何 SMTP 误配置立即停止发布。
