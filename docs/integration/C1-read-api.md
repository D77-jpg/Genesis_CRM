# C1 只读同步（2026-11-05）

本任务覆盖并细化 S1 建议编号；新增路径以 integration-v1.openapi.yaml 为准。S1 `/globalsite/*` 六项草案原样保留、仍未实现，不是新接口的别名；GlobalSite 后续任务固定本次合并 commit 后实现调用，本任务不修改其代码。GS-D01 仍按已批准方案登记并避用。

## 数据来源和公开边界

产品读取现有 Product，白名单输出 sku/name/category/description/status/specs（无 notes）/moq/leadTime，稳定 ID 为 ObjectId，更新时间取源记录和公开补充资料的较晚值。材质、应用、认证、图片从 IntegrationPublicResource 的人工审核补充资料取得；原产品没有这些独立字段，不从描述推断。公司读取 Project.companyName/website/industry；地址、公开电话/邮箱、成立年份、产能、认证从审核补充资料取得，不回退到全局默认公司或发送邮箱。缺失文本/数字为 null，集合为 []。

话术只返回人工审核并标记 public 的品牌定位、卖点和目标市场；标记 internal 或没有标记的内容不返回，不读取原始 segments/preferences 中的销售策略或默认行业话术。知识摘要须单独人工审核发布，关联现有 KnowledgeDocument，仅输出公开标题/摘要/ID/更新时间；不返回原文件、文件名、解析正文和 blob。源记录删除/跨项目/跨组织即不可读；知识摘要撤销保留 deleted:true 墓碑（标题/摘要为空）。未配置任何公开资料时，产品/公司可返回已有安全字段，话术/知识为空列表。

## 同步和限流

GET /products、/company-profile、/playbook、/knowledge/summaries 均使用 updatedSince（UTC，包含边界）、limit（1..100，默认50）、签名 cursor；公司/话术最多一条。产品详情 GET /products/{id} 按需补拉，图片辅助下载 GET /products/{id}/images/{imageId}。四项新增 scope 为 products:read/company:read/playbook:read/knowledge:read；旧凭证不会增加权限，需管理员重新签发。

游标签名绑定凭证、组织、项目、资源、起始时间和固定批次上界及最后的 (updatedAt,id)，7 天到期；分页中不得修改 updatedSince。列表提供 syncUntil，所有页成功后才保存；下一轮回退 1 秒重叠并以 id+updatedAt 去重。并发源修改不提供历史数据库快照，移出当前上界的记录由下一轮拉取；定期全量对账处理删除、归档和权限撤销，不因单页缺失就删除本地数据。游标过期/篡改/范围变化返回 422，不无限重试。签名图片每次拉取新 URL，5 分钟过期，不作为站点永久图片。

所有集成端点共用持久限流：每个凭证、每 UTC 分钟最多120次（绑定项目合计，包含图片；Mongo 原子计数跨 API 实例共享），429 返回 Retry-After。项目和 scope 校验先于计数，未授权仍分别返回401/403/404；不改变旧成功业务数据。旧接口仍按原契约冻结，仅新增防护状态。

## 运维与迁移

新增租户模型 IntegrationPublicResource 和基础设施模型 IntegrationRateLimit，不重命名旧集合、不修改旧数据。上线前运行 `npm run integration:public -- indexes` 建立新唯一/分页/TTL索引；可重复执行。公开资料由同一 CLI 的 publish/revoke 命令维护，publish 必须带 --reviewed，文件内容按类型严格校验，源 ID 必须存在于指定项目/组织。CLI 是受控服务器运维入口，不对服务凭证开放写权限；新数据默认不公开，禁止复制整个原始文档到 payload。

图片只能关联 storage.service 中现存的 PNG/JPEG/WebP，最大10MiB，发布时校验文件签名/长度/hash，并记录稳定 ID；URL 只含产品/图片 ID、expires/signature，不含内部 key/path。下载复用 getObject（local/S3），重新校验当前公开记录和内容 hash；撤销公开/凭证立即失效，已过期签名404。仅允许 PUBLIC_BASE_URL 的 HTTPS 公网来源（开发允许本地 HTTP），未配置 HTTPS 时产品仍可同步但不签发可下载图片。签名使用 JWT_SECRET 域隔离派生密钥，无新增环境变量；更换密钥会使现有短期 URL/游标失效。

## 冻结

历史 SHA 和所有原 paths/components 保持不变；S1 草案继续受保护。本次六项 C1 操作和相关组件冻结到 snapshots/globalsite-c1.json，并由指纹和深等比较双重保护。真实 HTTP 测试验证结构/空值/权限/增量/游标/签名过期与共享限流。GlobalSite 不在此任务实现调用方；正式接入需以本次批准契约校验请求与响应，不能调用 S1 未实现的草案。

快照指纹按 LF 换行规范化计算，避免 Windows 自动换行转换造成误报；原始历史冻结指纹仍按不可变 git 对象原始字节验证。

## 操作示例（占位 ID、虚构内容）

在 server 目录执行，先建立索引，再按需要发布审核后的补充资料。下面的占位符替换为当前组织/项目的真实内部 ID；不要在工单、日志或 Git 中放实际数据文件/凭证。命令只输出固定成功/失败信息，不输出 payload。

```sh
npm run integration:public -- indexes
npm run integration:public -- publish --project <projectId> --kind company --source <projectId> --file <reviewed-json-file> --reviewed
npm run integration:public -- publish --project <projectId> --kind product --source <productId> --file <reviewed-json-file> --reviewed
npm run integration:public -- publish --project <projectId> --kind playbook --source <projectPlaybookId> --file <reviewed-json-file> --reviewed
npm run integration:public -- publish --project <projectId> --kind knowledge --source <knowledgeDocumentId> --file <reviewed-json-file> --reviewed
npm run integration:public -- revoke --project <projectId> --kind knowledge --source <knowledgeDocumentId>
```

各类文件只允许下列字段（不填写的可省略）：

```json
{
  "material": "Reviewed material",
  "application": "Reviewed application",
  "certifications": [],
  "images": [{"key": "existing-reviewed-image.png"}]
}
```

上面为 product；图片 key 仅运维命令读取，接口不会返回。company 文件允许 address/phone/email/foundedYear/capacity/certifications；不支持擅自覆盖现有项目名称。knowledge 文件只允许 title/summary（均必填）。playbook 文件示例：

```json
{
  "brandPositioning": {"value": "Reviewed positioning", "visibility": "public"},
  "sellingPoints": [{"value": "Reviewed selling point", "visibility": "public"}],
  "targetMarkets": [{"value": "Internal target", "visibility": "internal"}]
}
```

服务器运维账号本身具有数据库管理权限，必须在可信环境运行；CLI 不提供给第三方凭证。未带 --reviewed、源跨组织/项目、未知字段、未标记可见性的卖点或非法图片均拒绝。重发同一图片内容沿用稳定 imageId；替换内容生成新 imageId。公司/产品补充资料撤销后回到现有安全字段及 null/[]，知识撤销输出墓碑。旧无组织项目不会被 C1 自动认领，须先通过既有租户迁移流程完成归属。

## 已知边界

本次没有公开资料管理 UI，采用受控 CLI。没有自动提炼原文、补造公司事实或从销售话术推断目标市场。列表是有上界的增量扫描，并非历史事务快照；需周期性全量对账。产品聚合借助公开记录索引、每页最多100及5秒执行上限防止长查询；超大目录需后续基于实测规模增加物化同步索引，不能通过提高限流上限代替容量验证。生产需事先部署新索引并配置现有 PUBLIC_BASE_URL 的公网 HTTPS；本任务不连接或迁移生产业务数据库，不新增环境变量。
