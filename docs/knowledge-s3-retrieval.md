# S3：自研混合检索、完整依据与质量验收

基线：S2 已合入 main `0021b59`（PR #33）。分支 `codex/knowledge-s3-retrieval`。不接入外部知识库/Agent 平台；真实资料本地处理，独立虚构数据验收，不发真实邮件，不发布原有 82 条草稿。

## ADR-003：检索窗口与事实依据分离

原始文档、S1 解析片段和已审核发布版本不覆盖、不改号。`KnowledgeIndexItem` 从 S2 的完整原子输入改为派生检索窗口：真实 tokenizer 校验每窗不超过 128 token，重叠保留所有 Unicode codepoint，包含明确的父发布版本、内容哈希与位置。表格/政策被窗口切开仅用于寻找父来源；窗口标记 `standaloneFact=false`，不能单独用来形成承诺。

命中后恢复**完整发布正文、产品适用、结构化条件和脚注**，并记录所有相关窗口及原文关联。不能只把包含 MOQ 数字而缺少后文条件的一窗传给销售 Agent；S1 关联原文与人工编辑后的发布正文位置仍严格区分。原文下载/查看继续经过现有权限。

长问题按标点、受控连接词及 tokenizer 窗口拆解，不让 LLM 重写事实或遵循来信中的指令。单次最多 16 个查询窗；一条索引原子最多 128 窗；全项目最多 50000 窗。超过预算明确失败，不截断或假装查无资料。这处理了常规长资料，模型本身仍为 128 token 窗口，不宣称无限上下文。

## 检索与权限合同

1. MongoDB 仍是项目/成员/发布版本/时效/访问范围的权威；沿用 S2 前后两次复核、任务租约和代次激活。没有新增查询结果缓存。
2. 每个分支先从当前 Mongo 授权来源得到候选 ID。SQLite `allowed` 临时表在向量计算前 JOIN；FTS5 临时全文索引仅放这些授权窗口，BM25 的词频/文档统计也不包含私有资料。
3. 关键词支持 NFKC、英文词项、中文双字切分和通用中英销售词汇扩展。SQL MATCH 使用转义后的参数，不把输入当查询脚本。语义仍是固定本地 ONNX 模型生成的真实 384 维向量。
4. 每个召回分支先按发布来源去重，再取最多 50 来源，防止同一长文/相似片段挤满候选。采用 RRF（常数 60），最多 30 来源进入真实本地重排，最终返回最多 10 个不同发布来源；基础销售规则另行稳定加载，不计入相关性排名。
5. 重排固定 `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`，revision/许可证/全部文件 SHA-256 见 `server/semantic/reranker.json`；256 token 的成对输入，不静默截断。最多 256 对；分数是排序信号，不是事实置信度。开发集决定的 logit 下限为 -4.3；语义降级下限 cosine 0.35。这些阈值不构成所有领域的可靠性保证。
6. 重排安装/校验/推理失败或超出成对预算，显式返回降级 issue，只使用仍授权且版本有效的混合结果。Embedding、索引完整性、成员授权或发布核对失败不能降级放行。管理员与草稿审核可见提示，部分草稿须继续人工确认。
7. 字母数字精确型号不能被别的型号代替：当前范围内无该型号时不硬凑结果；已有该型号时，通用检查规则仍可参与，不能误删没有重复型号的通用依据。币种、数量范围和条款的完整适用性/语义核对归 S4，当前不把相似分数当核对结果。
8. 失效/停用/未来/草稿只按授权**标题元数据**做词项和本地语义状态发现，正文不进入索引或当前政策证据；未发布诊断仅管理员可见。最多 128 条历史状态标题，超额明确要求缩小范围，不把故障当没有限制。标题无法指代正文所有细节是已知边界。
9. 价格问题与相关产品介绍分开：无已确认的适用价格时明确缺口；物流说明不能当运费金额。有效的客户专属报价可以单独构成依据，且只在客户/产品/数量/有效期匹配后加载。
10. 管理员诊断候选和未采用的片段只供试查；`knowledgeForModel` 从聊天、工具、客户分析和邮件分析的生成输入中移除检索 trace，保留完整选中证据和快照。模板与客户要求仍不成为我方政策。

## 安装与迁移

沿用 S1/S2 的固定 Python 环境和 Embedding，无需下载新 Embedding。显式安装公开重排制品（只下载公开模型，不发送业务资料）：

```powershell
cd D:\Trade\genesis\CRM\Genesis_CRM\server
.cache\knowledge-parser\Scripts\python.exe semantic/setup_runtime.py --model-dir .cache/knowledge-semantic/model --reranker-dir .cache/knowledge-semantic/reranker
```

在服务端私有本地配置中设置 `KNOWLEDGE_RERANKER_DIR` 为重排模型绝对路径，其他 S2 配置保留。服务进程绝不运行时下载。可复用经过逐文件校验的本地 S0 制品；本轮验收采用实际本地 S0 权重，不是 mock 向量/重排。

适配合同升级为 `genesis-semantic-s3.1`。模型标识绑定 tokenizer、权重、适配/分窗/检索代码及重排锁；旧 S2 代次明确变为未就绪/落后，必须新建完整 S3 代次后切换，不能拿旧政策兜底。索引是可重建派生资料，原知识修订、原文和草稿快照不重写。未启用索引的真实项目不会被本次测试自动启用。

管理员：知识库 → 检索准备 → 更新检索资料 → 等待就绪 → 试查资料。支持关键词/语义/混合/智能检索；展开来源查看完整依据、版本、适用条件与关联原文，展开管理员过程查看各阶段分数、命中窗口、耗时及降级信息。内部信息不进入客户邮件。

## 评测与复现

原 S0 120 题、50 来源和所有金标准不修改。质量程序 `evaluation/knowledge/retrieval.ts` 调用生产 `buildKnowledgeBundle` 与审核，独立内存 Mongo/临时 SQLite，不用真实数据库或 LLM，不启动邮件任务。每次记录机器、固定数据哈希、实现起止哈希、版本、逐题结果和阶段耗时；运行中代码变化则作废，不出通过报告。

```powershell
npm run eval:knowledge:validate
npm run test:knowledge-evaluation
npm run eval:knowledge:retrieval -- --split=dev --mode=bm25 --output=tmp/knowledge-s3/bm25.json
npm run eval:knowledge:retrieval -- --split=dev --mode=vector --output=tmp/knowledge-s3/vector.json
npm run eval:knowledge:retrieval -- --split=dev --mode=hybrid --output=tmp/knowledge-s3/hybrid.json
npm run eval:knowledge:retrieval -- --split=all --mode=hybrid_rerank --enforce-gates --output=tmp/knowledge-s3/final.json
npm run eval:knowledge:retrieval -- --fixtures=evaluation/knowledge/transfer --split=holdout --mode=hybrid_rerank --enforce-gates --output=tmp/knowledge-s3/transfer.json
npm run test:knowledge-retrieval
npm run test:knowledge-index
```

`--enforce-gates` 对 Recall@10≥90%、负例状态≥95%、越权为0、无未预期错误给出非零失败码；不调用最终邮件/引用质量门槛来伪装本轮已经完成 S4—S8。来源级 top-10 排名不含基础规则；S0 历史实现返回 4 条规则+6条其他，历史报告不改，不把不同预算的提升全部归因于模型。

第一轮原保留集 Recall=98.75%、MRR=98.75%，但负例状态75%失败，原报告保留；此后只根据失败类别排查状态发现与证据充分性，不看原保留查询文本调答案。原保留集后续是回归诊断，不再宣称未见验收。另在进一步优化前冻结 `transfer`：64 来源、120 题，开发/保留各60，其中各40有依据、20负例；正例产品及来源在两组间不重叠。全部为明确虚构的新产品/政策，不补写真实政策。新开发集初始 Recall=100%、负例状态95%；新保留集不用于后续选择参数。

最终数字、分组、失败样本、测试与截图见 [本阶段结果](knowledge-s3-results/README.md)；若门槛未满足，必须如实记录未完成，不能删题/改标签/放宽目标。

## 限制与下一阶段

- 这里提升的是相关依据检索，不等于条件事实/客户协议的完整语义支持验证；S4 必须处理否定、细分数量区间、产品范围、冲突和逐项承诺核对。
- 单机 SQLite、临时授权全文统计、冷启动进程；没有据此宣称 10000 独立片段、并发2、热检索 P95≤5秒已验收。规模、长时间运行和多机协议仍按 S7。
- 模型窗口/查询对预算、历史状态标题预算和现有邮件输入字符预算仍有效，均显式失败或部分结果，不能自动省略业务条件。
- 标题状态发现可能漏掉只在正文中出现的旧政策主题；需要 S4/S6 进一步治理元数据，不能自动发布现有草稿。

参考实现依据：SQLite [FTS5/BM25 官方文档](https://www.sqlite.org/fts5.html)，[Embedding 模型卡](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)，[重排模型卡](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1)。业务系统和权限/版本/审核流程均由本仓库实现。


S1解析记录中的128-token告警/indexEligible保持历史原值；它不是S3发布权限或索引门禁。管理员仍需核实原文内容，保存为知识草稿并审核发布；S3随后建立检索窗口，不要求为了模型长度删掉政策条件。
