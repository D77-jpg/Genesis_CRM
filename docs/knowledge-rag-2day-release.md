# RAG 两天版：发布、验收与回滚

这是“安全演示 / 灰度发布”版的操作单，不是完整企业级上线。

## 发布前检查

1. `git status` 确认只包含本次改动，记录当前提交 SHA。
2. 根目录执行 `npm run typecheck`，服务端和前端都要通过。
3. 根目录执行 `npm run build`，产物为 `server/dist` 和 `web/dist`。
4. 按下面顺序跑回归，任何一项失败都不发布：

```text
cd server
npm run test:knowledge-facts
npm run test:agent
npm run test:mail
npm run test:knowledge-retrieval
npm run test:knowledge
npm run test:knowledge-workflow
npm run test:knowledge-evaluation
```

5. 测试环境固定 `AI_PROVIDER=mock`、`MAIL_CHANNEL=mock`，测试只连 MongoMemory 或独立虚构库；不得指向真实客户库，不得配置真实 SMTP。

## 发布

1. 先备份当前 `server/dist`、`web/dist` 和本次提交 SHA。
2. 替换构建产物，重启 API 和前端；本次没有数据库结构迁移。
3. 知识索引只在资料发布清单变化时重建；新代次 `ready` 后才切换，失败时继续使用原 active 代次。
4. 高风险邮件仍由业务员在现有草稿审核页逐封确认，系统不自动发送。

## 回滚

### 代码回滚

- 直接重新部署上一份 `server/dist`、`web/dist`，或按仓库流程 revert 本次提交。
- 不回滚 Mongo 业务数据，不删除审核记录和知识版本。
- 旧代码没有新的高风险发送门禁；回滚期间必须暂停发送，或保持发送功能关闭，先核对所有待发草稿。

### 索引回滚

- 管理员用已有入口回滚到上一代次：`POST /api/knowledge-index/:id/rollback`。
- 回滚前会重新核对当前发布清单、模型身份、权限和磁盘完整性。
- 已停用、已失效或被撤权的知识不会因为回滚重新变成有效依据。
- 如果没有可用旧代次，保持 `index_not_ready` / `index_stale`，不要让旧政策兜底。

## 真实发送为零

- 所有验收使用 mock 邮件通道，不建立 SMTP 连接。
- 不自动发送；测试只检查“草稿保存 / 拦截 / 模拟投递”，不产生真实邮件。
- 如误把 `MAIL_CHANNEL` 配成 `smtp`，立即停止发布，恢复 mock 后再验收。

## 已知限制

- 证据补全只做“命中窗口 + 相邻窗口 + 脚注”，不做完整父块重构。
- 历史状态超过 500 条时只检查前 500 条并显示警告，未检查部分不作为当前政策。
- 语义核验失败的兜底只保留有依据的条件答复；原模型稿不进入发送正文。
- 不包含关键词索引重构、复杂表格还原、产品软过滤、自动训练和完整 300–500 题评测。
