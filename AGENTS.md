# GlobalCRM 协作规则

- 运行命令与编辑前核对当前目录为本仓库 D:/Trade/genesis/CRM/GlobalCRM；废弃旧目录禁止读取或修改。GlobalSite 仅作只读参考，两个仓库分别分支、提交、PR，不共享代码或数据库。
- CRM 与 GlobalSite 的唯一对接依据为 docs/integration/integration-v1.openapi.yaml 和 globalsite-对接设计.md。先更新契约，再实现；不改变已有端点业务结构、库名、集合名、环境变量名，不读写 server/.env、server/uploads，不提交 .dsh 或既有 deliverables/。
- 所有新模型注册 tenant 插件；服务凭证只能读取其显式绑定项目，业务查询还须限制组织。图片下载必须同时验证签名、到期时间、当前凭证、项目、scope 和当前公开授权。
- C1 公开补充资料必须经过运营人员明确审核；默认不导出原始知识文档、内部话术、notes、价格策略或邮件发送配置。缺失数据返回契约规定的 null/[]，不得推断。
- 新增配置同步示例文件；可选服务缺失不能阻止核心启动。日志/测试快照禁止真实凭证、个人信息、签名链接或正文。
- GlobalCRM 任务分支 feat/globalsite-<任务编号>，不直接推送 main。用户已授权：完成检查且 PR 无冲突时直接创建并合并，不重复询问；仍须遵守实际权限和检查门槛。
- 交付前运行根 typecheck/build/lint，server test:integration/test:security/test:health 及本次相关测试，保持原端点冻结快照不变；新增契约单独冻结并补真实 HTTP 验证。结束按用户八项格式报告。
