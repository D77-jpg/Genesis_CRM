# B3–B7：多依据召回、产品软过滤、表格还原、引用定位与历史状态发现

本报告只使用虚构资料、虚构客户和本地模型，不含真实客户数据、真实报价或真实邮件。验收目标是工程可复现，不是宣称生产业务准确率。

## 结论

B3–B7 已完成实现并通过本轮自动化检查：

| 批次 | 交付 | 验收结果 |
|---|---|---|
| B3 多问题、多依据召回 | 按子问题独立向量/BM25 分支，RRF 合并；多问题保留每个子问题的前 3 个分支 leader；查询预算不截断 | 虚构检索集 120 例 `recall@10 = 1.000`、`MRR@10 = 0.981`；新增多问题用例两个来源均进入结果 |
| B4 产品软过滤 | 产品标签改为相关性提示：匹配产品优先排序，最终来源守卫拒绝未命中的产品专属资料；无产品标签的项目通用资料仍可用 | 跨产品/通用查询用例通过；不相关 sibling product 不进入答案 |
| B5 表格还原 | Markdown 行级表格元数据；DOCX `gridSpan`/`vMerge` 展开；XLSX 合并单元格回填、表头/脚注、行号；所有表格行保留表头上下文 | 解析/收录测试 15/15 通过；新增合并单元格价格夹具验证 9.99、4.50、4.80 三行不丢失 |
| B6 引用定位 | PDF 页码、Markdown 表格行、Word 表格行/段落、Sheet/CSV 行均输出位置；引用链接携带 `chunk`，管理审核页打开精确解析片段 | `draftEvidence` 保留 `originalUrl` 的 `chunk`；`sourceLocation` 覆盖页/表/行/段；审核页按 `chunk` 打开定位对话框 |
| B7 历史资料标题元数据补全 | 诊断检索使用 `title + 正文前 800 字` 的 `searchText`；正文才出现的旧政策可被状态发现；明确“草稿/未发布/加急生产”意图时补诊断 | 状态负例 `negativeStateAccuracy = 1.000`；正文才出现的旧资料可返回 disabled 诊断且不泄漏正文 |

## B3–B4：检索链路

### B3 实现

`server/semantic/retrieval.py` 的 `retrieve()` 现在：

1. 将查询按问号、换行、`and what/which/how...`、`以及`、`并且` 切成子问题；每个子问题独立做向量召回和 BM25，保留各自的分数与名次。
2. 各子问题分支分别按发布版本去重后进入 RRF；同一发布版本的多个子问题贡献可以累加。
3. 多问题查询记录每个分支的前 3 个 leader；当 reranker 对某个子问题 leader 打分不足时，保留其进入候选集的覆盖名额，但最终仍受项目/角色/产品守卫约束。
4. 精确型号锚点只拒绝同一前缀的竞争型号，避免把无关证书编号误判成替代型号。

这不是“放宽所有阈值”：单问题查询仍沿用原 rerank/向量阈值；多问题 leader 只是覆盖下限。

### B4 实现

`server/src/services/knowledge/index.service.ts` 不再在 Mongo 查询阶段硬删产品不匹配的资料：

- `visibleRows` 先做权限/发布版本检查；
- `productMatchedRows` 只用于把匹配产品排在前面；
- `productEligibleRows` 保留无产品标签的项目通用资料，以及明确命中产品的资料；
- 最终来源守卫只允许 `explicit` 明确选择或 `productEligibleIds` 内的来源，避免 sibling product 的价格/交期混入；
- 产品标签从来不是授权边界，项目/角色 ACL 仍在最前面。

## B5：表格还原

`server/parsers/knowledge_parser.py`：

- Markdown 表格每行输出 `location.kind = "table"`、`table`、`row`、`line`，并在 `table` 中保留 header/row/notes 元数据。
- DOCX 读取 `w:gridSpan` 和 `w:vMerge`，将横向合并值展开到视觉列、将纵向合并值延续到后续行；识别单行合并标题，保留表头或两级表头；相邻脚注段落附加到每一行；记录 `mergedCells` 的 `rowSpan/colSpan`。
- XLSX 读取 `mergeCells`，把合并区域左上角值回填到每个被合并单元格；保留表头范围、行范围、脚注和 `mergedCells`；CSV 行号使用真实记录行。
- 表格行仍以“表头 + 当前行 + 脚注”的完整上下文进入解析片段，避免价格/交期行脱离条件。

专项夹具 `merged.docx` 验证：合并标题、横向合并表头、纵向合并产品名，价格 9.99/4.50/4.80 均保留且每行带表头。

### 已知边界

- PDF 仍按整页原子保留（页码、OCR 行、置信度）；不把 PDF 的视觉表格强行推断成列，以避免跨页/脚注错配。需要行级价格/交期承诺的 PDF 应在审核时核对原页或另建交易政策。
- Word/Excel 的多级表头采用可解释的启发式识别（整行合并标题、分组表头）；复杂嵌套表头仍需审核页人工核对，解析结果会显示表格警告。
- 表格行进入索引时可能被 tokenizer 合并为窗口；每条 `sourceRefs` 仍保留原始行 chunk，引用定位使用原始 chunk，不依赖窗口边界。

## B6：引用定位

- `server/src/services/agent/knowledge-governance.ts` 的证据快照保留每个原始 chunk 的 `chunkId`、`location`、`headingPath`，管理员 `originalUrl` 包含 `document`、`revision`、`chunk`。
- `web/src/components/agent/knowledge-citation.tsx` 的 `sourceLocation()` 支持：
  - PDF：页码（OCR 标记）；
  - Markdown 表格：表格编号 + 数据行 + 源文件行；
  - Word：表格编号 + 行号 + 跨行数，或段落号；
  - Sheet/CSV：工作表 + 范围 + 真实行号；
  - 发布条款：条款序号。
- 管理审核页 `KnowledgeAdmin` 读取 `?chunk=`，调用受权限保护的 `GET /knowledge-documents/:id?chunk=...&revision=...`，打开该解析片段对话框；不再只打开整篇 collection 预览。
- 检索结果页的“查看关联原文”同时携带 `revision` 和 `chunk`。

销售角色仍只看到已发布快照/摘要，不返回未发布邻居正文；原始文件链接只给管理员。

## B7：历史资料标题元数据

- `diagnosticMetadata()` 的 `searchText` 取标题加不可变 revision 正文前 800 字，仅用于服务端诊断匹配，不把正文作为当前来源返回。
- 标题为 `Archive`/`Old policy` 等泛化标题时，正文中的政策词仍可发现 disabled/expired/draft 状态。
- 查询含 `未发布/未公開/草稿/草拟/加急生产/unpublished/draft/...` 时，即使没有词面重叠也补一条 `draft_only` 诊断，便于业务员知道“资料存在但未发布”。
- 历史过期诊断保留为 warning，但如果已有当前有效来源，回答状态仍为 `ready`，不会把当前问题误判成整体过期；现有 `S3 12` 回归用例覆盖。

## 本轮验收命令与结果

```powershell
# 服务端
cd server
npx tsc --noEmit -p tsconfig.json
npm run test:knowledge-ingestion
npm run test:knowledge-retrieval
npm run test:knowledge-governance
npm run test:knowledge-facts

# 检索质量（虚构评测集，真实本地模型）
node --env-file=.env --require ./tests/os-user-info.cjs --import tsx evaluation\knowledge\retrieval.ts --mode=hybrid_rerank --split=all --output=..\server\tmp\b3-b7-final2.json

# Web
npm run typecheck --prefix web
npm run build --prefix web
```

结果：

- `knowledge-ingestion`：15/15 通过。
- `knowledge-retrieval`：18/18 通过。
- `knowledge-governance`：24/24 通过。
- `knowledge-facts`：48/48 通过。
- Web typecheck/build：通过。
- 检索评测 120 例（80 answerable / 40 negative）：
  - `recallAt10 = 1.000`
  - `mrrAt10 = 0.98125`
  - `classificationAccuracy = 1.000`
  - `negativeStateAccuracy = 1.000`
  - `forbiddenHits = 0`
  - `unexpectedErrors = []`
  - 延迟 P50 **172.85 ms**、P95 **210.32 ms**、最大 **2448.03 ms**（本机、热查询、隔离 fixture，不含 LLM/邮件）
- 评测 JSON 摘要见 `docs/knowledge-b3-b7-results/retrieval-summary.json`。

## 上线边界

- B3/B4/B7 是运行时逻辑变化，不需要数据迁移；B7 依赖既有 revision 正文。
- B5 只影响重新解析/新收录的资料；**旧文件要获得修正后的合并单元格/行级位置，需要管理员重新解析并重新发布**。旧索引不会被静默改写。
- B6 无需索引重建；旧 sourceRefs 若没有 `chunkId` 仍只能显示已发布正文，不能伪造位置。
- 不自动发送真实邮件；高风险价格、交期、认证和客户专属条件仍需人工审核。
- 评测为虚构集，不代表真实客户分布；上线后应继续用人工复核样本监控 recall、negative state 和引用可打开率。
