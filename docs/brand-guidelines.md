# GlobalCRM 品牌与命名规范

## 1. 规范名称

| 场景 | 写法 |
| --- | --- |
| 产品名 | **GlobalCRM** |
| 全大写字标 | **GLOBALCRM** |
| 中文描述 | 外贸客户开发、邮件触达与成交管理平台 |
| 英文描述 | Cross-border B2B sales CRM |

统一使用 `GlobalCRM`，不要写成 `Global CRM`、`Globalcrm` 或 `GlobalCRM_`。代码中优先引用：

- 前端：`web/src/constants/brand.ts`
- 后端：`server/src/constants/brand.ts`

## 2. 与项目品牌的关系

`GlobalCRM` 是产品/平台品牌；`Genesis Bags`、`IRONHUE`、`VELATURO` 等是平台内的项目品牌。项目名称、项目 Logo、发件签名和项目话术继续由 Project / project-profile 维护，不能被产品品牌替换。

因此以下内容保留现状：

- `genesisbags.com`、`sales@genesisbags.com` 等项目联系方式；
- `Genesis (Xiamen) Bags Co., Ltd.` 等项目签名；
- `/api/brand/genesis-logo.png` 等 Genesis 项目 Logo 资源；
- `Genesis Bags` 项目种子数据与验收样本。

## 3. 有意保留的旧技术标识

品牌切换不应破坏已有会话、数据和外部集成。以下标识暂不随品牌改名，后续如要迁移，必须单独做兼容/迁移方案：

- MongoDB 默认库名 `cdlm`；
- Cookie 名、`localStorage` 的 `cdlm-*` 键；
- 旧部署的 `GENESIS_HTTP_PORT`（Compose 仍把它作为 `GLOBALCRM_HTTP_PORT` 的回退值）；
- `genesis-crm-unsubscribe` 退订 token 的回退密钥；
- Integration API v1 的契约名、冻结哈希与 `Genesis_CRM` 历史兼容标识；
- 历史验收文档中的旧仓库名（仅作为当时基线记录保留）；当前服务器目录与 Git 仓库名已统一为 `GlobalCRM`。

## 4. 对外联系信息

当前法律文本仍使用 `support@genesisgroup.cn`、`privacy@genesisgroup.cn` 等既有运营邮箱，避免在 `GlobalCRM` 域名/邮箱尚未启用前制造无效联系方式。新域名确定后，再统一替换法律文本、价格页和帮助页中的联系地址。
