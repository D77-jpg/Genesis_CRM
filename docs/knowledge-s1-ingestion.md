# S1：本地资料导入、解析与审核

日期：2026-10-17（北京时间）。前置 main `eb9f54f`，S0 PR #31 已合入；S1 功能提交 `85c982d`，分支 `codex/knowledge-s1-ingestion`。本地工程验收记录，不代表已合入 main 或通过后续检索质量门槛。

## 给资料审核员的操作说明

1. 进入正确项目 → **知识库 → 资料导入与审核**。原文、未发布片段、审核和兼容映射仅管理员可操作；业务员继续使用现有已发布知识。
2. 填写来源和分类，一次最多选 10 份资料，逐文件上传。上传完成不等于解析成功，查看左侧实际状态。
3. 选择文件，查看解析进度、失败原因或待审核片段。成功/部分成功的原文可下载核对；未通过校验的原文隔离，不开放下载。下载始终重新核对项目和管理员权限。
4. 核对标题、正文、表头、脚注、币种/单位和位置。文字显示 Unicode 区间；PDF 显示页码/坐标；Word 显示文档块、段落或表格行；表格显示工作表和单元格范围。Word 不伪造页码。
5. 点击 **核对此片段**，修改待审核内容，明确填写适用条件，再 **保存草稿并进入知识审核**。这一步只建立草稿，不发布政策、不向模型提供新政策、不发邮件。
6. 沿用现有知识编辑器，补产品范围、条件记录、生效/失效时间等，再由负责人核对发布。模板中的例子不能替代政策，OCR 的数字必须对原文确认。
7. 失败后可重新解析；重试建立新解析版本，旧结果保留。版本选择器可查看历史解析。取消会停止推进，已结束的任务不能冒充取消成功。
8. **历史知识兼容预览**只读现有记录；逐项点 **建立此版本快照**才生成 `legacy_inline` 映射。原知识 ID、版本、正文和发布状态完全不变。

原文定位第一版采用片段中的页/表格/文字位置与鉴权下载原文配合，尚无内嵌 PDF 高亮阅读器。不要把 Word 文档块号当成页码。CSV 区间说明逻辑记录和物理结束行，支持带引号的多行字段。

## 支持格式与硬限制

| 内容 | 第一版行为 |
| --- | --- |
| UTF-8 TXT / Markdown | 严格解码，保留标题路径、文字区间；Markdown 表格每行重复表头与关联脚注。非 UTF-8 明确失败 |
| 文本 PDF | 静态 PDFium 提取；整页保留上下文和坐标，不丢掉同页可能的列或脚注；表格列关系不自动推断 |
| 扫描 PDF、PNG/JPEG | S0 选定的 RapidOCR 1.4.4 + PP-OCRv4，本地 CPU；保留行框、置信、页/图尺寸，均需对原图审核；没有正文不能成功 |
| DOCX | 安全读取 XML，标题/段落/表格行、重复表头及显式脚注/紧邻注释；不依赖 Office、不执行宏 |
| XLSX | 安全读取工作表 XML；首非空行为表头，保留结构化单元格值、格式、合并范围和表内脚注；公式不计算，已有缓存明确标注 |
| CSV | UTF-8，逗号/分号/制表符分隔；保留完整记录、表头和说明，公式样式文字不执行 |

- 单文件最多 15MiB，PDF 50 页，工作簿 12 工作表，每表 10,000 行 / 80 列，图片单帧且不超过 16,000,000 像素。
- Office ZIP：最多 1,500 内部条目，展开总计 64MiB、单条目 16MiB、压缩比不超过 200；拒绝重复/越界路径、加密、DTD/实体、宏、ActiveX、嵌入对象、外部关系/工作簿。
- 原文累计正文最多 1,000,000 字符、1,200 片段，解析 JSON 输出最多 8MiB。大表重复脚注计入内容上限，超过时明确要求拆分。
- TXT/Markdown 在上传阶段先按同一套段落规则估算片段数（段落、标题、Markdown 表格行各算一段）；超过 1,200 时后端按章节/空行边界拆成最多 20 份「原名（第 i/N 部分）」，各自独立解析，用户仍只上传一个文件。其余格式不自动拆分，超过片段上限仍明确报错。见[上传阶段自动拆分](knowledge-simple-upload.md#上传阶段的自动拆分2026-10-21)。
- 180 秒墙钟超时；CPU 120 秒。Windows Job Object：进程提交内存 1.5GiB、活动进程数 1；Linux rlimit：虚拟地址空间 3GiB、CPU 120 秒、文件写入上限 0。Windows 资源限制初始化失败直接失败，不悄悄无上限执行。
- 分词使用 S0 固定的多语言 MiniLM tokenizer，**禁用截断**；标题计入 128 token 预算。原子段/表格行连同条件过长时整段保留，`indexEligible=false`，明确要求人工整理；不拿切掉条件的短片段冒充可用片段。该字段只是布局/预算资格，绝不是发布授权。

## 存储、版本与队列合同

复用 Express / MongoDB / 现有认证与人工发布，不接入独立知识库平台。

| 实际对象 | 作用 |
| --- | --- |
| `KnowledgeBlob` | 原始字节；按项目与 SHA-256 去重，默认查询不返回正文。单文件限制低于 MongoDB 单文档上限 |
| `KnowledgeDocument` | 不变的项目原文登记、文件名/格式/大小/哈希、来源、上传人及 `project_admin` 可见性；`project_document` 与 `legacy_inline` 分域 |
| `KnowledgeParsing` | 持久任务与解析修订；队列、运行、成功/部分成功、失败、取消；脚本与锁文件/配置指纹、依赖和模型版本、告警、artifact 指针 |
| `KnowledgeChunk` | 独立稳定内容记录，项目/文档/解析 ID、顺序、内容摘要、标题、语言、真实 token 数、位置、表格行、表头/脚注、币种单位、警告 |
| `AgentKnowledge.revisions.sourceRefs` | 人工保存草稿时写入不可变的原文哈希/解析版本/片段/位置依据；后续编辑版本继续保留来源引用，旧修订不改写 |

解析任务沿用现有任务的 **MongoDB 持久租约 + fencing** 模式，使用独立任务类型和集合，不把解析伪装成销售发信任务。30 秒租约、2 秒心跳；过期运行任务最多 3 次自动认领，反复中断转明确失败。手动重试创建新修订。上传原文与建任务之间的中断由孤立登记恢复器补齐。

片段先写入，只有当前租约仍有效才激活 artifact 指针；取消或陈旧 worker 写出的临时结果不会进入预览/审核。中断可能留下不可见的派生片段，S7 再做保留/垃圾回收，不以删除历史记录代替恢复。

解析前、心跳、结果提交前重新核对发起用户仍为启用管理员、项目仍启用。解析进程只获得临时原文路径、哈希、格式和公开词表目录，不继承数据库、邮箱或聊天模型密钥。原文不包含在日志和错误信息中。

`ConditionalFact` 的自动确认、Publication/IndexGeneration 的新版本生命周期和 EvidenceBundle/DraftSnapshot 的完整新合同仍按 S2—S5 完成。本阶段只形成待审核主题建议及结构化原文，不自动建立“已确认”政策。

## 本地安装与运行

需要 Python 3.12；Node 服务仍按现有项目启动。示例在 `server` 目录执行：

```powershell
python -m venv .cache/knowledge-parser
.cache/knowledge-parser/Scripts/python.exe -m pip install -r parsers/requirements.lock
.cache/knowledge-parser/Scripts/python.exe parsers/setup_runtime.py --assets .cache/knowledge-parser/assets
```

在仅本地的 `server/.env` 填写两个非密钥配置，不提交到 Git：

```dotenv
KNOWLEDGE_PYTHON=D:/Trade/genesis/CRM/Genesis_CRM/server/.cache/knowledge-parser/Scripts/python.exe
KNOWLEDGE_TOKENIZER_DIR=D:/Trade/genesis/CRM/Genesis_CRM/server/.cache/knowledge-parser/assets
```

安装脚本仅下载固定提交的**公开词表**，校验摘要；不会发送业务文件。RapidOCR 权重来自锁定安装包并在每次解析前核验。正常解析不下载、不调用外部 OCR、Embedding 或 LLM，禁用 Python socket 连接、子进程和 ONNX 遥测。解析脚本不得随意替换；如升级，建立新修订。

Linux 对应 `.cache/knowledge-parser/bin/python`，测试中文扫描件需 Noto Sans CJK 字体；Windows 测试使用本机 Microsoft YaHei，不打包或分发该字体。依赖许可证及词表/OCR 摘要在 `server/parsers/runtime-lock.json`；完整安装版本闭包在 `requirements.lock`，顶层意图在 `requirements.txt`。

当前 Windows 开发机已安装独立的 `.cache/knowledge-parser` 环境。正式 API 的重启/切换应在用户合并后进行；本次页面仅使用独立内存数据库的 5181/5002 验收站，没有启动真实发信/收件任务。业务 API 不在测试过程中切换到测试库。

### 自测入口

```powershell
$env:KNOWLEDGE_PYTHON=(Resolve-Path '.cache/knowledge-parser/Scripts/python.exe').Path
$env:KNOWLEDGE_TOKENIZER_DIR=(Resolve-Path '.cache/knowledge-parser/assets').Path
npm run test:knowledge-ingestion
```

测试强制连接其自建 MongoMemoryServer；不读取真实 MONGODB_URI，不发真实邮件。样本由 `tests/fixtures/knowledge-s1/generate.py` 生成，包含清晰/模糊中英图、扫描 PDF、文本 PDF、带脚注表格及恶意容器。测试临时原文目录在结束时清理。

页面测试可运行 `node --require ./tests/os-user-info.cjs --import tsx tests/knowledge-ui-fixture.ts`，只建虚构内存库、监听 5002，另启 Vite 并将代理指向 5002。测试入口不得替换正式后台启动脚本。测试账号仅存在于该临时进程；账号与密码的生成方式见该测试文件。

## 邮件权限兼容

S0 暴露的个人邮件默认共享差异已在本阶段收紧：收件正文及标题进入 Agent、客户时间线或线程之前，必须同时满足项目/客户范围与 `mailboxUserId=本人` 或显式 `visibility=project_shared`。管理员不会因为角色自动读取别人的个人邮箱。客户转交不会转交邮箱。

新导入的项目公共邮箱邮件由受信收件适配器明确写为 `project_shared`；个人 IMAP/POP3 导入明确写为 `private`。缺失 owner/visibility 的旧邮件不自动推断公开，本轮不批量改写历史邮件。需要确认历史邮件所属邮箱后再另做可预览迁移。CRM 的开发信发件记录仍采用原客户访问合同，不能错误套用收件字段。

客户附件和个人邮件不会被此上传入口自动搬入项目通用库。邮箱归属/客户授权与项目知识权限分开，模板和旧邮件草稿维持原审核发送流程。

## 实际验证与边界

见 [验证记录](knowledge-s1-results/verification.json) 和下列独立测试页面截图：

- [表格片段、表头和脚注](knowledge-s1-results/table-preview.png)
- [片段保存为未发布草稿](knowledge-s1-results/draft-review.png)
- [宏文件逐文件拒绝](knowledge-s1-results/unsafe-file.png)

本地通过 S1 11 组测试、知识 14、Agent 62、邮件/POP3 96、安全 5、集成 24、随手记 3、模板反馈 3、S0 标签/指标 7，以及前端消息 3、客户/写信输入 5。前后端构建和新增测试的严格类型检查通过。CI 已加入本地解析依赖/词表安装及 S1 验收；尚需用户创建 PR 后由实际 Linux runner 验证，不能把本地 Windows 通过写成 CI 通过。

实际终止隔离 Node worker，并启动替代进程验证恢复；为避免纯等待，测试显式让死 worker 的租约到期。并非断电/磁盘损坏/集群灾难恢复演练。超时测试终止真实睡眠进程；未进行内存耗尽压测。

尚不支持或需人工处理：加密文件、宏/嵌入对象/外部关系 Office、旧 DOC/XLS、PPT、音视频；复杂跨页表格、多级表头和扫描表格的精确单元格/脚注语义重建；手写或极低质扫描；超出 token 预算的原子长段。OCR 页全部标为需人工核对，不以高分自动确认价格等事实。无正文明确失败。

静态解析 + 进程资源限制和 Python 网络禁用不是完整的 Windows AppContainer/Linux namespace 沙箱，也不是杀毒扫描。底层原生库漏洞与 OS 级出站隔离、文件配额、不可见孤立片段清理、大规模性能、全链路安全仍属于 S7；不得声称任意恶意文件绝对安全。

本阶段没有实现向量化、混合检索或新的邮件生成质量评测，S0 的召回缺口仍存在，最终门槛未降低。真实 82 条草稿、客户和邮件没有被本次测试写入、覆盖或自动发布。

## 下一阶段入口

用户创建并合并 S1 PR、CI 通过后，从最新 main 进入 S2。以 `KnowledgeParsing` 的已接受 artifact、片段 `sourceRefs` 和 **人工已发布版本**为索引输入，先处理不可索引的过长/待人工 OCR 片段，不得仅因 `indexEligible=true` 就检索未发布原文。完成真实向量化、持久索引代次、发布/停用同步、过时任务 fencing 及重建恢复；不改变 S0 数据、保留集或验收指标。

实现学习与 API 核对来源：[Docling 的结构与上下文分块](https://docling-project.github.io/docling/concepts/chunking/)、[PDFium 静态页面 API/进程并行注意事项](https://pypdfium2.readthedocs.io/en/stable/python_api.html)、[RapidOCR 1.4.4](https://github.com/RapidAI/RapidOCR/tree/v1.4.4)、[Python ZIP 安全边界](https://docs.python.org/3/library/zipfile.html)。仅参考思路及通用库，没有接入这些平台。
