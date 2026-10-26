# B1–B2：持久词项索引与 1 万片段压测

本目录只放可复现的工程报告，均使用虚构数据，不含真实客户、真实报价或真实邮件。

## B1 实现

- `server/semantic/runtime.py` 在 SQLite 中持久化 `lexical` 与 `lexical_terms`。索引构建时一次性写入词项和后置表；查询不再为每个问题重建临时 FTS5 表。
- 查询时先通过 Mongo 授权 ID 生成 `allowed`，BM25 的文档频率、词频和长度统计只基于当前授权集合。没有把项目/权限范围不同的资料放进同一 FTS5 统计表，避免私有词项通过排序分数泄漏。
- 旧代次没有词项表时保留受控的临时 FTS5 回退，管理员可重建；新代次走持久词项路径。回退状态会记录在 `trace.lexicalMode`。
- 新代次会复用未变化发布版本已验证的窗口、向量和词项，只对新增/变更资料重新分窗、向量化和写词项；增量复制不完整时自动退回完整重建，不切换半成品代次。

## B2 结果

### 真实本地模型 1 万片段（主验收）

使用既有 S7 隔离压测脚本，10,000 条虚构知识、真实本地 Embedding + 真实本地重排、Mongo 内存库、2 并发；不是 mock 向量。

```powershell
$env:S7_BENCH_ITEMS = "10000"
$env:S7_REPORT = "..\docs\knowledge-b1-b2-results\real-10000.json"
node --env-file=.env --require ./tests/os-user-info.cjs --import tsx evaluation\knowledge\operations.ts
```

结果（`real-10000.json`）：

- 构建 10,000/10,000 个窗口，状态 `ready`，构建约 **230.9 秒**。
- 40 次热查询：P50 **1,257.32 ms**，P95 **1,354.67 ms**，最大 **1,381.48 ms**。
- 检索失败 **0**，状态 `ready` 40/40，预期命中 **40/40（100%）**；重排未降级。
- 两个 worker RSS 约 **874 MiB / 873 MiB**，Node RSS 约 **653 MiB**。
- 性能门禁：`P95 ≤ 5,000 ms` 且无检索失败，**通过**。
- 这仍是合成规模/延迟测试，不是真实业务质量门槛；`qualityGate` 明确为未测量。

### 专项词项/并发探针（辅助）

运行命令（服务端）：

```powershell
$py = ".cache\knowledge-parser\Scripts\python.exe"
$env:KNOWLEDGE_MODEL_DIR = ".cache\knowledge-semantic\model"
$env:KNOWLEDGE_RERANKER_DIR = ".cache\knowledge-semantic\reranker"
& $py evaluation\knowledge\scale_retrieval.py --fragments 10000 --concurrency 2 --queries 20 --warmup 3 --mode hybrid_rerank
```

- 10,000 个虚构片段；2 个并发 worker；每个 worker 20 次计时查询，共 40 次；3 次预热。
- `hybrid_rerank`：P50 **535.16 ms**，P95 **1,025.35 ms**，P99 **1,040.08 ms**，最大 **1,043.83 ms**；错误 0，重排降级 0。
- 仅 BM25：P50 298.99 ms，P95 781.94 ms，P99 796.05 ms；错误 0。
- 资源：索引约 **64.5 MB**；`hybrid_rerank` 单 worker 最大 RSS **748.37 MiB**、CPU **47.05 秒**；BM25 单 worker 最大 RSS **347.78 MiB**、CPU **8.62 秒**。这些是辅助探针的进程计量，不含 Mongo 主机。
- 该探针的向量为可复现合成向量，用于隔离词项/扫描开销；主验收以上面的真实模型结果为准。

## 边界

- 这是**工程延迟/并发探针**，不是检索质量或业务准确性验收；相关性仍看 S3 的虚构评测集。
- 10,000 条是合成的英文片段；主验收使用真实本地 Embedding，辅助探针使用固定合成向量；不宣称真实多语言 10,000 独立文档质量。
- 本次修改了本地 runtime/retrieval 源码，`embeddingIdentity()` 的代码哈希会变化；上线后旧索引会被标记为 stale，管理员需要重建一次（之后未变化发布版本才走增量复用）。
- `sqlite-vec` 当前是精确扁平扫描，不是 ANN；大规模继续增长时需要另做 ANN/分片评估。
- 并发 2 是本机进程并发，不代表生产多机、HA、真实网络和 Mongo 端到端延迟。
- 重排降级 0 只说明本次模型文件可加载；模型输出仍需 S3 质量门禁。
