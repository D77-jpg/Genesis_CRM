# GlobalSite ↔ GlobalCRM 对接设计（唯一契约之一）
日期 2026-11-04；状态 **S1 草案，C1–C4 尚未实现**。唯一机器契约为同目录 [integration-v1.openapi.yaml](integration-v1.openapi.yaml)；本文解释流程/映射/状态，不覆盖 YAML 字段约束；遇冲突先暂停报告。已有报价扩展仍由 quotation-draft-v1.1.openapi.yaml 管理，本任务不修改它。
核对基线：GlobalCRM origin/main b99b67c（开工时本地 f4f6525，切到最新主线再编辑）；已读 routes/integration.routes.ts、controller、validator、integration.service、credential service、Product/AgentKnowledge/IntegrationIdempotency 模型。GlobalSite 设计引用本文和 YAML，不复制定义。

## 1. 仓库边界与已知差异
GlobalSite 独立账号与 globalsite 数据库、可独立销售；CRM 仅接受 Integration API，不共享 Mongo、不 import 对方代码。GlobalCRM 本任务只改 docs/integration；不改根 AGENTS、业务代码、环境变量、库名/集合名、server/.env、server/uploads 或 .dsh。CRM 根 AGENTS.md 当前不存在，范围受限不能补建，此处记录规则，后续允许根文件任务再补。已有未跟踪 deliverables/ 不纳入提交。
**GS-D01（已报告，用户确认登记并继续）**：现有 GET /customers/{externalRef} 与 /customers/{externalRef}/quotations 实现接受 sourceSystem 参数、默认 autoforce，基础 OpenAPI 未描述。保持实现/契约原样，GlobalSite MVP 不调用这两个接口。未来单独任务先修订契约再实施，不在本站猜参数。health 实现可返回额外 capabilities，基础结构允许扩展；本站不以“契约未定义的字段缺省值”判断新能力。

## 2. 对接流程与权限
1. CRM 管理员使用现有 server/src/scripts/integration-credential.ts（server 下 npm run integration:credential）生成服务凭证，绑定项目与最小 scope；当前工具无法签发草案 scope，需 C 阶段扩展允许列表，S1 不宣称可用。
2. GlobalSite admin 输入 HTTPS CRM 基址、明确 projectId、服务 token；服务端校验 SSRF/目标白名单与 TLS，加密存 token。禁止前端直连 CRM、禁止用户 JWT/账号密码替代服务凭证。
3. 调现有 health 校验 contractVersion 1.0、项目/scopes；再调用 C1 能力端点。404/缺 scope 显示不支持，不能理解为空产品。新端点都走 integrationAuditLog → requireServiceToken → requireIntegrationProject → requireScope → handler。
4. 拉取明确授权对外公开的产品与资料 → 本站候选 → 人工确认事实。CRM “已批准”不等于本站事实已确认。
5. 访客询盘先存 GlobalSite；worker 调现有 customers/upsert 得 customerId，再调 C4 为该条询盘归档；两步各自持久投递/幂等键。不需要的可选同步 scope 缺失不影响本地使用。
6. 现有 outcomes 拉 won/lost；GlobalSite 按已保存 customerId 关联到本组织询盘。CRM 不为本站新增 webhook，MVP 轮询即可。
7. 轮换 token 后重新 health/能力校验再恢复队列；401/403 暂停；换项目必须新连接、明确是否补推历史，不修改旧投递目的地。

| 类别 | 方法与相对 /api/integrations/v1 路径 | scope | 状态 |
|---|---|---|---|
| 连接 | GET /health | 有效服务凭证，无专用 scope | 已有，定义不变 |
| 客户交接 | POST /customers/upsert | customers:upsert | 已有，定义不变 |
| 成交回流 | GET /outcomes | outcomes:read | 已有，定义不变 |
| C1 能力发现 | GET /globalsite/capabilities | globalsite:read | 草案 |
| C2 产品拉取 | GET /globalsite/products；GET /globalsite/products/{productId} | products:read | 草案 |
| C3 资料拉取 | GET /globalsite/materials；GET /globalsite/materials/{materialId} | materials:read | 草案 |
| C4 逐条询盘 | POST /globalsite/inquiries | inquiries:write | 草案 |

C1–C4 为本次建议拆分，用户未提供既定详细任务表；后续任务需对齐范围。默认最小询盘连接 customers:upsert + inquiries:write + globalsite:read；成交可加 outcomes:read；按需加 products:read/materials:read。不索要 stats、quotation 权限。已有 scope 的意义和集合不变，新 scope 实现时再加入枚举，旧凭证不会自动升级。
C1 返回契约版本、已实现能力标识和 limits；标识：globalsite.products.v1 / globalsite.materials.v1 / globalsite.inquiries.v1，仅返回本凭证有 scope 且服务实际启用的能力；limits 包括 pageSizeMax、inquiryMessageMaxLength。不能在 C1 实现前硬编码服务已支持 C2–C4。

## 3. C2/C3 公开投影、游标与同步
CRM Product 现有 sku/name/category/description/status/specs/moq/leadTime/updatedAt 可映射；内部 priceTiers/notes/createdBy 默认不导出。现有 Product 无图片关系；C2 需建立显式公开投影与资源关系，不能编造现有字段。AgentKnowledge 的 approvedVersion 可作为候选版本基础，但 admins 资料及非显式公开记录不得导出；C3 需建立发布白名单与可撤销授权。
实现建议新增 tenant 模型 IntegrationPublishedResource：organizationId/projectId/resourceType/sourceId/publicRevision/approvedBy/approvedAt/payload/deleted/updatedAt；唯一 (organizationId,projectId,resourceType,sourceId)。这只是未来设计，S1 无集合/索引变更；现有集合不重命名。公开投影持久化版本能保证游标重放时权限不扩大。撤销发布生成 tombstone。
产品/资料 items 区分 entity 与 tombstone（YAML oneOf）；已撤销条目只返回 ID、revision、updatedAt、deleted:true，不泄露正文。未授权/跨项目详情返回 404；当前项目 tombstone 详情返回 tombstone，便于客户端删源。详情图片/资料资产仅返回短期签名 HTTPS URL、expiresAt、hash/mime/bytes；不提供 CRM 上传目录路径。
共享分页规则：limit 1..200 默认 50；cursor 不透明，绑定项目/组织/资源/凭证权限、快照上界和最后(updatedAt,id)，签名防篡改，保留 7 天；首轮无 cursor 按稳定顺序扫描公开投影。nextCursor 在最后一页仍返回可用于增量轮询的水位，空页保留原 cursor（首次空页生成水位），hasMore=false 时等下一轮，不清空本地游标。这仅是新 C2/C3 行为，**不改变既有 outcomes 的空页 nextCursor:null**。
持续并发更新在下一批扫描；投影变更水位须使用提交时服务端单调序列/同等机制，不能靠客户端时间避免丢更新。同一批 upper bound 固定，所有记录处理完才 CAS 提交游标，page 中失败不越过。过期或范围不匹配 cursor：400 VALIDATION_ERROR，details.reason=CURSOR_EXPIRED 或 CURSOR_SCOPE_MISMATCH。过期执行完整重新对账，先暂存结果，完整成功后标记本地缺失项，不因单页没有某项就删除。
GlobalSite 每 15 分钟/手动同步；按 remoteId+revision 去重，远端变更进入 syncCandidate，本地覆盖字段和 confirmed 事实不自动覆盖；产品 archived 或 tombstone 标记不可继续引用，已发布页面显示需审核重发。CRM 原始 ID 为字符串，不可拿 SKU/name 当跨系统主键。
Signed URL 失效重新请求对应详情，不保存 URL 作为永久图片；下载校验大小/hash，本站存为自己的 Asset；只允许受控源，不跟随任意重定向，防 SSRF。

| CRM 公共投影字段 | GlobalSite 字段/处理 |
|---|---|
| Product.id / revision / updatedAt | remoteId / remoteRevision / remoteUpdatedAt，绑定 connectionId |
| sku/name/category/description/status | 产品候选同名字段；与本地 SKU 冲突人工合并，不静默覆盖 |
| specs[].code/name/value/unit | 候选规格 + FactSheet 来源指针，不自动确认 |
| moq/leadTime | 带范围的候选事实，不自动作为公开承诺 |
| assets[].id/url/expiresAt/sha256/mime/bytes | 下载检查后生成本地 Asset，URL 不公开写进本站源码 |
| Material.id/kind/title/content/sourceLabel/revision/updatedAt | FactSheet 候选或待解析 Asset 来源；kind=company/certification/factory/quality/faq |
| Material.productIds / validUntil | 同连接 remoteId 关联及候选有效期；未知产品保持待关联 |
| deleted:true | 标记远端撤销，阻止新引用，提示处理线上旧内容 |

## 4. 询盘映射与重复客户
customers/upsert 使用已有 CustomerUpsertRequest/Response，不增加必选字段。sourceSystem=globalsite；externalId=`site:<siteId>:inquiry:<inquiryId>`（均内部稳定 ID，不用邮箱，总长<=128），schemaVersion=1.0，initialStatus=pending。每条询盘有独立外部键，重复邮箱可能 linked，保留 action 与 customerId。
**已有模型只有一对 externalSystem/externalId**：同邮箱关联可能更新现有客户的外部引用；不得假定 CRM 可保存多个来源引用，也不得在 S1 修业务。GlobalSite 保存每次返回的 customerId；C4 直接关联该项目内的 customerId，不再依赖旧 externalRef；outcomes 按 customerId 匹配，externalId 仅辅助。无 C4 时本站仍保留每次完整询盘，CRM 仅客户补空字段；UI 明确“客户已交接，逐条需求尚未归档”，不能把两者都称已完整同步。C4 是完整逐条需求同步验收前置。

| SiteInquiry | 现有 customers/upsert | 约束 |
|---|---|---|
| contact.name/company/email/phone/country | name/company/email/phone/country | 规范化、长度以 YAML；email 仅辅助判重 |
| 产品名称/型号/分类 | interestedProducts/productModel/productCategory | 多产品合并摘要有界截断，完整需求留 C4 |
| quantity/targetPrice/moq | expectedQuantity/targetPrice/moq | 保留单位/币种，访客诉求不当成公司事实 |
| message | requirementNotes | <=5000；仅首次/空字段补齐，不能保存每次对话 |
| 站点/表单入口 | leadSource = GlobalSite / Website Inquiry；tags | 只用静态白名单标签，不放邮箱/自由文本 |
| inquiryId+siteId | externalId | 跨站不碰撞；原始 ID 不含个人信息 |
| source URL/UTM/consent | 不向旧接口注入自定义字段 | C4 明确白名单传递，先去 URL query 中个人数据 |

C4 使用 schemaVersion/sourceSystem/externalId/siteId/customerId/submittedAt/contact/message/productRefs/pageUrl/consent（必选详 YAML），可带 company/country/phone、quantity、utm。仅结构化清洗内容，无附件二进制、原始 IP、Cookie 或会话。contact.email 必填；pageUrl 仅 HTTP(S) 公共页面且不含账号密码；attachments 不在 MVP 对接范围。
C4 新 tenant 模型 IntegrationInquiry（未来）：organizationId/projectId/sourceSystem/externalId/siteId/customerId/submittedAt/contact/message/productRefs/pageUrl/consent/utm/payloadHash/createdAt；U(organizationId,projectId,sourceSystem,externalId)，(organizationId,projectId,customerId,submittedAt)。客户必须属于凭证项目/组织，越权统一 404；不创建客户、不改销售阶段/负责人/报价、不发营销邮件。询盘不可变；相同业务 ID 不同载荷返回 409，修正建立新 externalId 并在本站保留关联。
原子询盘持久化后返回 201，业务重放 200 同 inquiryId/customerId/receivedAt，deliveryStatus=stored。不是销售已读/已跟进确认；未来 CRM UI 展示在独立实现任务完成，不把 API 归档等同于 UI 已上线。

## 5. 幂等、重试、事务与审计
现有 upsert 幂等存储索引为 credentialId+key，不修改其语义；GlobalSite key 必须全局区分项目/操作/询盘（如 gs:<project>:upsert:<inquiry>，<=128）。相同 payload 原样重试，不能每次生成新时间/改字段。不同载荷同 key 得 CONFLICT，不无限重试。
C4 请求级幂等：credentialId + projectId + operation + key，内部摘要 key 前缀隔离、兼容现有 IntegrationIdempotency 索引；请求 hash 包括业务体。业务唯一键不含 credentialId，凭证轮换/撤销重签也不能重复归档。同业务键不同 hash 409；同 hash 返回首次 data。并发原子占位+租约，事务写 Inquiry/幂等完成，进程中断可按业务唯一键恢复。幂等响应保留至少 30 天（实现前决定清理策略）；业务唯一记录按保留期存在，不能因幂等缓存到期重复建询盘。
本站 outbox 两步：upsert 成功保存 customerId → 构造固定 C4 payload/key → C4 stored 后标 sent；步骤 2 失败不重复丢弃步骤 1 状态。先存档后投递；邮件与 CRM 各自独立状态，不互相阻塞。CRM 500/超时可能已经成功，必须原键重放。
建议重试：网络/408/429/5xx，30s/2m/10m/30m/2h/6h/12h/24h + jitter，最多 8 次；429/503 遵守有效 Retry-After；超限 dead 并通知管理员。401/403 暂停连接、人工换凭证；404 项目/资源问题人工处理；400/422/409 不自动重试。人工原样重试仍原键；变更载荷创建新修订事件，不能篡改已完成询盘。
审计复用 IntegrationRequestLog，记录 requestId、credential/project、scope、route/status/error/latency；不记 token、正文、邮箱、URL 原查询或完整 payload。响应 X-Request-Id 供双方排查；传输 TLS、凭证仅后端加密保存。

## 6. 成交回流
现有 outcomes:read 不改；limit 默认50最大200、首次无 cursor 从最早事件读，toStatus 为 won/lost。本站只处理本连接已知 customerId（一个 CRM 客户可对应多条本站询盘），更新其“客户成交状态”，**不推断某条询盘带来多少营收**。eventId 去重，先落业务再保存 cursor；nextCursor=null 时保留原 cursor；hasMore=true 继续分页。多组织、项目的 cursor 不能混用；本站禁用跨组织匹配，不能凭 email 合并。
服务不要求所有事件都是 globalsite 来源；unknown customerId 忽略并记不含内容计数，仍推进游标；连接撤销停轮询。第一次连接历史成交按客户关联状态显示，不冒充新提醒。

## 7. 错误与版本
统一 {success:false,error:{code,message,details?,requestId?}}，未知错误码保留 requestId 并显示可理解提示。
| HTTP / code | GlobalSite 行为 |
|---|---|
| 400/422 VALIDATION_ERROR | 显示字段问题；新分页 CURSOR_EXPIRED 走全量重建，其他不重试 |
| 400 UNSUPPORTED_CONTRACT_VERSION | 停连接功能并提示升级，不降级猜字段 |
| 401 UNAUTHORIZED | 凭证无效/到期/撤销，暂停待管理员 |
| 403 FORBIDDEN_SCOPE | 列出缺少权限，只停受影响能力 |
| 404 PROJECT_MISMATCH | 核对项目绑定，不探测别的项目 |
| 404 NOT_FOUND | 资源不存在/不在本项目；新端点不存在显示未支持 |
| 409 CONFLICT | 幂等键/业务 ID 异载荷；人工检查，不覆盖 |
| 429 RATE_LIMITED | 按 Retry-After 后重试 |
| 500 INTERNAL_ERROR；503 SERVICE_UNAVAILABLE（仅草案） | 有界重试；不暴露内部异常 |

基础 contractVersion 保持1.0；新能力以 globalsite.*.v1 标识与 x-status:draft / x-implementation-phase 区分，S1 不是发布新 API 版本；以后删除/改名/改语义发 v2，兼容新增可选字段可留 v1。新 endpoint bearer scope 在 OpenAPI HTTP bearer security 中用空数组（规范要求），真实权限用 x-required-scope 扩展；已有 security 字段原样保留，不夹带规范修正。
本 PR 不改旧 paths/components/tags/servers/info 定义，仅追加新 paths/schemas/parameters/responses 与顶层草案说明。新的 $ref 闭合，草案字段为候选冻结集，实施批准前可审查调整，双方不得各自扩展。

## 8. 冻结、验证与交付门槛
现有 COMPATIBILITY.md/CI 的基础文件 SHA256=7798eb621795e8dc405ff56c0fdfb806622ec5a6144d85d6e839ee85d9061679，冻结快照保持不变。初次追加草案导致全文件指纹检查失败后，用户明确授权额外调整 `.github/workflows/integration-release-gate.yml`，不修改业务代码。新检查从不可变基线 `e2e3486300250b75d08295bcba6b8bd09a8e4774` 读取原始文件并验证原 SHA；仅剔除约定的 6 个未实现草案路径、GlobalSite 命名空间新增组件与草案元数据后，逐项深等比较整个原契约。旧接口、共享组件、认证、版本及其他原字段均不得改动；其他新增路径和未标草案的操作同样不放行。所有引用须可解析、operationId 不可重复，草案仍须具备原有服务认证及项目头要求。实现阶段 C1–C4 批准、行为测试和双方契约测试通过后再更新快照及相容记录；本次自动检查通过仅表示原契约受保护、草案合法，不表示新能力已实现或生产就绪。
S1 校验 YAML 可解析、旧 paths/components 逐项深等、新 schema 引用/operationId/项目头/scope 标记闭合；运行现有 typecheck/build/lint 与 server test:security/test:integration/test:health。本站 S1 无 package.json，不能运行应用检查。
C 阶段：在 CRM 添加新 scope/项目隔离/投影与撤销/tombstone/游标签名/幂等/恢复/脱敏测试，冻结新定义与行为；本站固定批准 commit，校验每个真实请求与响应（好坏例、缺 scope、跨项目、重放/冲突、断网、过期 cursor）。J1 两仓独立 PR 联调，不能用修改测试跳过已有行为保护。
无数据库迁移在本 PR 执行；C2/C3/C4 才创建新 tenant 集合与索引，不修改现有集合名或库名。待决策：C 阶段详细编号、公开投影授权 UI、保留期/清理与部署数据区域；本站设计中不重复定义这些 Integration API。


### S1 实测记录（2026-11-04）
GlobalCRM typecheck/build/lint 均通过（lint 12 条既有 warning）；集成 24/24、安全 19/19、健康 5/5，均无 skip。首轮受限环境临时 MongoDB 启动失败，正常本机权限重跑通过。静态校验确认旧 6 个路径与所有旧组件深等，新增 6 个草案操作、121 个引用可解析。首次远端 server/web/security/operations 通过，hygiene 因全文件 SHA 变化失败。授权修正后的检查在本地验证原冻结 SHA、旧定义、草案与引用，并通过 17 项拒绝错误改动的回归检查；workflow YAML 与脚本可解析，其余四个任务、触发条件和兼容性快照检查不变。未修改应用代码或业务测试，冻结快照未更新。

## C1 正式任务覆盖说明（2026-11-05）

已批准的 C1 任务为只读产品、公司、话术及知识摘要，详细来源/分页/公开审核/签名/迁移见 [C1-read-api.md](C1-read-api.md)。机器定义见同目录 OpenAPI 的 GlobalSiteC1* 组件及 /products、/company-profile、/playbook、/knowledge/summaries 路径；新增 scope 为 products:read/company:read/playbook:read/knowledge:read。S1 建议的 /globalsite/* 路径仍保持未实现草案，不能混用；新接口不宣称实现 C2–C4。本文前述 S1 仅文档范围/不创建根 AGENTS 的限制为历史记录，C1 已授权业务实现并维护根 AGENTS。旧接口与 GS-D01 保持不变；所有集成请求增加共享每凭证120次/分钟防护，429 遵守 Retry-After。

## C2 凭证管理（2026-11-05）

私有管理API基址 /api/projects/integrations，由CRM用户Cookie会话+CSRF（兼容用户JWT）认证，必须显式传X-Project-Id，只有本组织已获分配项目的project_admin及本组织admin可访问；服务凭证不可管理凭证。端点、请求与响应以同一OpenAPI的GlobalSiteC2*组件和operation.servers为准，不修改已有Integration端点定义。

GlobalSite预设包含products:read/company:read/playbook:read/knowledge:read/customers:upsert/inquiries:write/outcomes:read。用户已确认保留inquiries:write预选并标记待开放；新增可签发保留scope不等于实现S1询盘草案，UI和设置API必须明确available:false。默认脚本签发权限仍保留C1之前的五项，不自动扩大。

创建/轮换只在本次响应返回明文（private,no-store），永不落库/审计/列表或浏览器持久存储。轮换保持credentialId，生成新令牌，在同一记录仅保存当前/上一个SHA256哈希和旧令牌截止时间；默认UI宽限24小时，0立即失效，最长7天。过期以服务端时钟判断，不依赖清理任务；宽限期中不再次宽限轮换，避免提前作废承诺。脚本默认0兼容既有即时轮换；吊销立即使新旧令牌全部失效。

套餐每项目有效凭证默认starter=3、growth=10、enterprise=50，可通过Organization.limits.integrationCredentialsPerProject覆盖。已过期/吊销不占位；轮换同一记录不额外占位。唯一多键seatKeys索引原子占据所有绑定项目的席位，保护并发创建；已有无seatKeys凭证计入既有占用且保持可用。新建有组织项目凭证必须同组织；无组织历史项目仅保留受控旧脚本行为，后台不开放。索引部署与验证见C2交付文档。所有创建/轮换/吊销（含脚本）调用同一服务并记录不含token/hash的审计元数据。

## J1 / C3 正式覆盖（2026-11-06）

本次批准的询盘接口为 POST /api/integrations/v1/inquiries（inquiries:write），替代 S1 建议的 customers/upsert + /globalsite/inquiries 两步交接；旧草案不作为可调用别名。C2 的保留权限现正式可用，原有 C1/C2/legacy 契约结构保持冻结。新机器定义、可空字段及边界以 GlobalSiteC3* 为准，单独冻结 globalsite-c3.json。

新增独立询盘记录，内部复用客户补空字段/邮箱查重规则；新联系人创建 pending Customer，便于直接使用既有写信、业务员归属和 outcomes，不自动转换为 Prospect。邮箱精确匹配；非公共企业域名只在唯一候选时合并，公共邮箱与歧义不猜测。已有客户负责人/阶段/外部引用不变。新客户分配项目创建者（当前活跃且同组织/有项目权限），否则项目管理员，缺有效管理员则保持未分配并提示通知；站内负责人通知与询盘同事务持久化，不自动发送营销邮件。

幂等键必填，IntegrationIdempotency 保留首次结果，业务唯一键 (organizationId,projectId,sourceSystem,externalInquiryId) 跨凭证轮换/重试去重；同业务ID修改内容409。附件临时下载地址与到期时间属于运输元数据，不参与业务散列，其余内容严格一致；首次地址供后台下载，幂等重放不更新它，过期显示附件失败而不撤销询盘。附件最多3个×2MiB；异步下载、校验MIME/大小/SHA256后存CRM私有storage，失败仅标记失败；不能读取任意内网/跟随重定向。传输URL加密存储，不返回浏览器、不进日志。附件签名失效保留失败状态，原询盘不丢失。

回复入口使用CRM用户权限、EmailSuppression及既有 sendLetter(saveAsDraft:true)，仅生成可审核草稿，不触发发送。无AI配置时使用不编造价格/交期/认证的确认需求模板。客户列表按 globalsite 来源筛选；域名合并可能与档案邮箱不同，草稿收件人始终使用本条询盘邮箱。

S7 每15分钟/手动拉C1产品与资料，保持空页水位；本地人工修改或已确认事实不覆盖，CRM更新进入待审核差异。产品归档只标记来源状态；本站保留数据并提示审核。询盘先在本站存档，独立持久投递/指数退避，401/403暂停连接，断连停止后续派发；重新连接同项目才恢复，换项目新建连接。每5分钟轮询已有 outcomes，按eventId去重、仅关联已保存customerId；C4 Webhook仍未实现。不得调用GS-D01中的旧状态/报价接口。
