# S0 架构决策与数据合同 v1

状态：S0 设计合同；下列未来数据结构尚未写入业务数据库。以 main 1c78bbe 的实际实现审查为起点。自研业务系统，使用通用库/本地模型/索引组件；不接入整套外部知识库或 Agent 平台。

## 现状审查与复用边界

| 现有实现 | 已有行为 | 后续必须补齐 |
| --- | --- | --- |
| middleware/auth.middleware.ts、utils/access.ts | 登录身份、项目上下文、按负责人限定客户，从属资源按可见客户查询；服务函数信任经过认证的 AuthUser | 新检索/缓存/任务入口同样必须从认证上下文取范围，不能信任模型或请求体的 projectId/role |
| agent/mail-access.ts | 入站邮件依当前项目和可见客户限定，删除邮件不可读 | mailboxUserId 尚不限制此读取函数；默认私有邮箱隔离目标与当前按客户共享可读的实现有差异 |
| letter.service.ts、mail-account.service.ts | 发件账号按用户/项目解析；回复父邮件必须属于当前客户/项目；其他业务员个人邮箱不能代发回复 | 后续读取与检索也应符合明确的私有/共享策略，不能只在最终写入时拦截 |
| AgentKnowledge、knowledge.service.ts | 项目知识不可变修订、approvedVersion、草稿/停用、生效/失效、条件记录；项目内全体业务员读取有效已发布版本 | 原始文档、解析/片段版本、细粒度位置、索引代次、替代关系及管理任务 |
| mail-thread-analysis.service.ts | 同客户/线程聚合授权邮件；提取需求；退订/退信/拒绝保护；保存原回复关联 | 更严格的个人邮件读取策略、统一证据充分性和逐项事实核对 |
| template.service.ts | 模板按项目管理，作为表达结构；发送时渲染 | 模板示例永不成为业务事实；以后结构化事实必须来自证据合同 |
| task.service.ts、inquiry-task.ts、batch.service.ts、automation.service.ts | 持久任务、步骤、重试/预算、批量单客隔离、事件去重；后台重新核对用户/项目状态 | 增加解析/索引任务的独立类型，不重做整个调度系统；补查/事实核对循环另在 S5 完成 |
| AgentCustomerAnalysis/AgentMailThreadAnalysis/DevelopmentLetter、knowledge-draft.service.ts | 草稿保存知识快照、版本变化提示、显式新草稿重新生成，发送由人工操作 | 原文位置/条件/语义支持及人工修改后重新核对 |

审查代码不等于所有路径已动态验证。S0 动态基线只调用上述检索/权限/审核服务，不调用 LLM、不启动 HTTP/邮件队列，不证明页面、HTTP 认证、缓存或完整模型注入防护已通过。

## 八类合同

所有 ID 是稳定系统 ID，不使用标题充当唯一键。业务时间为带时区的 ISO UTC 时间；数量/货币不使用浮点猜测；哈希为 SHA-256。客户端或模型提供的项目、角色、发布状态和权限一律不作为授权依据。

| 合同 | 必须字段 | 不变量与版本规则 |
| --- | --- | --- |
| SourceDocument 原文 | id、projectId、kind、originalName、mime、bytes、blobKey、sha256、uploadedBy、visibility、createdAt | 原文内容不可变；同项目内去重；存储路径不作为用户输入路径使用；下载也重新授权。客户附件/个人邮件与项目通用文档严格分域 |
| ParsingRevision 解析版本 | id、documentId、projectId、revision、parser/provider/version、configHash、OCR 模型哈希、state、artifactHash、warnings | 更换解析器/OCR/配置生成新修订；队列状态为 queued/running/succeeded/partial/failed/cancelled；空文本不是成功；失败不发布 |
| KnowledgeChunk 片段 | id、projectId、documentId、parsingRevisionId、ordinal、content、contentHash、headingPath、language、tokenCount、locations、parentChunkId | id 由文档/解析修订/位置/内容哈希稳定产生；不跨文档拼接；页码、表头、脚注和条件关系不得丢失 |
| ConditionalFact 条件事实 | id、projectId、topic、value/range、unit、currency、productScope、processScope、quantityRange、customerScope、validFrom/Until、confirmationMode、sourceRefs | 数量区间含边界定义；单价注明每件/每套等口径；交期注明起算点；未知不补零。抽取为 pending，人工确认后才能成为承诺；认证范围/编号/有效期分别保存 |
| Publication 发布版本 | id、projectId、knowledgeId、version、chunk/fact refs、status、reviewedBy/At、validFrom/Until、supersedes、desiredGeneration | draft/published/disabled 独立于索引状态；只引用明确的解析/事实修订；发布 CAS 校验，旧草稿保留旧快照 |
| IndexGeneration 索引版本 | id、projectId、publication refs、contentHash、embedding repo/revision/weightHash、dimension、normalization、distanceMetric、chunkerVersion、ACLPolicyVersion、state | pending/building/ready/failed/superseded；模型、维度、分块或 ACL 合同变更需新代次；索引可重建，不是权限权威 |
| EvidenceBundle 证据包 | id、projectId、principal scope、task/query、retrieval status、sources[{document/chunk/fact/version/position/conditions}]、conflicts、missing、indexGeneration、retrievalTrace | 权限取自服务端；返回前再查发布有效性；客户要求、模板和知识分别标注；相似分数不是“事实置信度”；不能自动解决条件冲突 |
| DraftEvidenceSnapshot 草稿依据 | draftId、projectId、customerId、threadId、taskType、draftRevision、bodyHash、immutable EvidenceBundle、claims[{text,refs,checkStatus}]、answered/unanswered、model/prompt version | 原生成正文和证据不可变；人工编辑形成新正文修订，旧核对不能冒充覆盖新文本；重新生成创建新草稿/修订；发送仍走原人工流程 |

### 原文位置合同

纯文本：明确 `offsetUnit=unicode_codepoints`、start/end 半开区间；不能把 Python 字符位置静默当成 JavaScript UTF-16 位置。PDF/扫描页：1 起始页码、页面尺寸、坐标系、bbox、OCR 置信及解析告警。Word：标题路径/段落/表格位置；不能伪造受渲染环境影响的固定页码。Excel/CSV：工作表/行/列或 A1 区域、表头、合并单元格与脚注关联。原文定位链接必须经过鉴权，不能暴露本地 blob 路径。

### 旧知识兼容

现有 AgentKnowledge id/version/approvedVersion 不重编号。S1 可把旧正文映射到 legacy-inline 文档与文本位置，保留原版本、来源和哈希，不伪称已找到原 PDF 页码。82 条真实资料草稿不得自动发布；迁移先预览，任何清理不可删除历史草稿证据。

## 发布与索引一致性

采用 MongoDB 发布记录＋持久 outbox/index job，幂等键至少包含 projectId/publicationVersion/modelRevision/chunkerVersion。任务开始和结束都重新授权及检查权威版本；MongoDB 单条 CAS/事务负责发布指针，索引构建用代次，不假设跨数据库分布式事务。

发布新版本后，旧版本立即失去“当前政策”资格。新索引未就绪返回 index_not_ready/partial，不用旧版本偷偷兜底。写入完整新代次后，再以预期 publicationVersion CAS 激活；过期任务不能把旧索引重新激活。停用/撤权立即由权威过滤阻断，不等待向量清理。重建/更换模型可回滚索引代次，但不能借回滚恢复已经撤销的政策。

## 权限合同

- 项目通用知识：当前项目成员、已发布且有效；管理员编辑审核。模型不能选择任意项目。
- 客户/专属报价：客户当前可见，且约定项目/客户/产品/工艺/数量/单位/有效期都匹配；差异或范围不明待确认。接受报价不能被升级成所有客户的政策。
- 个人邮件：目标默认按 mailboxUserId 私有，并继续受项目/客户可见性约束。共享邮箱应有显式 shared 范围及成员；不能用缺失 owner 自动推断公开。当前按客户共享读取是已知差异，须在读取/线程聚合进入模型前补齐。管理员跨个人邮箱的业务操作也需有明确授权语义，不能仅因 admin 就代人发信。
- 基线暴露的 n29/n30 是虚构个人邮件可被另一个现客户负责人读取；n31 删除、n32 跨项目被拒绝。这里报告目标差异，不据此声称已审计所有真实邮件或发现了真实泄漏。
- 客户邮件/附件按当前任务授权读取，不进入项目通用向量库。后台 worker 不能继承永久授权，恢复/发起检索必须重新核对。
- 预过滤作用于关键词、向量、重排输入和缓存；证据输出前复核。不能将外项目内容先传给重排/LLM 再过滤。

## 检索与核对状态

`ready`、`no_match`、`retrieval_failed`、`expired`、`conflict` 保留兼容，扩展 `index_not_ready`、`not_effective`、`disabled` 及带原因的 partial。`draft_only` 只用于有权看草稿的管理员诊断，不泄露未发布正文给业务员或模型。多状态可以并存为 issues，不能因为某个低相关过期条目出现就把整个任务判为过期。

基础销售规则是单独上下文预算，不参与结果质量排名的最终设计；S0 原始 MRR 为忠实记录现有行为，仍计入其排序位置。检索需要确认精确型号、条件和单位，不能把“找到相似段落”标为已回答。普通事实语义支持与数值/条件确定性核对结合；失败或冲突只生成安全部分和待确认事项。

## S0 选型决策

- 首选本地 Embedding：sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2，固定原仓库修订及 AVX2 INT8 ONNX，384 维、均值池化、L2 归一化、cosine，CPU 4 线程。开发小样题优于本轮英文 MiniLM 比较项。
- 首选本地重排：cross-encoder/mmarco-mMiniLMv2-L12-H384-v1，固定原仓库修订及 AVX2 INT8 ONNX，查询/片段 pair 输入。本轮只证明可运行；小样题没有证明在已满分的 Embedding 排名上还有收益，S3 须做消融决定何时调用。
- 初始本地派生索引：SQLite + sqlite-vec 标量 cosine 精确过滤扫描 + FTS5。它是库/索引组件，不是独立知识管理平台；S0 没有实现 ANN。Node 业务层与受管本地 Python 推理进程通过版本化、限长 JSON 消息交互，模型无数据库/SMTP 凭证。S1/S2 再实现进程管理和生产适配。
- OCR：rapidocr-onnxruntime 1.4.4 自带 PP-OCRv4 检测/识别＋方向分类；固定包和权重哈希。PDF 页渲染、复杂扫描、表格条件关联在 S1 验证。
- Embedding 当前探针截断 128 tokens，重排 256 tokens。S1 必须按真实 tokenizer 分块，标题元数据计入预算，不能静默截掉条件；超长表格要保留父级/邻接上下文并标记。如效果不够，在开发集验证长窗口模型、新索引代次后更换，不放宽最终门槛。
- 不选择仅英文 Embedding 作为默认；不因候选模型仓库名称看起来可用就宣称已验证。未运行和下载失败记录见评测文档。

## 不在 S0 实现的内容

没有向现有生产检索接上新模型或索引，没有业务原文上传入口变化，没有给真实政策做真实性审核，没有改个人邮件读取代码。S0 产物是可运行评测、真实本地组件探针、固定合同/指标及可追溯结果。生产索引、混合检索、事实核对和完整 Agent 仍按 S1—S8 完成。


## S1 实现映射（2026-10-17）

原八类合同保持有效。S1 在既有 MongoDB 中增加 KnowledgeBlob / KnowledgeDocument / KnowledgeParsing / KnowledgeChunk；原文保存在独立受限 blob 记录，解析子进程只读临时副本。实际字段、限制、任务租约、版本定位、权限和操作见 [S1 说明](knowledge-s1-ingestion.md)。AgentKnowledge 不改 ID 或修订号，只为人工从片段保存的草稿追加 sourceRefs；后续版本保留该不可变来源引用。

项目原文仅管理员审核，不将客户附件/个人邮箱内容自动归入通用知识。无 owner 的收件正文不再被推断共享，公共邮箱导入必须明确写 project_shared。长上下文与 OCR 的 indexEligible 是预算/结构标志，不能作为发布或授权条件；后续索引仍必须读取人工发布的权威版本。

Publication、IndexGeneration、完整 EvidenceBundle/DraftEvidenceSnapshot 的新实现仍待 S2—S5。此处不把解析片段已有记录等同于事实已确认、向量已建立或生成质量达标。

## S2 合同落地（635acf2 之后）

已实现的本地模型适配、发布衍生片段、持久索引任务/代次、Mongo 门禁、双重授权和内部草稿追踪，见 [ADR-002 与操作合同](knowledge-s2-index.md)。S1 原文/解析/片段不覆盖；AgentKnowledge 的发布版本仍是权威。S2 的 published_text 位置与原文件位置严格区分，未编辑原始资料来伪造精确定位。

这不代表八类合同后续所有质量与运维要求完成：条件冲突/充分性归 S4，统一工作流归 S5，完整体验归 S6，备份/多实例/规模性能归 S7。不得把 S2 小型真实模型测试当最终企业知识库验收。


## S3 合同落地（0021b59 之后）

[ADR-003](knowledge-s3-retrieval.md) 定义检索窗口和完整发布依据分离、授权范围内 FTS5/BM25、来源去重/RRF/固定本地重排、显式降级与状态发现。IndexIdentity 升级为 genesis-semantic-s3.1，必须建立新代次；原文/解析/知识修订/旧草稿不重写。

标题状态元数据同样受二次权限复核；管理员检索 trace 不进入销售模型上下文。来源分数不是事实置信度；完整条件核对与邮件逐项语义支持仍由 S4 完成，不把高召回当成最终承诺支持率。


## S4 条件与核验合同（57a3adc 之后）

[ADR-004](knowledge-s4-facts.md)定义已人工核对的scope、ConditionalEvidence、不可变CustomerAgreement版本、逐段ClaimCheck和编辑复核ledger。证据事实ID是source/version/原发布条款编号，publication_term位置与S1文档位置不混淆；发布正文和sourceRefs完整保留。客户专属记录只经客户ACL加载，不进入项目通用索引。

旧scope缺失的记录不自动升级为确认承诺；历史修订/原草稿不覆盖，不自动发布82条草稿。核验模型无工具、无SMTP，适用性/关键承诺硬门禁在后端；同一配置模型做受约束语义核验不等于独立NLI保证。质量状态见阶段进度，当前真实网关故障，S4质量门槛未通过。


## S5 持久证据工作流（b4e286a之后）

[ADR-005](knowledge-s5-workflow.md)扩展现有AgentTask而非新建调度平台。workflowRecords保存受限的阶段输入哈希/结果/状态/耗时/工具，生成和核验可恢复；检索、授权和有效性永远重新核对。workflowEpoch区分资料变化后的新证据与旧草稿，原人工编辑不覆盖；agentDraftId绑定实际审核过的草稿版本，旧稿发送不能完成新稿任务。任务DTO不返回检查点原始提示词或邮件正文。

条件事实、发布/索引版本、证据包和原草稿快照仍遵守前四阶段合同。步骤完成不是事实质量完成，失败/不足时仍为待审部分稿。S4真实模型门槛仍待，后续治理/规模/最终业务质量不得跳过。
