# C4：GlobalSite 状态与成交 Webhook

2026-11-06。只修改 GlobalCRM；GlobalSite 接收端另行实现，当前继续使用 GET /outcomes 轮询。权威机器契约在 integration-v1.openapi.yaml 的 GlobalSiteC4*、/webhook* 私有管理路径和 PUT /webhook 的 OpenAPI 3.0 callback；旧接口、scope、legacy/C1/C2/C3 冻结快照不变。

## 项目配置与事件含义

项目管理员及组织管理员在“集成与连接 → 状态与成交通知”配置一个公开 HTTPS 目标、订阅、启用开关。默认关闭。沿用 CRM 用户 Cookie 会话+CSRF/兼容用户 JWT，以及显式 X-Project-Id；服务凭证不能配置、看日志或重发，不新增 service scope。当前活跃用户与全部项目权限由 managementScope 复查。

首次创建生成64位十六进制签名密钥，只显示一次；密钥作为原始 UTF-8 文本使用，不先按hex解码。密钥编号和项目编号不是秘密。密钥及冻结载荷用既有 credential-crypto 加密，解密再验证组织/配置或事件绑定。密钥不进列表、日志、浏览器持久存储、截图或全局store。可轮换且记录审计。

修改地址、订阅、开关或轮换会递增 generation、取消旧的未完成队列、重设生效时点，不把历史事件改投其他接收方。保存相同值不重置队列。投递租约存在时返回409 WEBHOOK_BUSY，提示稍后重试；UI修改前明确说明影响，轮换另确认。密钥轮换无旧密钥宽限，接收端更新后再启用；若先关闭，重新启用后只采集新记录。原 GET /outcomes 仍可作为成交结果核对渠道。

事件仅来自同组织、同项目、仍带 globalsite 来源的 Customer，且必须有 C3 IntegrationInquiry 归档关联。每条归档询盘产生独立 eventId，另带原始 sourceEventId（CustomerEvent ID，与outcomes.eventId相同；报价为Quotation ID），携带原 externalInquiryId、CRM询盘ID、客户ID。事件发生后新进来的询盘不反向归因。既有通过 customers/upsert 交接但没有C3询盘的记录不能猜测询盘ID，不发Webhook。GlobalSite的现有C3方案创建pending Customer，不创建Prospect，因此prospectId为null，“线索状态”对应客户阶段。

| 事件 | 来源 | 说明 |
|---|---|---|
| lead.status_changed | 现有 CustomerEvent/status_changed | 记录的阶段变化，含 fromStatus/toStatus |
| deal.won | 同一记录 toStatus=won | 与阶段事件可同时订阅，按类型独立事件 |
| deal.lost | 同一记录 toStatus=lost | 同上 |
| quotation.sent | Quotation.globalSiteSentAt | 每份报价首次被CRM标记sent；非SMTP实际送达，不含报价价格/原文 |

报价的三个业务写入口（创建、编辑、改状态）在同一次文档写入用 $min 记录首次 sent 时间；后续立即 accepted 不会使Worker错过，重复标记不重复通知。新字段select:false，旧DTO不变。不回填历史报价。客户状态复用现有CustomerEvent，与outcomes保持相同源记录边界；旧业务流程活动记录本身为best-effort，本任务不改旧接口的事务/错误行为，也不能恢复未写出的源事件。

接收端按eventId做传输去重，按sourceEventId归并轮询/Webhook的同一业务结果；同sourceEventId的其他询盘通知仍须处理其关联，不能全局丢弃。

通知是客户级结果，关联询盘用于后续归因参考，不代表该询盘独立促成成交。没有姓名、邮箱、原文、附件地址或价格等非必要字段。

## 签名、接收与防重放

四个请求头：X-GlobalCRM-Timestamp（Unix秒）、X-GlobalCRM-Signature（v1=小写hex）、X-GlobalCRM-Event-Id、X-GlobalCRM-Key-Id。事件正文严格定义在GlobalSiteC4Event；不在本站另维护第二套DTO。

签名输入为 timestamp 的 ASCII/UTF8 字节 + 一个英文句点 + 原始HTTP body字节：
HMAC-SHA256(secret UTF8 text, timestamp + "." + rawBody)。

GlobalSite接收端必须按以下顺序实现，本次只有CRM发送端及可复用纯校验函数，不声称已部署接收功能：

1. 限制body大小；保留原始字节，不能先解析再JSON重排。
2. 根据已配置项目/密钥编号找密钥；校验时间戳格式、与服务器时间差绝对值≤300秒（未来和过去均限制），常量时间比较签名。纯函数见 integration-webhook-signature.ts。
3. 校验事件结构、projectId与本站连接绑定一致、头eventId与body一致。必须有订阅和来源映射，不能凭正文项目ID选择任意组织。
4. 在本站事务中以(projectId,eventId)持久去重并归档/更新后再返回2xx；重复合法事件返回2xx。去重至少保留30天，业务事件ID最好长期保留。时间窗不能独自阻止窗内重放，持久去重不可省略。
5. 不保证跨事件送达顺序；按occurredAt及业务规则处理较旧通知，并保留outcomes定期核对。投递重试/人工重发保持eventId及原始body完全不变，每次重新签时间戳。人工重发不能让已处理事件重复产生业务副作用。

签名密钥不与CRM服务凭证共用，不发Authorization Cookie。仅2xx为确认；3xx不跟随，401/403/404/429/5xx均进入有界重试。接收端可在出现错误后检查配置/日志，避免用真实资料调试。

## Worker、持久队列与安全

定时Worker从项目配置扫描已有状态记录和首次sent标记，页级事务保存唯一 outbox 后推进持久扫描位置。一次源记录关联超过50条询盘时分批恢复，迟提交的较小ID通过每轮回扫补获；不提前越过未保存页。unique(组织,项目,配置,generation,sourceKey)防反复扫描重复建事件。

全局调度只读取配置ID/组织/项目等任务元数据，最多20个配置一轮、四个并发，恢复组织上下文后做业务查询。项目租约60秒，每15秒续租；保存/重发与Worker共享租约条件和事务围栏。网络发送前检查generation、租约、项目状态、来源客户和C3询盘仍有效。来源删除取消，不继续出站。网络不在事务中，至少一次投递；进程崩溃的结果记unknown并原eventId重试，八次用尽（含崩溃尝试）后failed。手动重发开启新的八次预算，累计尝试编号不回退。

退避：30秒起，每次加倍，最多24小时；每轮最多八次尝试。日志只记录时间、HTTP状态、固定错误码、耗时、次数；不保留响应body、headers、签名、密钥、源资料或目标路径。界面显示投递状态，可筛选、分页、查看尝试并手工重新投递。旧generation禁止重发。

地址在保存与每次POST重新检查：只公开HTTPS，无账户密码、query、fragment或自定义端口，复用public-web的publicIpv4防护；全部DNS IPv4答案均须公开，固定所选IP，保留TLS主机校验，不跟随重定向。DNS5秒、HTTP15秒上限。没有loopback开发例外，GLOBALSITE_ALLOW_LOCAL不能放开Webhook。测试的本地接收器通过测试注入transport连接，产品路径始终拒绝内网。

可选功能，无配置不创建出站任务、不影响启动，无新增环境变量。既有主密钥/环境变量名不变，不读写真实server/.env或uploads。

## 数据和迁移010

新增 tenant 模型 IntegrationWebhook（组织+项目唯一配置/密钥密文/扫描位置/租约）、IntegrationWebhookEvent（业务唯一源键、加密冻结正文、状态/尝试/重试时间）、IntegrationWebhookAttempt（组织+项目+deliveryId+attempt唯一尝试日志）。

迁移20261106-010-globalsite-webhooks仅建上述索引、报价首次sent检索和客户事件检索索引。新增Quotation.globalSiteSentAt不回填、不改已有库名/集合名。生产先备份并在支持事务的MongoDB副本集上执行server npm run migrate，再启动API和Worker。旧数据和现有outcomes响应不变。

投递/尝试日志本次不自动TTL删除，避免误删待重试资料；长期保留策略和管理端清理另行评估。

## 测试与交付

test:webhooks / test:integration覆盖真实HTTP签名、过期/未来时间戳、篡改、持久去重、重试/最终失败、手动重发、配置代次、并发租约、崩溃预算、多询盘分页、源删除、来源/项目/组织、私网DNS、重定向和旧报价DTO。所有数据为隔离虚构数据；DNS/transport测试注入不进入生产配置。

test:webhooks-ui覆盖一次性密钥关闭后才截图、中英双语/移动无溢出、配置/开关/日志/重发/轮换。凭证页面新增区块，还需test:credentials-ui及原test:inquiries-ui回归。根typecheck/build/lint、test:security/test:health、冻结拒绝检查及Gitleaks全部为交付门槛。未向真实GlobalSite、公网接收器或用户邮箱投递。

GlobalSite接收端未开发，不应现在启用指向未实现地址的通知。无外部服务凭证、不修改GlobalSite；后续任务按本契约完成接收、去重和询盘归因后再开启。

## 本地验收记录

2026-11-06：根typecheck/build/lint通过（12条既有warning，无新增）；C4真实HTTP/安全/迁移/多组织调度12项，security19、health5、product-quote4、P3迁移/主流程6项通过；credentials-ui/inquiries-ui/webhooks-ui各1项通过。C4界面验证含语言切换保留未保存表单。冻结检查38项拒绝回归通过；原接口paths语义逐项比较无变化。所有测试用临时数据库/存储，未配置或向真实接收端投递。Gitleaks与当前提交CI结果在PR记录。

## 文件清单

- .github/workflows/integration-release-gate.yml
- AGENTS.md
- README.md
- docs/integration/C4-webhook.md
- docs/integration/COMPATIBILITY.md
- docs/integration/globalsite-对接设计.md
- docs/integration/integration-v1.openapi.yaml
- docs/integration/snapshots/globalsite-c4.json
- scripts/check-integration-contract.cjs
- server/package.json
- server/src/background/runtime.ts
- server/src/migrations/010-globalsite-webhooks.ts
- server/src/migrations/registry.ts
- server/src/models/AuditLog.ts
- server/src/models/IntegrationWebhook.ts
- server/src/models/Quotation.ts
- server/src/models/index.ts
- server/src/routes/integration-webhook.routes.ts
- server/src/routes/project.routes.ts
- server/src/services/integration-webhook-http.ts
- server/src/services/integration-webhook-signature.ts
- server/src/services/integration-webhook.service.ts
- server/src/services/quotation.service.ts
- server/tests/integration-webhooks-ui.test.ts
- server/tests/integration-webhooks.test.ts
- web/src/components/integrations/webhook-panel.tsx
- web/src/i18n/index.ts
- web/src/i18n/webhooks.ts
- web/src/pages/integrations.tsx
