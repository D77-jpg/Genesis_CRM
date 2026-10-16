# S0 评测工具

全为 CC0-1.0 自编虚构 fixture，不是真实企业政策。无 UI 改动，CLI 和 JSON 报告即本阶段验证入口。

## 生产关键词基线

在 `server` 目录：

```powershell
npm run eval:knowledge:validate
npm run test:knowledge-evaluation
npm run eval:knowledge:baseline -- --split=dev
# 保留集只用于基线/最终独立验收，不用于调参：
npm run eval:knowledge:baseline -- --split=holdout
```

默认输出在忽略的 `server/tmp/knowledge-s0/`。可传 `--output=<绝对路径>`。程序只启动临时 MongoMemoryServer，设置 mock 邮件/模型渠道但不调用它们，不连接本地业务库、不启动服务器或队列。调用未改动的 production `buildKnowledgeBundle` / `auditGroundedEmail` / 客户/邮件权限工具。业务时间固定为 corpus.asOf，Date-only mock 仅在此进程内生效；performance.now 计实际耗时。

`manifest.json` 固定数据哈希；JSON 标签改动、引用不存在、位置不匹配、错误项目/语言标签、保留题进入组件选型会被校验拒绝。baseline 退出成功表示程序运行完成，不表示质量/隔离门槛通过，必须读报告。S0 遵循“先冻结指标再改引擎”，不会因当前基线低于门槛让它伪装通过。

## 可选本地组件实验（与 CRM 运行环境隔离）

```powershell
python -m venv .\tmp\s0-runtime
.\tmp\s0-runtime\Scripts\python.exe -m pip install -r .\evaluation\knowledge\requirements-probe.txt
.\tmp\s0-runtime\Scripts\python.exe .\evaluation\knowledge\download-models.py --models .\tmp\s0-models
.\tmp\s0-runtime\Scripts\python.exe .\evaluation\knowledge\components.py --fixtures .\evaluation\knowledge --models .\tmp\s0-models --output .\tmp\s0-components
```

模型从公开 Hugging Face 仓库按 `model-lock.json` 的 commit 和 SHA-256 下载，任何哈希不符不得推理。组件程序只读取 corpus、开发题和 probe-set，不读取保留题；禁止 Python socket 连接并关闭 ONNX telemetry。没有外部推理服务，也不读取 CRM 配置。两张合成 OCR 图片使用 Windows `C:/Windows/Fonts/msyh.ttc`；这是固定机器探针，其他系统需指定/适配字体后另记实验版本，不能声称已跨平台验证。

selected/comparison 模型本地文件共约 260MB 加 tokenizer；隔离运行环境和缓存不进 Git。Python 完整依赖锁见 `requirements-probe-resolved.txt`。结果包含权重/模型修订、包版本、样题/代码哈希、耗时和采样进程内存；不是 GPU、并发或线上容量证明。

## 结果口径

必要依据 Recall@10 以 clause 为单位；命中必须匹配 source、version 及必要原文或已标注结构化字段。MRR 以首个正确来源在现有返回顺序中的位置计算；当前基础规则排在前面，所以 MRR 与排除基础规则的模型小探针不能直接对比。

负向状态来自现有返回状态/issues 的公开映射，不读取 golden answer 来判断预测。个人邮件读取按目标默认私有合同评测，因此可能暴露与现状共享策略的差异。普通事实引用支持率、真实邮件回答正确率、LLM 注入防护和整条生命周期在 S0 未测，不能从此报告推导。

详情：[评测合同与结果](../../../docs/knowledge-evaluation.md)、[架构合同](../../../docs/knowledge-s0-architecture.md)、[阶段进度](../../../docs/knowledge-agent-progress.md)。
