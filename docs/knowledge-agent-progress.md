# 知识库与销售 Agent 阶段进度

更新时间：2026-10-19。已核实main950e70f包含S0–S6；当前S7分支codex/knowledge-s7-operations，代码3105d8c，待用户创建/合并PR。工程合入和真实模型质量达标分开，S4/S5质量缺口仍保留。完整范围与门槛见 [roadmap](knowledge-agent-roadmap.md)。

| 阶段 | 状态 | 证据/下一步 |
| --- | --- | --- |
| S0 | 已合入，PR31 / eb9f54f | 冻结题库/机器/架构合同，首轮失败保留 |
| S1 | 已合入，PR32 / 635acf2 | 多格式、本地OCR、版本、审核及持久恢复 |
| S2 | 已合入，PR33 / 0021b59 | 真实本地模型、索引代次/权限/幂等/恢复 |
| S3 | 已合入，PR34 / 57a3adc | 混合检索/重排；S7重新跑冻结质量，详见结果 |
| S4 | 工程已合入，PR35 / b4e286a；真实模型质量待验 | 授权网关未完成44项有效判断，22保留首次测量仍待运行 |
| S5 | 工程已合入，PR36 / 4894e47；真实五类邮件质量待验 | 持久工作流/审核/恢复通过，模拟结果不冒充供应商效果 |
| S6 | 已合入，PR37 / 950e70f | 知识治理、来源版本/原文定位和业务审核体验 |
| S7 | 单机本地工程/规模/恢复已交付，分支3105d8c待PR/CI | [实测与限制](knowledge-s7-results/README.md)、[运维/迁移](knowledge-s7-operations.md)；OS沙箱/多机/生产介质仍未验证 |
| S8 | 未开始，最终质量未完成 | 用户合入S7后，补S4/S5真实质量并在干净main完成整条页面与恢复验收 |


## S0 当时的结果与阻断项（历史记录，当前状态见上表及S7）

1. 当前保留集必要依据 Recall@10=72.5%，低于最终 90%；无答案/边界状态分类未达 95%。S0 没有降低门槛，也没有修改生产检索美化分数。
2. n29/n30 两种虚构场景表明当前按客户归属共享读取个人邮件，未满足规划的默认私有读取目标；现有保存回复仍有个人发件归属限制。后续任何邮件索引/模型上下文扩展前必须补齐读取合同。
3. 基线状态映射会被低相关过期/冲突资料干扰，未发布专门诊断尚无能力，普通词项匹配不等于语义支持。
4. 组件已真实本地运行，但只在 12 个开发问题、43 个有效知识来源与两张合成图片上验证；这不是端到端质量验收。
5. 1 万行索引是复用真实向量的负载烟测，不是 1 万份独立资料；并发 2、完整查询向量化＋检索＋重排 P95≤5秒门槛仍未测。
6. 82 条真实 Genesis Bags 知识保持草稿。本轮没有读写真实 CRM 数据库、没有真实发信、没有新增业务跟进。

## 阶段完成规则

S0 PR 合并后，更新状态并核对实际 main SHA，再从新 main 开 S1 分支。每个可验收小步及时 commit/push，用户创建/合并 PR；不要在当前阶段分支上长期堆叠 S1—S8。

后续必须更新：提交与合并 SHA、测试命令/实际结果、数据及模型锁、门槛是否满足、未验证项、兼容/迁移说明和下一阶段依赖。数据改动应版本化；不能因效果不好改保留集答案或调低门槛。某阶段工程可交付不等于系统已达到最终质量。

## S1 交付与下一步

- 从已合入 S0 的 main eb9f54f 开始；功能提交 85c982d。操作说明、固定依赖/模型锁与 [实际验证记录](knowledge-s1-results/verification.json) 已入库。该分支已合入 main 635acf2（PR #32）；保留以下记录为 S1 交付事实。
- 支持 TXT/Markdown、文本/扫描 PDF、DOCX、XLSX、CSV、PNG/JPEG；安全拒绝、逐文件失败、取消、新解析版本重试、孤立登记补建和过期租约恢复。11 组 S1 验收包括真实终止 worker 后替代进程接管；最后使用项目独立虚拟环境重新通过。
- 结构化表格行、表头/脚注、币种单位和位置保留。过长原子段不截断，OCR/复杂 PDF 不推断精确表格语义，均明确标为人工整理；不是任意复杂文件自动理解已达标。
- 已通过的回归：知识 14、Agent 62、邮件/POP3 96、安全 5、集成 24、随手记 3、模板反馈 3、S0 标签/指标 7、前端消息与客户/写信输入 8；前后端构建及 S1 测试严格类型检查通过。GitHub Linux runner 仍待创建 PR 后验证。
- S0 n29/n30 的个人收件正文进入工具/线程/客户分析的边界已收紧，并用独立 fixture 验证本人、他人、未知 owner、显式共享、客户转交、出站根线程场景。没有重跑/改写冻结保留集来制造新召回成绩；旧 S0 报告保留历史原值。
- 本轮不修改真实客户、不发真实邮件、不自动迁移/发布原有 82 条草稿；历史映射必须逐项由管理员发起，原知识版本与审核状态不变。
- 仍有边界：复杂跨页/扫描表格语义、低质手写、长原子段需人工；内嵌原文高亮与大规模性能尚未实现。完整 OS 沙箱、原生解析库安全、配额及孤立派生片段清理归 S7，不能说“任意恶意文件绝对安全”。
- 用户合并 S1 后再从最新 main 开 S2：真实向量化、持久索引代次、发布/停用同步、fencing 和重建。未发布原文不得因有向量或 indexEligible=true 就进入业务检索。

## S2 交付与 S3 入口

- 从 main 635acf2 开始，已确认 S0/S1 提交是祖先；功能提交 8ff0e33、兼容权限修复 a783a4c，分支 codex/knowledge-s2-index 已推送。合并仍由用户操作，本地通过不等于 CI 或 main 已生效。
- 23 组 S2 工程测试使用真实锁定的 384 维多语言模型与 sqlite-vec。实际终止 Node worker 后换进程恢复，SQLite 丢失后重建，停用/删除/失效/权限变更后即时门禁，代次验证切换/清理失败重试均通过。维度迁移只模拟不兼容旧元数据，没有第二个真实模型。
- 本轮回归及评测合同共 250 项通过；前后端构建、新测试严格类型检查、生产依赖审计通过；初始全历史密钥扫描结果因退出码被后续命令覆盖而误记通过，PR #33 已暴露并复核两条公开模型文件摘要误报，修复及重新验证见 H11 审计。详细计数、真实运行采样与截图见 [验证记录](knowledge-s2-results/verification.json)。
- 关键词模式只作为显式兼容/评测开关，生产默认真实本地语义；未就绪/落后/服务故障不会悄悄回退。未自动处理真实草稿，没有真实客户改动或发信。
- 质量门槛仍未达成：一个存在大量相似样本的中文自由检索未命中目标；来源合同测试通过显式授权知识选择验证，记录保留，不能算自由检索改进成绩。S3 必须排查并纳入开发评测，保留集不可为此调答案。
- 超过 128 token 的完整正文/条件记录需要管理员整理，不截断；多服务器索引部署、完整 OS 沙箱、规模/并发性能仍未验收。S0 最终指标不放宽。
- 用户合并后，从最新 main 开 S3：复用 S2 发布清单、适配器、代次、权限与证据合同，实现关键词/向量混合、去重融合和真实本地 Rerank，跑冻结保留集与失败状态评测。详见完整 roadmap 的 S3 提示词。

### S2 PR #33 安全检查复核

- CI 服务端、前端、运维和仓库卫生检查通过；security 的 Git 历史扫描命中 8ff0e33 中两个公开模型分词文件 SHA-256。
- 已逐文件重算实际本地字节哈希，并与冻结 S0 / 当前 S2 锁一致；只增加两个精确历史指纹，不关闭扫描或放宽规则。模型和代码功能不变。
- 更正初始本地扫描通过的记录：静默日志和后续命令掩盖了扫描退出码。修复后立即保存并检查退出码，重新跑全历史扫描；完整说明见 [H11 复核](security/H11_AUDIT.md)。新提交的 CI 结果需按最新提交确认。

## S3 交付进展

- 从已合入 S0/S1/S2 的 main 0021b59 开始；短命分支 codex/knowledge-s3-retrieval。基础 87b4c0c、来源去重/生成输入隔离 0f0d8d8、跨语言状态与缺失价格/独立新评测 94e10b0 已推送。
- 真实本地 Embedding/FTS5 BM25/RRF/重排；长资料生成有位置的检索窗口，返回完整发布正文和条件，不让 128 token 截断成为政策。普通长问题受控分解；超过窗口/成对/历史标题预算明确失败或显式降级。
- 原 S0 保留集首轮负例75%失败已保留，不删题或改标签。进一步优化前冻结64来源/120题的 transfer 集，正例产品在开发/保留间不重叠。94e10b0 质量检查：原120题 Recall98.75%、负例97.5%；新独立保留60题 Recall100%、负例95%；两者越权均0。原保留集后续只作为回归，不再声称未见。
- 最后复核新增历史状态标题的二次 ACL 检查，推理期间撤权不返回旧标题；资料状态容量超限不能伪装 no_match；有效部分不能被单个过期诊断覆盖。最终功能 75a2814，本轮 13 项专项和 23 项索引生命周期通过；质量报告实现哈希与最终源码逐字匹配。
- 82条真实草稿未自动发布；所有动态验证使用独立虚构项目、客户和临时索引；不发真实邮件。S4 条件事实与承诺充分性、S7规模/并发/多机门槛不在本轮冒充已验收。

### S3 最终本地结果

- [操作合同与迁移](knowledge-s3-retrieval.md)、[质量/截图/完整结果](knowledge-s3-results/README.md)、[机器可读验证](knowledge-s3-results/verification.json)已归档。功能75a2814已推送，交付文档随后推送；未创建或合并PR，按约定由用户操作。
- 最终固定120题 Recall@10=98.75%、MRR=98.13%、负例状态=97.5%、越权0；原保留组60题为98.75%/98.75%/95%。新产品保留组首次独立和最终回归均Recall/MRR100%、负例95%、越权0。原首次保留失败75%也保留，未改金标准或放宽门槛。
- 原题库英文/中文/跨语言Recall分别97.92%/100%/98.81%。新保留中文负例仅5/6正确，漏判一例草稿状态；总体19/20达95%不代表每个子类已达95%，下阶段仍需改善。复合公司/证书依据缺失与安全部分状态误判保留在逐题报告。
- 四分支真实消融、真实重排非降级检查通过；13项S3、23项S2、知识15、Agent62、评测8、解析11、集成24及邮件/POP3/安全、随手记、模板、前端输入/Markdown/依赖消费者等相关回归通过。前后端构建、新测试严格类型、生产依赖审计、完整历史密钥扫描通过，无新增安全豁免。
- 当前小题库操作P95约2.51s/2.59s，含冷进程和快速权限案例，不是1万独立片段、并发2、热检索完整性能验收。窗口/重排对/128条历史标题容量均有限且显式处理；多机和规模仍归S7。
- 已通过真实页面：原导航→检索准备→中文问题命中英文v2→完整依据/脚注→关联原文修订→Unicode位置0–162。验证使用临时独立服务5187/5007，无真实客户修改/邮件发送；82条真实草稿未自动发布。
- 用户合入本阶段后，从最新main进入S4：条件事实、客户专属约定、否定/冲突与每项承诺的事实支持。S3不宣称已完成五类邮件最终业务验收或企业知识库全部阶段。

### S3 PR #34 跨平台评测文件修复

- Linux CI 的 server 检查在冻结 transfer 题库哈希校验处失败：原 manifest 记录 Windows CRLF 字节摘要，而 Git 入库转为 LF；根目录的行尾规则没有覆盖 transfer 子目录。已逐文件验证工作区规范化后的字节与原提交完全一致，仅换行不同；题目、标签、划分和来源内容均未更改。
- 将冻结评测路径的 LF 规则扩展到所有子目录，以 Git 中已有 LF 字节更新 transfer manifest，增加两套题库行尾与严格字节校验回归。不容忍任意哈希不匹配，也不修改已归档质量结果。归档报告保留当时 CRLF 原始样本摘要，当前 manifest 的 LF 摘要用于跨平台复现相同 JSON 数据。
- 本次修复仍在原 PR 分支提交；CI 状态按新提交重新确认，不把本地通过视为远端通过。
- 修复验证：评测合同 9/9、两套各120题的 Git 暂存区 LF 原始字节校验、CI 同款评测与新测试严格类型检查均通过；4份 transfer 数据文件在暂存区与原 HEAD 逐字节一致，仅 manifest 摘要和换行规则调整。

## S4 开发进展

- 已核实 S3 在 main `57a3adc`（PR #34）合入，从该版本创建 `codex/knowledge-s4-facts`。
- 首个检查点：结构化条件、专属约定不可变版本/权限、显式报价型号和数量范围、逐段语义协议与关键承诺硬门禁已接入客户/线程/聊天；详见 ADR-004。20 项独立条件与核验测试、原知识15项及类型检查通过。
- 此处仅为工程检查点：语义核验测试使用可控 fixture，不冒充真实模型质量；界面/真实模型验证/完整回归未完成，不标记 S4 完成。历史知识及82条真实草稿不迁移、不自动发布。


### S4 本地交付与质量阻塞（2026-10-18）

- 工程已接入：条件审核/适用性、精确客户报价、不可变专属约定、逐项语义协议＋关键承诺硬门禁、有上限的整封重写、精确版本引用、人工改稿复核与历史保留。检查点f3d0d78/05bb230；代码和页面均在短命分支，不直接修改main。
- 28项S4专项及Agent62/知识15/邮件96、真实S2索引23/S3检索13、解析11等回归通过；前后端构建、严格类型、既有生产安全门禁和全历史密钥扫描通过。[结果与截图](knowledge-s4-results/README.md)、[操作合同](knowledge-s4-facts.md)已归档。
- **S4质量未验收通过**：用户授权44项虚构资料到当前网关后，开发22项全部未连接成功，网关ECONNREFUSED；有效模型判断0，准确率不可测，保留22项尚未运行。不用fixture数量冒充95%/100%事实门槛，不换目的地、不改金标准、不降低目标。
- 下一入口先恢复获授权网关，记录新开发测量（保留首轮），再首次独立保留评测与邮件可读性检查。达到S4既定门槛并合入后进入S5统一证据工作流；不能因工程已推送跳过质量门槛。82条真实草稿未自动发布、真实客户未修改、没有真实发信。


## S5 开发进展

- 已核实S4 PR35合入main b4e286a，从该版本创建codex/knowledge-s5-workflow。用户明确要求继续S5，S4质量待验记录仍保留，不放宽最终门槛。
- 首个检查点：五类邮件统一证据步骤、持久生成/核验检查点、限定补查、恢复重授权/版本核对、资料变化保留旧稿和累计预算已接入既有任务。11项独立测试含真实杀死worker后另进程接管并复用已保存生成结果；Agent62兼容回归通过。详情见ADR-005，页面/完整回归仍在进行。


### S5 本地工程交付（2026-10-18）

- 从已含S4的main b4e286a，工程6eba875、最终恢复/权限/投递版本修复5e495b0已推送codex/knowledge-s5-workflow。沿用任务、会话、批量、事件及人工发送，无独立平台。
- 五类邮件统一读授权历史→需求→基础规则→首查/最多两次补查→适用性/缺口→生成→逐项核验→保存→审核；每步有检查点、版本/哈希和耗时。资料变化用新epoch保留旧稿；私有邮箱撤权立即阻断，暂停旧租约不能继续追加核验调用。
- 23项S5包括五类各自真实杀死worker后替代进程恢复，替代进程不重复生成；14项真实本地检索、Agent62、事实28、知识15、邮件96、安全5、集成24、冻结合同9、前端33及构建/严格类型/生产安全门禁/全历史扫描通过。完整[结果](knowledge-s5-results/README.md)。
- 页面确实创建五类各1任务并打开审核，终态均待人工审核，发送0/跟进0。投递验证只用独立数据和模拟回执；未改真实客户、不发真实邮件、不自动发布82条草稿。
- **仍未宣称质量完成**：S4网关仍ECONNREFUSED，真实普通事实/关键承诺门槛及S5五类实际模型文案未验收；没有外传新增S5夹具。用户授权继续S5工程不等于放宽S0/S4指标。
- 下一入口由用户创建/合并PR，再按S6继续知识治理和审核体验；并行补齐获授权网关恢复后的S4开发/首次保留测量及S5真实邮件质量，最终S8前必须完成。S7容量/多实例/恢复备份指标仍保留。


## S6 开发进展（2026-10-18）

- 已确认 S5 PR36 合入 main 4894e47，从最新主干创建 codex/knowledge-s6-governance。
- 第一检查点：维护提醒、产品/有效期筛选、版本差异、持久批量停用预览与恢复、授权来源位置查看已接入现有界面。已确认数字条件和认证覆盖在后端发布时校验，不自动处理82条历史草稿。
- 15项独立S6、知识15、事实28、前端13及前端构建通过；当前为工程检查点，真实页面与完整回归正在进行，尚未宣称S6验收完成。S4真实模型质量阻塞保留，最终门槛不变。


### S6 本地工程交付（2026-10-18）

- 基线main4894e47（S5 PR36）。治理初步372ef75、权限/界面e5e22df、最终用途保留修复8fd1b9d已推送codex/knowledge-s6-governance。用户创建/合并PR，未直接推main。
- 管理员产品/分类/状态/有效期筛选、到期/重复/疑似冲突、版本差异与逐条修订；持久批量停用必须预览，不提供批量发布。新发布的已确认条件需范围审核、认证需覆盖与有效期。原82条真实草稿无变动。
- 业务员按需展开问题/缺口/引用，核对来源版本及原片段定位；原文件管理员权限保持，旧稿私有来源/历史复核脱敏，邮件列表不携带全量证据。编辑复核、资料变化提示、新稿保留旧稿及原用途均已验证。
- S6专项24、其余287项相关回归合计311项通过，含真实本地检索14/解析11、五类持久任务恢复23、Agent62/邮件96/安全5；前后端构建、严格类型和既有安全门禁通过。1440/768/375、长中英文、深色、键盘、原片段第二分页和编辑/预览切换有真实截图。详见[结果与限制](knowledge-s6-results/README.md)和[ADR-006](knowledge-s6-governance.md)。
- 首轮UI发现重生成用途退化，保留失败记录、修复后补六项与最终页面复测；没有用首轮错稿当通过。最终临时进程已退出，最后DB审计未取得，最终页面结果与首轮DB结果分开记录。
- S6是治理工程验收，不是S4/S5真实模型质量完成。未新增外传、不改客户、不发真实邮件。用户合入后从最新main进入S7安全/容量/备份恢复/迁移可运维，S8前仍需补齐S4/S5质量门槛。


## S7 开发进展（2026-10-18）

- 已核实 S6 PR37 合入 main 950e70f（a16d5d1 为祖先），从最新主干创建 codex/knowledge-s7-operations。S4/S5 真实模型质量仍待验，固定门槛不变。
- 第一检查点：本地模型进程池、有限队列、超时/取消/熔断与模型身份切换；进入本地推理前再次核对排队期间的权限/发布版本。Mongo 仍是权威，不缓存用户的权限决定。旧索引因运行器摘要变化明确失效，需新代次，不默用旧政策。
- 7项实际子进程故障测试、14项真实本地检索回归通过；1万片段、并发2的固定机器测量正在运行。此处不是规模/备份恢复或S7完整验收结论。

- 第二检查点：项目级运行监控、默认私密日志/有限轮换、LLM/解析熔断、知识专用维护CLI、演练库加密备份/空库恢复/真实索引重建已实现。S7专项13项、前序254项、另组真实本地解析/索引/检索60项均通过；计数存在重复，不相加冒充独立用例数。
- 首轮1万独立真实向量、并发2 P95=4827ms，但40次中1次无匹配，组合门禁false；发现并修复双空闲进程误轮换，新增测试保护。首轮性能报告保留，最终固定实现复测待运行；性能和命中质量分别报告，不放宽S0指标。
- 加密恢复曾因自动建表尚未完成触发source_changed拒绝；夹具等待所有建表完成后恢复通过。错误密钥/非空目标被拒绝，真实原文哈希、知识双版本与重建后跨语言检索通过。通用生产备份/原生OS沙箱/多主机仍不冒充已支持。

- 最终全链路工程回归第一轮353项通过、前后端构建与安全依赖审计通过；随后冻结质量回归暴露状态分类失败。保留失败报告，新增两个独立案例，修复后事实/真实检索44项通过，两套各120题负例均97.5%、越权0。补充修复9c77d4b已推送；最终规模运行与收尾回归继续。


### S7 本地工程交付（2026-10-19归档）

- 工程a8aa060/f4f3d6c、冻结状态修复9c77d4b、解析停机/维护错误脱敏3105d8c已推送，未创建或合并PR。默认私密日志、项目级监控、有限进程/队列、熔断、推理前后ACL、专用本地维护和演练库加密恢复已接入既有系统。
- 最后全套后端356项通过；CLI错误脱敏追加后运维专项15项通过（与全套重叠，不相加）。根运维7项、前后端构建、新测试与评测严格类型、生产依赖门禁通过。最终全历史扫描已通过；4个源码摘要误报逐条核验、精确历史指纹及初次失败均记录在H11和verification.json。
- 真正10000条不同文本全部生成384维向量、缓存复用0，建立索引216.39秒；并发2、40次热检索P95=2706ms，目标≤5000ms通过。39/40预期来源命中，1次no_match、服务故障0；未隐去冷查询和初轮失败。冻结原集/transfer各120题最终负例97.5%、越权0，逐题缺失与先前失败均归档。
- 原文/双修订/解析状态实际加密备份恢复到空库，原库未改；SQLite丢失后真实模型重建并中文检索。实际维护进程不启动邮箱/Agent任务；停止组件也终止进行中的解析，并保留待恢复任务。
- 本轮只用隔离数据，无真实客户改动、发信或82条真实知识发布；无新增外传。供应商真实质量/费用、完整OS沙箱、多机索引、在线快照/真实介质及高峰混合/长时间负载均不冒充通过。
- 用户合入后进入S8：确认干净最新main与运行SHA，补齐S4/S5真实模型门槛，再做完整页面与模拟发送链路；不自行上线。S7单机工程通过不能取代这些前置。


### S7 PR #38 服务端 CI 修复（2026-10-19）

- 原提交6d5c5b7的CI run39143990324，security/web/operations/hygiene通过；server在恢复演练的维护preflight子进程断言处退出1。
- 根因：隔离子进程的环境白名单没有JWT_SECRET/ADMIN_PASSWORD，干净Linux runner没有本地.env兜底；本机.env掩盖了夹具缺项。恢复与检索此前步骤并未失败，不能把该断言失败描述为数据恢复损坏。
- 修复为显式生成仅本次进程使用的随机测试配置，指定隔离数据库和mock模型/邮件、禁用收件同步；不继承真实密钥，不放宽服务配置校验。子进程保留有限诊断，避免今后只看到退出码。修复后本地专项15/15和新测试严格类型检查通过；新提交的远端CI单独确认，不用本地通过代替。


### S8 in progress (2026-10-19)

- Base: main a450e84 (S7 merge). Independent memory database, fictional projects/users and loopback-only SMTP acceptance host; no real customer writes, real mail or publication of the 82 drafts.
- DeepSeek Responses endpoint/model deepseek-flash verified. User explicitly authorized the frozen 44 synthetic fact cases and two fictional projects/five mail-task acceptance data to https://api.deepseek.com. Key remains only in protected local configuration, never in Git/reports.
- First development measurement: ordinary accuracy 15/16, critical false releases 0, supported critical coverage 1/1; gate failed. A lexical negation-count check rejected an equivalent description. Replaced it with a literal same-proposition reversal guard; semantic paraphrases still require exact authorized citations and whole-claim entailment, critical promises still require complete fact cards. Independent English/Chinese cases added. Development retest 16/16, critical 0 false releases and 1/1 coverage.
- First unseen holdout: ordinary 15/16, critical 0 false releases and 1/1 coverage; gate FAILED. One overly conservative semantic verdict hypothesized later modifications to an ordinary supplied-product description. General supplied-product interpretation clarified, without adding test-specific words or changing frozen labels. Subsequent holdout runs are regression, not a new independent measurement. Final quality status pending.
- Initial all-server regression: 363 tests, 362 passed, first keyword project-isolation assertion failed. Standalone passed; repeated diagnostic and final full run pending. No blanket engineering/quality completion claim.

- S8 follow-up: full backend regression 364/364 passed; the earlier isolated keyword assertion did not recur in three standalone repetitions or the full run. Original/transfer 120-case retrieval reruns passed the frozen gates (Recall@10 95%/100%, negative states 97.5%/97.5%, leaks 0). Final frozen semantic regressions dev/holdout 16/16 ordinary, critical false releases 0 and positive coverage 1/1; first holdout failure remains recorded.
- Actual UI surfaced a separate full-email limitation: generation completed but semantic checking fell back to an unverified partial draft. Evidence checks now explicitly request strict JSON-schema output, rewrites request plain text, and DeepSeek uses its existing no-reasoning option for these bounded outputs. Ordinary chat is unchanged; incomplete Responses turns are rejected. Provider/fact regressions 92/92 and strict fixture types passed; actual full-email rerun pending.

- Full-email tracing confirmed structured calls now return complete checks. A second functional issue remained: workflow wording and recipient metadata diluted product retrieval, leaving only rules; ordinary address requests and standard closing courtesy were also incorrectly treated as unsupported promises. Sales queries now use product/policy evidence terms while keeping quantity/destination as scope inputs; only-rules results retain no_match. Bounded address questions/closings are recognized without permitting numeric/free-shipping commitments. Independent crowd-out and negative controls added; fact/workflow tests and types passed.
- S8 scale rerun: 10000 distinct real vectors, cache reuse 0, build 266.47 seconds, concurrency 2 warm P95 3320ms (target 5000ms); retrieval service failures 0, expected source 39/40. The one no_match remains visible and scale hit rate is not substituted for frozen quality.
- Strict-output evaluation exposed an adapter discrepancy: the evaluator sent raw trade prose that production intentionally excludes. It now shares production evidenceForCheck; frozen data/labels and conservative verifier unchanged. Pre-fix adapter failure retained; corrected dev/holdout reruns each ordinary 16/16, critical false releases 0, supported critical 1/1.

- Actual c5fca95 UI now retrieves all relevant product evidence, but an unverified acknowledgment in the generated email still caused the fallback to discard an otherwise fully verified product paragraph. Fallback now retains only whole, non-critical paragraphs accepted with exact authorized quotes, alongside deterministic conditional replies; rejected paragraphs are never sliced or rescued. Review remains explicitly partial. Critical commitments still require complete approved cards. Independent mixed-valid/invalid and whole-paragraph rejection tests passed (facts 33/33, server types passed). Full five-task UI rerun remains required.


### S8 本地工程交付与未关闭门槛（2026-10-19）

- 最终实现4658f74，干净最新main仍a450e84，S0–S7已合入；S8短分支已逐步提交推送，人创建/合并PR。完整UI加载eb7d3d5且dirty=false；正文缺项追加修复在干净4658f74真实页面再验。
- 实际MD/PNG解析、OCR部分识别、片段审核发布、跨语言检索及两项目反例、五类持久草稿、编辑复核/保存、版本变化/重生成旧稿保留、本地不转发SMTP=1及跟进=1均有证据。没有真实邮件发送/客户改动/82条知识发布。
- 首轮sample模型格式失败保留；修订夹具适用范围后sample/询盘3/3已知政策回答，未知价格/运费明确待确认。新增发现安全正文遗漏问题提示，4658f74补齐正文并新增回归。新增测试先触发旧覆盖断言，改为检查完整条件实际补入后再计回答；没有删除安全检查。
- 最终完整后端370/370、前端33/33、根运维7/7，构建/严格类型/依赖门禁通过。冻结原集/transfer各120题回归Recall95%/100%、负例97.5%、越权0；真实1万向量并发2热P95=3320ms。44事实检查最终回归通过，首次独立保留93.75%失败仍保留，不能把同集修复复测称新独立质量。
- S8总状态仍未完成：本轮尚未合main并复验、真实业务政策待负责人审核、整封邮件独立质量确认待补。模型仍会保守误判过渡语/签名、偶尔格式失败；安全部分稿不是完整语义通过。最终增量没有保留非关键语义段落，unavailable模式与实际网络成功请求分开解释。
- [完整报告](knowledge-s8-results/README.md)、[机器可读记录](knowledge-s8-results/verification.json)、[操作与下一阶段入口](knowledge-s8-acceptance.md)已归档；不自行上线。


### S8 PR39 合并后复验与增量修复（2026-10-19）

- 已核实PR39进入干净main f3240d2，实际MD/PNG导入、片段发布、跨语言、五类草稿、人工修改复核、本地SMTP1/跟进1均复验。询盘首轮格式失败保留；最终五类语义成功不是首轮100%。
- main依据更新后的重生成在handoff触发TASK_WORKFLOW_LIMIT，复验失败：模型/普通步骤的120000/1000ms预留未结算。短分支codex/s8-main-verification的8da9f6f以实际耗时和租约/精确检查点原子结算，所有预算/次数上限与历史计数保持，不自动重置旧任务。
- 独立回归先25/26失败，修复27/27；完整后端373/373、构建/严格类型通过。修复干净页面同一任务知识v2更新、一次格式失败+重试后awaiting_review，25步骤实际28460ms/charged42389；旧稿不变、0投递。此次安全部分稿不算普通语义质量通过。
- [合并后证据与失败](knowledge-s8-results/post-merge/README.md)。该增量仍需人创建/合并PR及干净main针对复验，远端CI未确认；真实政策审批、独立整封邮件质量门槛仍未关闭，不上线。
