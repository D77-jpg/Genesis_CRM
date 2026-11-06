# GlobalCRM 协作规则

- 运行命令与编辑前核对当前目录为本仓库 D:/Trade/genesis/CRM/GlobalCRM；废弃旧目录禁止读取或修改。J1 当前明确授权双仓分别修改；非 J1 的 GlobalCRM 任务中 GlobalSite 仅作只读参考，两个仓库分别分支、提交、PR，不共享代码或数据库。
- CRM 与 GlobalSite 的唯一对接依据为 docs/integration/integration-v1.openapi.yaml 和 globalsite-对接设计.md。先更新契约，再实现；不改变已有端点业务结构、库名、集合名、环境变量名，不读写 server/.env、server/uploads，不提交 .dsh 或既有 deliverables/。
- 所有新模型注册 tenant 插件；服务凭证只能读取其显式绑定项目，业务查询还须限制组织。图片下载必须同时验证签名、到期时间、当前凭证、项目、scope 和当前公开授权。
- C1 公开补充资料必须经过运营人员明确审核；默认不导出原始知识文档、内部话术、notes、价格策略或邮件发送配置。缺失数据返回契约规定的 null/[]，不得推断。
- 新增配置同步示例文件；可选服务缺失不能阻止核心启动。日志/测试快照禁止真实凭证、个人信息、签名链接或正文。
- GlobalCRM 任务分支 feat/globalsite-<任务编号>，不直接推送 main。用户已授权：完成检查且 PR 无冲突时直接创建并合并，不重复询问；仍须遵守实际权限和检查门槛。
- 交付前运行根 typecheck/build/lint，server test:integration/test:security/test:health 及本次相关测试，保持原端点冻结快照不变；新增契约单独冻结并补真实 HTTP 验证。结束按用户八项格式报告。
- C2 私有凭证管理使用 CRM 用户会话+CSRF 和显式项目头，不接受服务凭证。项目管理员只能管理全部绑定项目均在本人权限内、且同组织的凭证。先运行 integration:credential -- migrate 部署唯一席位索引和旧记录归属；UI/脚本必须共用服务，禁止绕过套餐的原子席位插入。
- 凭证只在创建/轮换响应中提供一次，禁止进入 localStorage/sessionStorage/URL/全局store/日志/截图。轮换保留credentialId，宽限最长7天，脚本默认0；吊销立即作废新旧令牌。C2 的 inquiries:write 保留预选要求由 J1/C3 正式实现取代；旧 /globalsite/inquiries 草案仍未实现，不作为别名。
- 修改凭证界面后运行 server 的 test:credentials-ui；截图只能使用隔离虚构数据且在一次性密钥弹窗关闭后生成。继承 CRM 组件和语义颜色，新增文案集中 zh/en。

- J1/C3 新建 POST /inquiries，唯一业务询盘键和 IntegrationIdempotency 双重保护；先事务存档及站内通知，再异步拉附件。项目/组织/客户归属同时检查，不覆盖人工负责人/阶段/其他外部引用。新模型使用 tenant，新增索引迁移009。
- 询盘原文与临时附件URL加密；URL不进入日志或私有DTO。下载仅允许配置的精确源、固定DNS/IP、校验大小/MIME/SHA256且禁重定向。GLOBALSITE_ALLOW_LOCAL 仅允许非生产显式loopback联调；不能开放任意内网。
- 回复通过CRM用户权限、EmailSuppression与既有sendLetter(saveAsDraft:true)生成待审稿，不自动发送；单条询盘固定草稿幂等键。站内负责人提醒持久化，同步显示至顶栏。
