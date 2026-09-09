# Customer Dev Letter Manager（客户开发信管理工具）

面向外贸 / B2B 销售团队的**基础客户 CRM 与开发信管理工具**：Excel 批量导入客户 → 客户分级 / 优先级 / 销售状态 / 标签 / 负责人 / 来源 → 记录客户需求与多渠道联系方式 → 富文本开发信（支持占位符个性化，可从模板中心一键带入）→ 发送并自动归档到客户名下 → 跟进记录（可增改删）与客户 Timeline → 设置下一次跟进 → 客户附件集中存档 → **报价单管理（多币种 / 产品明细自动核算 / 状态流转 / 客户状态联动）** → Dashboard 销售工作区提醒今日任务，覆盖「导入 → 开发 → 跟进 → 报价 → 谈判 → 成交 / 流失」的完整销售闭环。

邮件发送默认为 **mock 模式**（不真实投递，但完整落库），配置 SMTP 环境变量后自动切换为真实发送，无需改动任何代码。

---

## 目录

- [技术栈](#技术栈)
- [功能清单](#功能清单)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
  - [1. 环境要求](#1-环境要求)
  - [2. 安装依赖](#2-安装依赖)
  - [3. 配置环境变量](#3-配置环境变量)
  - [4. 启动 MongoDB](#4-启动-mongodb)
  - [5. 初始化演示数据](#5-初始化演示数据)
  - [6. 启动前后端](#6-启动前后端)
- [生产构建与部署](#生产构建与部署)
- [脚本速查](#脚本速查)
- [用户与数据权限](#用户与数据权限)
- [API 参考](#api-参考)
- [开发信占位符](#开发信占位符)
- [Excel 导入说明](#excel-导入说明)
- [从 mock 切换到真实 SMTP](#从-mock-切换到真实-smtp)
- [常见问题排查](#常见问题排查)

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端框架 | **Vite 6 + React 18.3 + TypeScript 5.7** |
| UI | **Tailwind CSS 3.4 + shadcn/ui**（基于 Radix UI 手工封装，含暗黑模式） |
| 状态管理 | **Zustand 5**（分域 store：auth / customer / letter / meta / ui / followup / attachment / quotation / template / user） |
| 富文本 | **React Quill 2** |
| Excel | **xlsx（SheetJS）** 前端解析 + 后端导出 |
| 路由 / 表单 / 校验 | React Router 6 · react-hook-form · zod |
| 后端 | **Node.js + Express 4.21 + TypeScript** |
| 数据库 | **MongoDB + Mongoose 8** |
| 鉴权 | JWT（jsonwebtoken）+ bcryptjs；`requireAuth`（每请求查库校验启用态 + 实时角色，停用 / 删除即时失效）/ `requireRole` 双守卫 + 严格分配制数据隔离 |
| 邮件 | nodemailer（mock / smtp 双通道） |
| 其他 | helmet · cors · compression · express-rate-limit · morgan · sonner · date-fns |

> **关于 Next.js 15**：原始需求提到 Next.js 15 App Router，但 App Router 强制要求 React 19，与「React 18 + React Quill」不兼容（React Quill 2 依赖 React 18 的 `findDOMNode` 生态，在 19 下会崩溃）。因此前端改用 **Vite + React 18**，其余技术栈完全按需求实现。

---

## 功能清单

### 客户管理

- ✅ Excel 批量导入：**自动识别中英文表头 + 可视化列映射 + 逐行校验 + 重复邮箱策略（跳过 / 覆盖更新）**
- ✅ 响应式列表：桌面端语义化表格（可排序多列）+ 移动端卡片列表
- ✅ 搜索（姓名 / 公司 / 邮箱 / 手机 / 行业，防抖）
- ✅ 多维筛选：**销售状态（8 种）** · 行业 · 等级 · **来源（leadSource）** · **优先级（High / Medium / Low）** · 有无邮箱 · **标签** · **负责人（含「未分配」）** · **跟进时间（今天 / 已逾期 / 未来）**
- ✅ **8 种销售流程状态**：待开发 → 已联系 → 已回复 → 有意向 → 报价中 → 谈判中 → 已成交 / 已流失；每种状态用不同色徽章做「明显但简洁」的区分（石板灰 / 蓝 / 青 / 琥珀 / 橙 / 紫 / 翠绿 / 玫红）
- ✅ **批量操作（均带确认弹窗）**：批量改状态 · 批量加 / 删标签 · 批量分配 / 清除负责人 · 批量设置 / 清除下一次跟进时间 · 批量删除
- ✅ 导出 Excel（服务端忽略分页，导出当前筛选条件下的全部结果）、下载导入模板
- ✅ 单条删除（含开发信级联删除提示）

### 客户详情

- ✅ 完整档案（公司 / 邮箱 / 手机 / 职位 / 行业 / 国家 / 官网 / 地址 / 等级 / **优先级** / **来源** / 备注）+ 就地编辑**状态 / 标签 / 负责人 / 下一次跟进时间**（跟进逾期时顶部红字告警）
- ✅ **联系方式区**：Email（`mailto`）· 电话（`tel:`）· WhatsApp（`https://wa.me/`）· Skype · LinkedIn · Facebook · Instagram；存完整 URL 才可点击打开，仅用户名 / ID 时显示纯文本、不强行拼接错误链接
- ✅ **客户需求区**：感兴趣产品 / 产品型号 / 产品分类 / 预计采购数量 / 目标价格 / MOQ / 需求备注，直接内嵌在客户档案（第一版不建独立产品表）
- ✅ **客户附件区**：上传 / 图片预览 / 下载 / 删除，展示文件名 · 类型 · 大小 · 上传时间（详见「客户附件」小节）
- ✅ **客户动态**双页签：
  - **跟进记录**：新增 / **编辑** / 查看历史 / 删除错误记录，最新记录置顶高亮
  - **客户动态（Timeline）**：客户创建 → 发送开发信 → 状态变化 → 跟进 → 修改下次跟进时间 → 报价单创建 / 状态变化，按时间倒序聚合，一眼看清「之前发生过什么、最近一次联系、下一步做什么」
- ✅ **报价单区（V2）**：为该客户创建 / 编辑 / 查看 / 改状态 / 删除报价单，产品明细动态增删、行金额与总额即时核算（后端二次核算为准），报价事件汇入上方 Timeline（详见「报价管理」小节）
- ✅ 开发信历史表格（主题 / 状态 / 通道 / 时间），支持**查看（渲染 HTML）· 复制（主题 + 纯文本正文）· 删除 · 重新发送**
- ✅ 支持 `#letters` 锚点，从列表页的开发信徽章点进来会自动滚动定位

### 跟进记录

- ✅ 每条记录含：跟进时间 · 跟进方式 · 跟进内容 · 跟进结果 · 下一次跟进时间
- ✅ 跟进方式：邮件 / WhatsApp / 电话 / 在线聊天 / 其他
- ✅ 跟进结果：无回复 / 已回复 / 有兴趣 / 报价 / 谈判 / 成交 / 暂无需求 / 其他
- ✅ 新增跟进时可同步回写客户的「下一次跟进时间」，并在 Timeline 留痕
- ✅ 跟进记录支持**编辑**（复用新增表单，编辑后立即刷新列表）；修改「下一次跟进时间」同样同步回写客户主档，编辑 / 删除受数据隔离约束（越权 404）

### 客户来源与优先级

- ✅ **来源（leadSource）** 规范化：客户表单改为下拉选择，内置 `Excel Import / Website / Alibaba / Made-in-China / Google / Facebook / LinkedIn / WhatsApp / Exhibition / Referral / Existing Customer / Other`
- ✅ 客户列表支持按**来源**筛选；Excel 导入遇到未知来源值（如 `Dubai Exhibition`）**原样保留、不报错**，兼容历史自定义数据
- ✅ **优先级（Priority）**：`High / Medium / Low`，新建客户默认 `Medium`，列表支持按优先级筛选
- ✅ 优先级与**客户等级（Grade A / B / C）是两个独立维度**，可任意组合（如 A 级 + Low Priority）：Grade 表示客户价值，Priority 表示当前跟进紧急程度
- ℹ️ 数据溯源字段 `source`（manual / excel / seed）保持不变，业务「来源」由新字段 `leadSource` 承载，二者互不干扰

### 客户需求与联系方式

- ✅ **需求信息**（内嵌客户档案，第一版不建独立产品表）：感兴趣产品 · 产品型号 · 产品分类 · 预计采购数量 · 目标价格 · MOQ · 需求备注（多行文本）
- ✅ **多渠道联系方式**：WhatsApp · Skype · LinkedIn · Facebook · Instagram（Email / 电话沿用原有字段）
- ✅ 以上字段在**创建 / 编辑客户表单、客户详情页、Excel 导入导出**全链路支持，且全部 optional——旧客户没有这些字段也能正常读取与编辑

### 客户附件

- ✅ 每个客户可上传附件集中存档：产品图片 · 需求 PDF · 报价单 · PI · PO · 合同 · 公司资料等
- ✅ 展示**文件名 · 类型 · 大小 · 上传时间**；图片可**直接预览**，PDF / Excel / Word 等至少支持**下载**；支持删除（同时清理磁盘文件）
- ✅ 上传走 **base64 JSON**（复用现有 `express.json` 通道，未引入 multer / 对象存储），单文件默认上限 **15 MB**（`MAX_ATTACHMENT_SIZE`），请求体上限已提到 **25 MB**
- ✅ 文件落盘到本地 `server/uploads/`（`UPLOAD_DIR`，已在 `.gitignore` 忽略）；下载经**鉴权接口**并按客户归属校验，业务员只能操作自己客户的附件，越权一律 404

### 报价管理（V2）

- ✅ **客户详情页报价单区**：从当前客户直接创建报价（无需再选客户），列表展示**编号 / 标题 / 总金额 / 币种 / 状态 / 有效期 / 创建时间**，支持新增 / 编辑 / 查看详情 / 改状态 / 删除，含 loading / empty / error 态
- ✅ **产品明细动态行**：可增删多个产品行（产品名称 / 型号 / 数量 / 单价），**每行金额与报价总额前端即时计算显示**，提交后**后端再核算一次为准**（前端传入的金额字段会被后端剥离重算，杜绝篡改）
- ✅ **完整报价字段**：编号 / 标题 / 产品明细 / 币种（12 种）/ MOQ / 付款方式 / 交期 / 有效期 / 备注 / 状态
- ✅ **6 种报价状态**：草稿 / 已发送 / 谈判中 / 已接受 / 已拒绝 / 已过期（`draft / sent / negotiating / accepted / rejected / expired`），各用不同色徽章区分
- ✅ **编号唯一防重**：`quotationNo` 留空由后端按 `QT-YYYYMMDD-NNN` 规则自动生成，用户自定义编号统一大写归一，重复返回 `409` 并在表单字段级提示（不引入任何额外编号依赖）
- ✅ **显式客户状态联动（不擅自改状态）**：仅在「新增报价」与「改状态」时提供「同时把客户标记为报价中」开关，且后端只在语义可升级时推进（不降级已报价中 / 谈判中 / 成交 / 流失的客户）；**普通编辑报价绝不改动客户销售状态**
- ✅ **汇入客户 Timeline**：报价创建与状态变化派生为客户动态事件（`type: 'quotation'`，沿用现有 Timeline 结构，不另建一套）
- ✅ **随客户隔离 + 级联清理**：业务员只能操作自己名下客户的报价，越权一律 404；删除客户会级联删除其全部报价单
- ℹ️ 报价单为全新独立集合（`quotations`），不改动任何既有客户 / 开发信 / 跟进 / 附件数据结构，旧库无需迁移即可直接使用；本期不含 PDF / PI / 合同导出（V3 规划）

### 开发信模板中心

- ✅ 模板 CRUD + **一键复制**，按分类管理：首次开发 / 产品推荐 / 报价 / 跟进 / 节日 / 其他
- ✅ 每个模板含：名称 · 主题 · 正文（富文本）· 分类
- ✅ **复用现有发送编辑器**（React Quill + 16 个占位符 + 所见即所得预览），发送开发信时可从模板一键带入主题与正文，不另造一套编辑器

### 发送开发信

- ✅ 模态框内含客户信息预览卡
- ✅ React Quill 富文本 + **一键插入 16 个占位符**
- ✅ 邮件主题（同样支持占位符）
- ✅ **可从模板中心选择模板带入**，再按客户微调（连续发信时会记住上次用过的模板）
- ✅ **所见即所得预览**：调用后端 `/letters/preview` 渲染真实结果，占位符缺字段时前后端使用同一套 fallback
- ✅ 收件人可覆盖（客户无邮箱时手动填写）
- ✅ 可选「发送后标记为已联系」（待开发客户默认开启）
- ✅ 发送后自动落库、更新客户 `lastContactAt` / `letterCount` / `status`，并就地刷新详情页

### Dashboard 销售工作区

- ✅ 顶部 8 张统计卡：客户总数 / 待开发 / 已开发 / 开发率 / 开发信总数 / 近 7 天发送 / 发送失败 / 当前通道
- ✅ **销售工作区**：5 个可点击指标（今日待跟进 / 已逾期 / 即将跟进 / 今日发送开发信 / 今日新增客户）+ 3 张清单（待跟进客户·逾期优先红字 / 最近跟进 / 最近开发客户），点进去直达对应客户或自动套用列表筛选
- ✅ **销售漏斗**：8 种销售状态各自的客户数量与占比
- ✅ 行业分布 / 等级分布 / 近 14 天发送趋势（纯 CSS 图表，零图表库依赖）+ 最近开发信

### 用户管理与数据权限（严格分配制）

- ✅ **两种角色**：管理员（admin）与业务员（user）；管理员在「用户管理」页管理账号（列表 + 新建 + 编辑资料 + 重置密码 + 停用 / 启用 + 删除）
- ✅ **严格分配制数据隔离**：业务员登录后**只能看到并操作「负责人 = 自己」的客户**；未分配客户（无负责人）**仅管理员可见**，需由管理员分配后才进入业务员视野
- ✅ **业务员可自建客户，自动归属本人**：手工新建或 Excel 导入的客户 `ownerId` 自动设为自己；管理员可建档并分配给任意人
- ✅ **越权一律 404**：业务员访问他人客户（详情 / 编辑 / 删除 / 发信 / 跟进 / **附件** / **报价单**）返回 404，不泄露客户是否存在
- ✅ **从属资源随客户隔离**：开发信记录、跟进记录、**客户附件**、**报价单**、Timeline、Dashboard 统计与销售工作区都按可见客户范围收敛
- ✅ **管理员专属接口双重防护**：用户管理（`/api/users`）、负责人名单（`/api/customers/owners`）、批量分配负责人（`/api/customers/bulk/owner`）均 `requireRole('admin')`；前端对应 UI（负责人筛选 / 列 / 批量分配 / 用户管理入口）也按角色隐藏
- ✅ **模板全局共享**：开发信模板对所有登录用户可读写（团队共用话术库）
- ✅ **账号启用状态**：每个账号有 `active`（启用）/ `disabled`（停用）状态；停用后无法登录，且**已签发的 token 立即失效**（`requireAuth` 每次请求查库校验，返回 `401` 触发前端自动登出）
- ✅ **删除转未分配**：删除账号会先把它名下客户的 `ownerId` 置空（转为「未分配」回到管理员池）再删除账号，不产生悬空归属
- ✅ **自我保护**：管理员不能停用 / 删除 / 降级「自己」，也不能移除「最后一个启用中的管理员」，避免把自己锁在系统外

### 其他

- ✅ 开发信记录页（跨客户全量检索 + 状态 / 通道筛选 + 批量删除 + 导出）
- ✅ **旧数据兼容迁移**：升级前的「待开发 / 已开发」两态在服务启动时自动映射到新的 8 态；标签 / 负责人 / 跟进时间 / **来源 / 优先级 / 需求信息 / 联系渠道 / 附件**等新增字段对旧数据一律 optional（优先级缺省为 `Medium`），不破坏既有客户与邮件历史、无需重新导入
- ✅ 深色模式（跟随系统 / 手动切换，带防 FOUC 内联脚本）
- ✅ 完整响应式（390px → 4K）
- ✅ 表单校验（必填、邮箱格式、URL 格式）
- ✅ 登录：管理员 `admin` / `password`（首次启动自动创建）；业务员账号由管理员在「用户管理」页创建
- ✅ 全局错误边界、请求竞态处理、乐观 UI 回滚、Toast 友好提示

---

## 项目结构

```
Genesis/
├── README.md                       # 本文件
├── package.json                    # 根：一键安装 / 一键启动（concurrently）
├── .gitignore
├── scripts/
│   └── smoke-test.ps1              # 112 组后端 API 冒烟测试（含数据隔离 + 账号管理 + CRM 基础功能 + 报价管理回归，PowerShell）
│
├── server/                         # ── 后端：Express + MongoDB ──
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example                # 环境变量样例（复制为 .env）
│   ├── .env
│   └── src/
│       ├── index.ts                # 进程入口：连库 → 启动 → 优雅关闭
│       ├── app.ts                  # Express 应用装配（安全 / 压缩 / 日志 / 路由 / 404 / 错误处理）
│       ├── config/
│       │   ├── env.ts              # 环境变量解析 + zod 校验（启动即失败；含 UPLOAD_DIR / MAX_ATTACHMENT_SIZE）
│       │   ├── db.ts               # Mongoose 连接（含重试与事件日志）
│       │   └── logger.ts           # 分级日志（info / warn / error / debug）
│       ├── constants/
│       │   └── index.ts            # 枚举（8 销售状态 / 跟进方式 / 跟进结果 / 模板分类 / 活动类型 / 客户来源 /
│       │                           #   优先级 / 6 报价状态 / 12 报价币种）、状态标签与配色、16 个开发信占位符、Excel 状态别名映射
│       ├── models/
│       │   ├── Customer.ts         # 客户模型（partial unique 邮箱索引、letterCount 反范式、tags / ownerId /
│       │   │                       #   nextFollowUpAt、leadSource / priority、需求信息、联系渠道等 CRM 字段）
│       │   ├── CustomerAttachment.ts # 客户附件（customerId / originalName / filename / mimeType / size / path / uploadedBy）
│       │   ├── DevelopmentLetter.ts# 开发信模型（customerId / subject / content / sentAt / status）
│       │   ├── FollowUp.ts         # 跟进记录模型（method / result / content / followUpAt / nextFollowUpAt）
│       │   ├── CustomerEvent.ts    # 客户活动事件（状态变化 / 跟进时间变化，供 Timeline 聚合）
│       │   ├── Quotation.ts        # 报价单（V2）：quotationNo 唯一 / customerId / items 嵌入明细 / currency /
│       │   │                       #   totalAmount / validityDate / status / createdBy；pre('validate') 钩子重算金额
│       │   ├── LetterTemplate.ts   # 开发信模板（name / subject / content / category）
│       │   ├── User.ts             # 用户模型（bcrypt 哈希、role: admin / user）
│       │   └── index.ts
│       ├── middleware/
│       │   ├── auth.middleware.ts  # JWT 校验（requireAuth，查库校验启用态 + 实时角色）+ 角色守卫（requireRole）
│       │   ├── validate.middleware.ts # zod 校验（body / query / params，错误自动去重）
│       │   └── error.middleware.ts # 404 + 统一错误出口（含 Mongoose / JWT 错误翻译）
│       ├── validators/
│       │   ├── common.ts           # 分页、ObjectId、排序等公共 schema
│       │   ├── auth.validator.ts
│       │   ├── customer.validator.ts # 含 8 状态 / 标签 / 负责人 / 跟进时间 / 来源 / 优先级筛选 + 批量操作 schema
│       │   ├── letter.validator.ts
│       │   ├── followup.validator.ts # 跟进记录创建 / 编辑（partial）/ 列表 / 参数校验
│       │   ├── attachment.validator.ts # 附件上传（base64）/ 参数校验
│       │   ├── quotation.validator.ts # 报价单（V2）创建 / 编辑 / 改状态 / 列表筛选 / 参数校验（金额字段不入 schema）
│       │   ├── template.validator.ts # 模板 CRUD 校验
│       │   └── user.validator.ts    # 用户创建校验（用户名 / 密码 / 角色）
│       ├── services/
│       │   ├── customer.service.ts # 列表 / 增删改 / 批量 / 导入 / 导出（可见范围 + 自动归属 + 越权校验 + 级联清附件 / 报价单）
│       │   ├── letter.service.ts   # 发送 / 重发 / 预览 / 历史 / 删除
│       │   ├── followup.service.ts # 跟进记录 CRUD（含编辑）+ 回写客户 nextFollowUpAt
│       │   ├── attachment.service.ts # 附件 base64 落盘 / 列表 / 鉴权下载 / 删除（含磁盘文件清理）
│       │   ├── quotation.service.ts # 报价单（V2）CRUD + 编号唯一生成 + 金额后端核算 + 状态联动 + 越权隔离
│       │   ├── timeline.service.ts # 聚合创建 / 开发信 / 跟进 / 活动事件 + 派生报价单事件为客户 Timeline
│       │   ├── template.service.ts # 开发信模板 CRUD + 复制
│       │   ├── stats.service.ts    # 仪表盘聚合（含销售漏斗 byStatus + 销售工作区 workspace）
│       │   ├── mailer.service.ts   # mock 与 smtp 双通道，统一返回投递结果
│       │   ├── excel.service.ts    # xlsx 导出（客户含来源/优先级/需求/联系渠道列 / 开发信 / 导入模板）
│       │   ├── auth.service.ts
│       │   └── user.service.ts     # 用户列表 / 创建（管理员专属，不含 passwordHash）
│       ├── controllers/
│       │   ├── customer.controller.ts # 含标签词汇表 / 负责人列表 / 批量操作
│       │   ├── letter.controller.ts
│       │   ├── followup.controller.ts # 跟进记录（含编辑）+ 客户 Timeline
│       │   ├── attachment.controller.ts # 附件列表 / 上传 / 鉴权下载 / 删除
│       │   ├── quotation.controller.ts # 报价单（V2）列表 / 详情 / 创建 / 编辑 / 改状态 / 删除
│       │   ├── template.controller.ts
│       │   ├── stats.controller.ts # 健康检查 + 仪表盘聚合
│       │   ├── auth.controller.ts
│       │   └── user.controller.ts  # 用户列表 / 创建 / 编辑 / 重置密码 / 停用启用 / 删除（管理员专属）
│       ├── routes/
│       │   ├── index.ts            # /health、/meta（下发枚举与占位符，含报价状态 / 币种）、挂载各资源路由（含 /users、/quotations）
│       │   ├── customer.routes.ts  # 客户 + 批量 + 标签/负责人 + 嵌套跟进（含 PUT 编辑）/ Timeline / 附件 / 报价单（owners、bulk/owner 限管理员）
│       │   ├── letter.routes.ts
│       │   ├── quotation.routes.ts # 报价单（V2）顶层：列表（多条件筛选）/ 创建 / 详情
│       │   ├── template.routes.ts  # 开发信模板 CRUD + 复制
│       │   ├── user.routes.ts      # 用户管理：列表 / 创建 / 编辑 / 重置密码 / 停用启用 / 删除（整体 requireRole('admin')）
│       │   └── auth.routes.ts      # 登录带限流（防暴力破解）
│       ├── utils/
│       │   ├── ApiError.ts         # 带 HTTP 状态码与业务码的错误类
│       │   ├── access.ts           # 数据访问控制（customerScope / assertCustomerAccess / customerRefScope）
│       │   ├── asyncHandler.ts     # 异步路由包装，免写 try/catch
│       │   ├── pagination.ts       # 分页元数据与统一响应体
│       │   └── text.ts             # HTML → 纯文本、占位符渲染
│       ├── types/
│       │   ├── api.ts              # 响应 / 分页 / 导入结果等共享类型
│       │   └── express.d.ts        # 扩展 Request.user
│       └── scripts/
│           └── seed.ts             # 演示数据：8 客户覆盖全 8 状态 + 跟进 + Timeline + 6 模板（--reset 先清空）
│
└── web/                            # ── 前端：Vite + React 18 ──
    ├── package.json
    ├── vite.config.ts              # /api 代理到 :5000、路径别名 @/*、分包策略
    ├── tsconfig.json
    ├── tailwind.config.ts          # 暗黑模式、语义色（status-pending / developed / failed）
    ├── postcss.config.js
    ├── components.json             # shadcn 配置
    ├── eslint.config.js            # ESLint 9 flat config
    ├── index.html                  # 含防 FOUC 主题内联脚本
    ├── .env.example
    ├── .env
    └── src/
        ├── main.tsx                # 挂载入口
        ├── App.tsx                 # TooltipProvider + RouterProvider + Toaster
        ├── index.css               # Tailwind 层 + CSS 变量主题 + 滚动条 / 富文本样式
        ├── vite-env.d.ts
        ├── router/
        │   ├── index.tsx           # createBrowserRouter（8 个页面全部懒加载）
        │   └── guards.tsx          # ScrollToTop / ProtectedRoute / GuestRoute / AdminRoute
        ├── pages/
        │   ├── login.tsx           # 登录页
        │   ├── dashboard.tsx       # 数据看板 + 销售工作区 + 销售漏斗
        │   ├── customers.tsx       # 客户管理（多维筛选 + 批量操作）
        │   ├── customer-detail.tsx # 客户详情（基础信息 / 联系方式 / 客户需求 / 报价单 / 附件）+ 跟进 / Timeline / 开发信历史
        │   ├── templates.tsx       # 开发信模板中心
        │   ├── letters.tsx         # 开发信记录
        │   ├── users.tsx           # 用户管理（仅管理员：列表 + 状态徽章 + 行操作菜单）
        │   └── not-found.tsx       # 404
        ├── components/
        │   ├── ui/                 # shadcn/ui 基础件（button / dialog / table / select /
        │   │                       #   checkbox / dropdown-menu / popover(含 Tooltip) / tabs /
        │   │                       #   switch / textarea / input / label / card(含 StatCard) /
        │   │                       #   badge / alert / alert-dialog / separator(含 Skeleton) / sonner）
        │   ├── layout/             # app-shell / sidebar / header / theme-toggle / user-menu
        │   ├── common/             # page-header / search-input / data-pagination / confirm-dialog /
        │   │                       #   empty-state(含 Error/NoResult) / status-badge / page-loader
        │   ├── customers/          # customer-table / customer-filters / customer-form-dialog /
        │   │                       #   bulk-actions-bar / bulk-action-dialog（批量确认）/
        │   │                       #   customer-activity（跟进 + Timeline 页签）/ customer-timeline /
        │   │                       #   follow-up-dialog（新增 / 编辑双模式）/ follow-up-list /
        │   │                       #   customer-attachments（上传 / 预览 / 下载 / 删除）/
        │   │                       #   customer-quotations（报价单区）/ quotation-list /
        │   │                       #   quotation-form-dialog（动态明细 + 即时金额）/ quotation-view-dialog（详情 / 改状态）/
        │   │                       #   import-dialog / column-mapper
        │   ├── dashboard/          # sales-funnel（销售漏斗）/ sales-workspace（销售工作区）
        │   ├── templates/          # template-list / template-form-dialog
        │   ├── letters/            # send-letter-dialog / letter-editor(Quill) / placeholder-bar /
        │                           #   letter-view-dialog / letter-history-table / letter-table
        │   └── users/              # user-form-dialog（新建 / 编辑双模式）+ reset-password-dialog（重置密码），仅管理员
        ├── store/                  # Zustand：auth / customer / letter / meta / ui / followup / attachment / quotation / template / user
        ├── hooks/                  # use-async（竞态 + 卸载安全）/ use-queries（数据订阅）/
        │                           #   use-debounce / use-ui（页面标题、主题）
        ├── lib/                    # api（axios 拦截器）/ excel（解析 + 列映射）/ placeholder /
        │                           #   download（Blob 下载）/ format（日期、首字母）/ validators / utils
        ├── constants/index.ts      # 路由、分页、状态标签、占位符（与后端 /meta 对齐）
        └── types/                  # models.ts / api.ts / index.ts
```

---

## 快速开始

### 1. 环境要求

| 依赖 | 版本 | 检查命令 |
| --- | --- | --- |
| Node.js | **>= 18.18**（推荐 20 / 22 LTS） | `node -v` |
| npm | >= 9 | `npm -v` |
| MongoDB | >= 6.0（Community 或 Atlas） | `mongod --version` |

### 2. 安装依赖

在**项目根目录**执行：

```bash
# 安装根依赖（concurrently，用于一键并行启动前后端）
npm install

# 安装 server 与 web 的依赖
npm run install:all
```

也可以分别安装：

```bash
cd server && npm install
cd ../web && npm install
```

### 3. 配置环境变量

**后端**（必需）：

```bash
cd server
copy .env.example .env      # Windows PowerShell / CMD
# cp .env.example .env      # macOS / Linux
```

`server/.env` 关键项：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5000` | 后端端口 |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/cdlm` | MongoDB 连接串 |
| `CORS_ORIGIN` | `http://localhost:5173,...` | 允许的前端来源，逗号分隔 |
| `JWT_SECRET` | 示例值 | **生产环境必须改成长随机串** |
| `JWT_EXPIRES_IN` | `7d` | Token 有效期 |
| `ADMIN_USERNAME` | `admin` | 首次启动自动创建的管理员 |
| `ADMIN_PASSWORD` | `password` | 同上 |
| `MAIL_TRANSPORT` | `mock` | `mock` = 模拟发送；`smtp` = 真实发送 |
| `MAIL_FROM` | `Genesis ... <sales@...>` | 发件人 |
| `SMTP_HOST/PORT/SECURE/USER/PASS` | 空 | 仅 `MAIL_TRANSPORT=smtp` 时需要 |
| `COMPANY_NAME` | `Genesis (Xiamen) Bags Co., Ltd.` | 占位符 `{{companyName}}` |
| `COMPANY_WEBSITE` | `https://www.genesisbags.com` | 占位符 `{{companyWebsite}}` |
| `COMPANY_MOQ` | `100 pcs` | 占位符 `{{moq}}` |
| `SENDER_NAME` | `Genesis Sales Team` | 占位符 `{{senderName}}` |
| `UPLOAD_DIR` | `server/uploads` | 客户附件本地存储目录（可选，有默认值；已在 `.gitignore` 忽略） |
| `MAX_ATTACHMENT_SIZE` | `15728640`（15 MB） | 单个客户附件大小上限（字节，可选）；请求体上限固定 25 MB |

**前端**（可选）：

```bash
cd web
copy .env.example .env
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | 走 Vite 代理，通常无需修改；跨域部署时改成完整地址，如 `http://localhost:5000/api` |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:5000` | 开发 / 预览代理目标，后端换端口时改这里 |
| `VITE_APP_TITLE` | `客户开发信管理工具` | 侧边栏顶部与浏览器标签标题 |
| `VITE_TOKEN_STORAGE_KEY` | `cdlm-token` | JWT 在 localStorage 中的键名 |

### 4. 启动 MongoDB

#### Windows

**方式 A：已装为系统服务（最常见）**

```powershell
# 查看服务状态
Get-Service MongoDB

# 启动 / 停止
net start MongoDB
net stop MongoDB
```

**方式 B：手动启动（绿色版 / 未注册服务）**

```powershell
# 先创建数据目录（只需一次）
mkdir C:\data\db

# 启动
mongod --dbpath C:\data\db --port 27017

# 若 mongod 不在 PATH，用绝对路径，例如：
& "D:\env\MongoDB\bin\mongod.exe" --dbpath "D:\env\MongoDB\data" --port 27017
```

**方式 C：注册为服务（一次性）**

```powershell
# 需要管理员权限的 PowerShell
mongod --config C:\mongodb\mongod.cfg --install
net start MongoDB
```

`C:\mongodb\mongod.cfg` 最小内容：

```yaml
systemLog:
  destination: file
  path: C:\mongodb\log\mongod.log
storage:
  dbPath: C:\mongodb\data
net:
  port: 27017
```

#### macOS

```bash
# Homebrew 安装（若尚未安装）
brew tap mongodb/brew
brew install mongodb-community

# 启动 / 停止
brew services start mongodb-community
brew services stop mongodb-community

# 或前台临时启动
mongod --dbpath /usr/local/var/mongodb
```

#### Linux (Ubuntu / Debian)

```bash
sudo systemctl start mongod
sudo systemctl enable mongod      # 开机自启
sudo systemctl status mongod
```

#### Docker（不想本地装 MongoDB 时）

```bash
docker run -d --name cdlm-mongo \
  -p 27017:27017 \
  -v cdlm-mongo-data:/data/db \
  mongo:7
```

**验证是否启动成功：**

```bash
mongosh --eval "db.runCommand({ ping: 1 })"
# 返回 { ok: 1 } 即正常
```

### 5. 初始化演示数据

```bash
# 在项目根目录
npm run seed
```

输出示例（日志格式为 `[时间] [级别] [作用域] 消息`）：

```
[2026-09-08T13:47:23.535Z] [INFO] [seed] 已创建客户: Ella Drake (Monarc Jewellery)
[2026-09-08T13:47:23.562Z] [INFO] [seed] 已创建客户: Marcus Chen (Lumen Fine Jewellery)
[2026-09-08T13:47:23.577Z] [INFO] [seed] 已创建客户: Amelia Hart (Wildflower Adornments)
[2026-09-08T13:47:23.591Z] [INFO] [seed] 已创建客户: Sarah Lindqvist (Nordic Silver Studio)
[2026-09-08T13:47:23.603Z] [INFO] [seed] 已创建客户: Tomás Ferreira (Aurum Atelier)
[2026-09-08T13:47:23.613Z] [INFO] [seed] 已创建客户: Priya Nair (Saffron Gems)
[2026-09-08T13:47:23.627Z] [INFO] [seed] 已创建客户: David Okafor (Lagos Luxe)
[2026-09-08T13:47:23.636Z] [INFO] [seed] 已创建客户: Hana Yamamoto (Sakura Pearl)
[2026-09-08T13:47:23.649Z] [INFO] [seed] ----------------------------------------------
[2026-09-08T13:47:23.649Z] [INFO] [seed] Seed 完成：新增客户 8（跳过 0），开发信 7，跟进记录 9，活动事件 11，模板 6
[2026-09-08T13:47:23.649Z] [INFO] [seed] 登录账号：admin / password
[2026-09-08T13:47:23.649Z] [INFO] [seed] ----------------------------------------------
```

演示数据覆盖完整 CRM 闭环：**8 位客户恰好覆盖 8 种销售状态**（待开发 / 已联系 / 已回复 / 有意向 / 报价中 / 谈判中 / 已成交 / 已流失），并带有标签、负责人、相对今天的下一次跟进时间（今天 / 已逾期 / 未来各有样本）、7 封开发信、9 条跟进记录、11 条 Timeline 活动事件，以及 6 个覆盖全部分类的开发信模板。登录后可直接在 Dashboard 销售工作区 / 销售漏斗、客户列表筛选、客户详情 Timeline 里看到效果。

脚本是**幂等**的（客户按邮箱、开发信按「客户 + 主题」、跟进按「客户 + 跟进时间」、事件按「客户 + 类型 + 时间」、模板按名称判重），重复执行只会补建缺失的数据。

如需**清空后重建**：

```bash
cd server
npm run reset          # 等价于 tsx src/scripts/seed.ts --reset
```

> `reset` 会删除 `customers` / `developmentletters` / `followups` / `customerevents` / `customerattachments` / `quotations` / `lettertemplates` 七个集合的全部数据，请谨慎使用。

### 6. 启动前后端

**一键并行启动（推荐）**——在项目根目录：

```bash
npm run dev
```

终端会显示两路带颜色前缀的日志（`SERVER` 青色 / `WEB` 品红）：

```
[SERVER] [2026-09-08T07:07:27.172Z] [INFO] [mongodb] 已连接到 MongoDB: mongodb://127.0.0.1:27017/cdlm
[SERVER] [2026-09-08T07:07:27.204Z] [WARN] [mailer] 邮件通道为 MOCK 模式：开发信只入库、不真实发送。配置 SMTP_* 后重启即可切换为真实发送。
[SERVER] [2026-09-08T07:07:27.210Z] [INFO] [bootstrap] ==============================================
[SERVER] [2026-09-08T07:07:27.210Z] [INFO] [bootstrap]   Customer Dev Letter Manager API 已启动
[SERVER] [2026-09-08T07:07:27.210Z] [INFO] [bootstrap]   环境      : development
[SERVER] [2026-09-08T07:07:27.211Z] [INFO] [bootstrap]   地址      : http://localhost:5000
[SERVER] [2026-09-08T07:07:27.211Z] [INFO] [bootstrap]   健康检查  : http://localhost:5000/api/health
[SERVER] [2026-09-08T07:07:27.211Z] [INFO] [bootstrap]   元数据    : http://localhost:5000/api/meta
[SERVER] [2026-09-08T07:07:27.211Z] [INFO] [bootstrap]   邮件通道  : mock（模拟发送）
[SERVER] [2026-09-08T07:07:27.211Z] [INFO] [bootstrap] ==============================================
[WEB]    VITE v6.0.7  ready in 543 ms
[WEB]    ➜  Local:   http://localhost:5173/
```

> 开发环境下日志级别为 `debug`（生产为 `info`）；访问日志用 morgan 的 `dev` 彩色简短格式（生产为 `combined`），且 `/api/health` 的探活请求不会刷日志。

**分别启动**（需要单独看某一端日志时）：

```bash
# 终端 1 —— 后端（tsx watch，改代码自动重启）
npm run dev:server
# 或直接：cd server && npm run dev

# 终端 2 —— 前端（Vite HMR）
npm run dev:web
# 或直接：cd web && npm run dev
```

**打开浏览器访问：**

| 地址 | 说明 |
| --- | --- |
| **http://localhost:5173** | 前端应用 |
| http://localhost:5000/api/health | 后端健康检查 |

**登录账号：管理员 `admin` / `password`**（首次启动自动创建）。业务员账号需先用管理员登录、在左侧「用户管理」里创建，再把客户分配给他们——业务员登录后只能看到自己名下的客户。

---

## 生产构建与部署

```bash
# 在项目根目录，一次性构建前后端
npm run build
```

产物：

- `server/dist/` —— 编译后的 Node 代码
- `web/dist/` —— 静态资源（HTML / JS / CSS）

启动后端生产服务：

```bash
npm start              # 等价于 cd server && node dist/index.js
```

前端静态资源部署（任选其一）：

```bash
# 方式 1：Vite 内置预览服务器（快速验证）
cd web && npm run preview

# 方式 2：Nginx —— 把 web/dist 作为根目录，并把 /api 反代到后端
```

Nginx 参考配置：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  root /var/www/cdlm/web/dist;
  index index.html;

  # SPA 前端路由回退
  location / {
    try_files $uri $uri/ /index.html;
  }

  # API 反向代理
  location /api/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> 生产环境上线前请务必：修改 `JWT_SECRET`、修改 `ADMIN_PASSWORD`、把 `NODE_ENV` 设为 `production`、把 `CORS_ORIGIN` 改成真实域名。

---

## 脚本速查

### 根目录

| 命令 | 作用 |
| --- | --- |
| `npm run install:all` | 安装 server + web 依赖 |
| `npm run dev` | 并行启动前后端（开发） |
| `npm run dev:server` | 只启动后端 |
| `npm run dev:web` | 只启动前端 |
| `npm run build` | 构建前后端 |
| `npm start` | 启动后端生产服务 |
| `npm run typecheck` | 双端 TypeScript 类型检查 |
| `npm run lint` | 前端 ESLint |
| `npm run seed` | 写入演示数据 |

### server/

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | `tsx watch` 热重载开发 |
| `npm run build` | `rimraf dist && tsc` |
| `npm start` | `node dist/index.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | 写入演示数据 |
| `npm run reset` | 清空并重建演示数据 |

### web/

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | Vite 开发服务器（HMR） |
| `npm run build` | `tsc --noEmit && vite build` |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | ESLint 检查 / 自动修复 |

### 冒烟测试

后端启动后，在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\smoke-test.ps1
```

覆盖 112 组场景：健康检查、登录、元数据、客户列表 / 筛选 / 搜索、发送开发信（含占位符渲染断言）、开发信历史与全量列表、预览（含无邮箱客户的 400 与手动收件人）、重发、统计聚合、行业聚合、三个 Excel 导出（校验 `Content-Type` 与 RFC 5987 文件名）、创建 → 批量改状态 → 删除级联、导入（混合行 / `onDuplicate=update` / `dryRun`）、开发信删除后 `letterCount` 递减、错误契约（401 / 404 / 422 / 登录失败）；以及 CRM 升级回归（25–42）：标签 / 负责人词汇表、批量加 / 删标签（自动去重）、按标签 / 负责人（含未分配）/ 跟进时间（今天 / 逾期 / 未来）筛选、批量分配 / 清除负责人、批量设置 / 清除下一次跟进时间、跟进记录增删并同步客户主档、客户 Timeline 聚合、开发信模板 CRUD + 复制 + 分类过滤、批量入参校验（空标签 / 非法负责人返回 422）——全部围绕一个临时客户与临时模板进行并在结尾自动清理；以及**数据隔离回归（43–56）**：管理员创建业务员账号 → 业务员登录 → 断言初始可见客户为 0、访问用户管理 / 负责人名单返回 403、自建客户自动归属本人、管理员未分配客户对业务员不可见、管理员分配后业务员立即可见、业务员调用批量分配负责人返回 403、越权读写他人客户返回 404——临时客户在结尾清理，业务员账号在数据隔离段创建后不会被删除（用户名固定为 `smoke.sales`，重复运行返回 409 并自动跳过）；以及**账号管理回归（57–72）**：管理员创建一次性账号 `smoke.temp` → 编辑资料（显示名 + 角色）→ 重置密码（旧密码登录 `401`、新密码可登录）→ 该账号自建客户 → 自我保护（停用 / 删除 / 降级「自己」均 `403`）→ 停用后**已签发 token 立即 `401`** 且新登录 `403` → 重新启用后可登录 → 删除账号（名下客户转为「未分配」、`reassignedCustomers=1`）→ 删除后其 token `401`、登录 `401` → 清理临时客户并确认账号已从列表移除（`smoke.temp` 结尾自动删除，保证重复运行干净）；以及 **CRM 基础功能回归（73–93）**：创建含来源 / 优先级 / 需求信息 / 联系渠道的客户并校验字段往返 → 优先级省略时默认 `medium` → PUT 编辑需求与优先级（未改字段保留）→ 按 `leadSource` / `priority` 筛选 → 跟进创建 → **编辑**（method / result / 下次跟进时间，且客户 `nextFollowUpAt` 同步）→ 列表反映编辑 → 业务员越权增改他人客户跟进返回 404 → 删除跟进 → 附件 **base64 上传 / 列表 / 鉴权下载（内容逐字节校验）/ 删除**、业务员越权访问附件 404、下载已删除附件 404 → Excel 导入新列（自定义来源 `Dubai Exhibition` 原样保留、`High→high` / `l→low` 归一化）→ 导出含新列 token 校验 → 结尾清理全部临时客户；以及 **报价管理回归（94–112）**：建临时客户 → 自动生成编号（`QT-YYYYMMDD-NNN`）+ 两行明细金额核算（数量 × 单价、总额）+ 有效期 → 详情 / 列表 → 自定义小写编号大写归一 + EUR + 空有效期不误存为 1970 → 重复编号 `409` → 编辑时篡改金额被后端重算忽略 → 改状态（`sent` 不联动、`negotiating` + `markCustomerAsQuoting` 把客户推进为「报价中」）→ 顶层列表按 `customerId` / `status` 筛选 → Timeline 派生报价事件 → 非法 `customerId` / 空明细 / 缺标题 / 数量为 0 返回 `422`、缺失客户 `404` → 业务员越权访问他人客户报价 7 条路由全 `404` → 业务员自建客户 + 报价且管理员可读 → 删除报价 → 已删报价 `404` → 清理临时客户并确认报价随客户级联删除（`quotations=0`）。

> ⚠️ **该脚本会修改数据**：它会新建并删除测试客户（含跟进 / 附件 / 报价单的级联清理）、上传并删除临时附件、创建并删除临时报价单、改写首位客户的字段、**批量删除全部开发信**，创建并在账号管理段删除一次性账号 `smoke.temp`，并保留一个用户名固定为 `smoke.sales` 的业务员账号（数据隔离段不删账号；`reset` 也不会清除用户）。请勿在存有真实业务数据的库上运行。跑完后用 `npm run reset --prefix server`（清空并重新播种）恢复干净演示数据。

---

## 用户与数据权限

系统采用**严格分配制**的多用户模型，区分两种角色：

| 角色 | `role` | 能做什么 |
| --- | --- | --- |
| **管理员** | `admin` | 看到并操作**全部客户**（含未分配）；创建账号；把客户分配给任意业务员；调整任意客户的负责人 |
| **业务员** | `user` | **只能看到并操作「负责人 = 自己」的客户**；可自建客户（自动归属本人）；看不到未分配 / 他人客户，不能转移归属，不能访问用户管理 |

### 隔离规则

1. **可见范围**：业务员登录后，客户列表 / 详情 / 开发信 / 跟进 / **附件** / **报价单** / Timeline / Dashboard 统计与销售工作区，全部自动收敛到「自己名下」的客户。未分配客户（无负责人）**仅管理员可见**，需管理员分配后才进入业务员视野。
2. **自动归属**：业务员手工新建或 Excel 导入的客户，`ownerId` 强制设为本人（忽略传入值）；管理员建档时默认不分配（未分配），可随后指派给任意人。
3. **越权即 404**：业务员访问非自己名下的客户（详情 / 编辑 / 删除 / 发信 / 跟进增改删 / **附件上传下载删除** / **报价单增改删**）统一返回 **404** 而非 403——避免通过状态码差异探测他人客户是否存在。
4. **归属不可自转**：业务员更新客户时 `ownerId` 字段被忽略；批量分配负责人是管理员专属。
5. **模板全局共享**：开发信模板对所有登录用户可读写（团队共用话术库），不做隔离。

### 管理员专属能力（前后端双重防护）

| 能力 | 后端守卫 | 前端表现 |
| --- | --- | --- |
| 用户管理（列表 / 新建 / 编辑 / 重置密码 / 停用启用 / 删除） | `/api/users` 整体 `requireRole('admin')` | 侧边栏「用户管理」入口、`/users` 路由（`AdminRoute`）仅管理员可见；非管理员访问自动跳回 Dashboard |
| 负责人名单 | `GET /api/customers/owners` `requireRole('admin')` | 业务员不拉取该名单（本质是用户花名册） |
| 批量分配 / 清除负责人 | `POST /api/customers/bulk/owner` `requireRole('admin')` | 客户列表的「负责人」筛选、表格「负责人」列、批量「分配负责人」按钮、客户表单 / 详情的负责人字段，业务员一律隐藏 |

> **账号能力范围**：用户列表 + 新建 + 编辑资料（显示名 / 角色，用户名不可改）+ 重置密码 + 停用 / 启用 + 删除（名下客户转「未分配」）。停用 / 删除对已签发 token **即时生效**；管理员不能停用 / 删除 / 降级自己，也不能移除最后一个启用中的管理员。

### 创建一个业务员并分配客户（管理员操作）

1. 用 `admin` 登录 → 左侧「用户管理」→「新建用户」→ 填用户名 / 初始密码 / 显示名，角色选「业务员」→ 保存。
2. 到「客户管理」→ 勾选客户 → 批量「分配负责人」→ 选择刚建的业务员；或在客户详情 / 编辑弹窗里指定负责人。
3. 该业务员用自己的账号登录后，就只能看到刚分配给自己的客户；其新建 / 导入的客户会自动归到自己名下。
4. **管理账号**：在「用户管理」列表每行右侧的「⋯」菜单里可编辑资料（显示名 / 角色）、重置密码、停用 / 启用或删除账号。停用 / 删除会让该账号**已签发的登录立即失效**；删除还会把它名下客户转为「未分配」回收到管理员池。（不能对自己执行停用 / 删除 / 降级，也不能移除最后一个启用中的管理员。）

---

## API 参考

统一响应体：

```jsonc
// 成功
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 } }

// 失败
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ] } }
```

除 `/api/health` 与 `/api/meta` 外，所有接口都需要请求头 `Authorization: Bearer <token>`。**客户相关接口按登录角色自动隔离**：管理员见全部，业务员仅见「负责人 = 自己」的客户（详见[用户与数据权限](#用户与数据权限)）。

### 公开

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（含数据库状态、邮件通道、运行时长） |
| GET | `/api/meta` | 枚举（含报价状态 / 币种）、占位符定义、公司信息、邮件通道 |

### 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录（带限流），返回 `{ user, token }` |
| GET | `/api/auth/me` | 当前用户 |

### 用户管理（管理员专属，整体 `requireRole('admin')`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/users` | 用户列表（`data` 直接是用户数组：id / username / displayName / role / status / lastLoginAt / createdAt；不含 passwordHash） |
| POST | `/api/users` | 创建用户（`username` / `password` / `displayName?` / `role`），返回 `201`；用户名重复返回 `409` |
| PUT | `/api/users/:id` | 编辑资料（`displayName?` / `role?`，至少一项；用户名不可改），返回最新用户 |
| PUT | `/api/users/:id/password` | 重置密码（`password`，6–72 位），返回 `{ id }` |
| PUT | `/api/users/:id/status` | 停用 / 启用（`status`：`active` \| `disabled`），返回最新用户 |
| DELETE | `/api/users/:id` | 删除账号；名下客户 `ownerId` 置空转为「未分配」，返回 `{ id, reassignedCustomers }` |

> 业务员调用以上接口一律 `403`。**自我保护**：管理员不能停用 / 删除 / 降级「自己」，也不能移除「最后一个启用中的管理员」，否则返回 `403`。**即时失效**：账号被停用或删除后，其已签发的 token 会在下一次请求时被 `requireAuth` 拒绝（`401`），前端自动登出；角色调整同样即时生效，无需等 token 过期。

### 客户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/customers` | 列表（搜索 / 状态 / 行业 / 等级 / **来源 `leadSource`** / **优先级 `priority`** / 有无邮箱 / 标签 / 负责人 / 跟进时间 / 排序 / 分页） |
| POST | `/api/customers` | 新建 |
| GET | `/api/customers/:id` | 详情（含 tags / owner / nextFollowUpAt / leadSource / priority / 需求信息 / 联系渠道） |
| PUT | `/api/customers/:id` | 更新（状态 / 下次跟进时间变化写入 Timeline；支持来源 / 优先级 / 需求信息 / 联系渠道等字段） |
| DELETE | `/api/customers/:id` | 删除（级联删除其开发信 / 跟进 / 活动事件 / **附件（含磁盘文件）** / **报价单**） |
| POST | `/api/customers/import` | 批量导入，返回 `{ created, updated, skipped, failures[] }` |
| POST | `/api/customers/bulk/status` | 批量改状态 |
| POST | `/api/customers/bulk/delete` | 批量删除 |
| POST | `/api/customers/bulk/tags/add` | 批量加标签（`$addToSet` 去重） |
| POST | `/api/customers/bulk/tags/remove` | 批量删标签 |
| POST | `/api/customers/bulk/owner` | 批量分配 / 清除负责人（`ownerId` 传 null 清除）——**管理员专属** |
| POST | `/api/customers/bulk/follow-up` | 批量设置 / 清除下一次跟进时间 |
| GET | `/api/customers/industries` | 行业去重列表（筛选下拉用） |
| GET | `/api/customers/tags` | 标签词汇表（去重，供筛选 / 批量复用） |
| GET | `/api/customers/owners` | 负责人列表（供筛选 / 分配下拉用）——**管理员专属** |
| GET | `/api/customers/export` | 导出 Excel（忽略分页） |
| GET | `/api/customers/template` | 下载导入模板 |
| GET | `/api/customers/:id/letters` | 该客户的开发信历史 |
| POST | `/api/customers/:id/letters` | **发送开发信**，返回 `{ letter, customer, delivered, channel, message }` |
| GET | `/api/customers/:id/timeline` | 客户 Timeline（创建 / 开发信 / 跟进 / 状态变化 / 跟进时间变化 / 报价单，倒序） |
| GET | `/api/customers/:id/follow-ups` | 该客户的跟进记录列表 |
| POST | `/api/customers/:id/follow-ups` | 新增跟进记录（可同步回写 nextFollowUpAt） |
| PUT | `/api/customers/:id/follow-ups/:followUpId` | **编辑跟进记录**（至少改一个字段；改 nextFollowUpAt 会同步回写客户主档） |
| DELETE | `/api/customers/:id/follow-ups/:followUpId` | 删除某条跟进记录 |
| GET | `/api/customers/:id/attachments` | 该客户的附件列表 |
| POST | `/api/customers/:id/attachments` | **上传附件**（base64 JSON：`originalName` / `mimeType?` / `dataBase64`），返回 `201` |
| GET | `/api/customers/:id/attachments/:attachmentId/download` | **下载附件**（鉴权；`Content-Disposition` 用 RFC 5987 兼容中文名） |
| DELETE | `/api/customers/:id/attachments/:attachmentId` | 删除附件（同时删除本地磁盘文件） |

> **附件约束**：上传为 base64 JSON（复用 `express.json` 通道，无 multipart），单文件默认 ≤ 15 MB（`MAX_ATTACHMENT_SIZE`），请求体上限 25 MB；文件落盘本地 `server/uploads/`（`UPLOAD_DIR`，已 gitignore）。所有附件接口都先校验客户归属，业务员越权访问他人客户附件一律 **404**；删除客户会级联清理其附件（含磁盘文件）。

### 报价单（V2 报价管理）

顶层 `/api/quotations`（跨客户列表 / 筛选 / 详情）+ 嵌套 `/api/customers/:id/quotations`（客户详情页主用），全部 `requireAuth` 并按客户归属隔离（业务员越权一律 404）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/quotations` | 报价单分页列表（`customerId` / `status` / `currency` / `search` 筛选，`data` 为分页结构、`customerId` 已 populate 客户名） |
| POST | `/api/quotations` | 创建（body 带 `customerId`），先校验客户存在且当前用户有权访问 |
| GET | `/api/quotations/:id` | 报价单详情 |
| GET | `/api/customers/:id/quotations` | 该客户的报价单列表（按创建时间倒序） |
| POST | `/api/customers/:id/quotations` | 从当前客户创建报价单（无需再传 `customerId`） |
| GET | `/api/customers/:id/quotations/:quotationId` | 报价单详情 |
| PUT | `/api/customers/:id/quotations/:quotationId` | 编辑（金额后端重算；普通编辑不改客户销售状态） |
| PUT | `/api/customers/:id/quotations/:quotationId/status` | 更新状态（`status`；可带 `markCustomerAsQuoting` 显式把客户推进为「报价中」） |
| DELETE | `/api/customers/:id/quotations/:quotationId` | 删除，返回 `{ id, deleted }` |

> **金额可信性**：`items[].amount` 与 `totalAmount` 一律由后端计算——入参 schema 不含金额字段（前端传值被 zod 剥离），service 层与模型 `pre('validate')` 钩子各重算一次，前端展示值仅作即时预览。
> **编号唯一**：`quotationNo` 唯一（大写归一），留空由后端按 `QT-YYYYMMDD-NNN` 生成；重复返回 `409`。
> **枚举**：`status` = `draft / sent / negotiating / accepted / rejected / expired`；`currency` = USD / EUR / GBP / CNY / JPY / HKD / AUD / CAD / CHF / SGD / AED / NZD（默认 USD）；均可从 `GET /api/meta` 获取（含中文标签）。
> **客户状态联动**：仅创建 / 改状态接口接收 `markCustomerAsQuoting`，且只在语义可升级时把客户推进为「报价中」（不降级已报价中 / 谈判中 / 成交 / 流失）；普通编辑不携带、后端也不接收该字段。
> **Timeline**：报价创建与状态变化派生为客户 Timeline 事件（`type: 'quotation'`），沿用现有事件结构；删除客户会级联删除其全部报价单。

### 开发信

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/letters` | 全量列表（关键词 / 状态 / 通道 / 排序 / 分页） |
| POST | `/api/letters` | 直接发送（body 内指定 `customerId`） |
| GET | `/api/letters/:id` | 详情 |
| POST | `/api/letters/:id/resend` | 重新发送（生成新记录） |
| DELETE | `/api/letters/:id` | 删除 |
| POST | `/api/letters/bulk/delete` | 批量删除 |
| POST | `/api/letters/preview` | 占位符渲染预览，返回 `{ subject, html, text, recipientEmail, recipientName }` |
| GET | `/api/letters/export` | 导出 Excel（最多 5000 条） |

### 开发信模板

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/templates` | 模板列表（分类 / 关键词筛选），`data` 直接是模板数组 |
| POST | `/api/templates` | 新建模板（name / subject / content / category） |
| GET | `/api/templates/:id` | 模板详情 |
| PUT | `/api/templates/:id` | 更新模板 |
| POST | `/api/templates/:id/duplicate` | 复制模板（名称追加「副本」，与源模板彼此独立） |
| DELETE | `/api/templates/:id` | 删除模板 |

### 统计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats/overview` | 客户总数 / 待开发 / 已开发 / 开发率 / 行业分布 / 等级分布 / **各销售状态数量（byStatus，供销售漏斗）** / 开发信总数 / 近 7 天 / 失败数 / 每日趋势 / 最近记录 / **销售工作区（workspace：今日待跟进 / 已逾期 / 即将跟进 / 今日发送 / 今日新增，及待跟进·最近跟进·最近开发客户清单）** |

---

## 开发信占位符

在发送弹窗的编辑器上方点击按钮即可插入，语法为 `{{key}}`。客户字段缺失时按 `fallback` 渲染（**前后端使用同一套 fallback，保证预览所见即实际所发**）。

| 占位符 | 含义 | 缺失时 |
| --- | --- | --- |
| `{{name}}` | 客户姓名 | `there` |
| `{{firstName}}` | 名字（First Name） | `there` |
| `{{company}}` | 客户公司 | `your company` |
| `{{email}}` | 客户邮箱 | 空 |
| `{{phone}}` | 客户手机 | 空 |
| `{{title}}` | 客户职位 | 空 |
| `{{industry}}` | 客户行业 | 空 |
| `{{country}}` | 客户国家 / 地区 | 空 |
| `{{address}}` | 客户地址 | 空 |
| `{{customerWebsite}}` | 客户官网 | 空 |
| `{{grade}}` | 客户等级 | 空 |
| `{{notes}}` | 备注 | 空 |
| `{{companyName}}` | 我方公司名 | 空 |
| `{{companyWebsite}}` | 我方官网 | 空 |
| `{{moq}}` | 最小起订量 | 空 |
| `{{senderName}}` | 发件人署名 | 空 |

> `{{customerWebsite}}` 与 `{{companyWebsite}}` 刻意分开命名，避免「客户官网」和「我方官网」写混。
> 我方相关的 4 个占位符取值来自 `server/.env`，可在不重启前端的情况下通过后端热重载生效。

---

## Excel 导入说明

### 模板列

点击客户列表页的「导入 Excel」→「下载模板」即可获得标准模板，共两个工作表：

**工作表「客户导入模板」**（含 2 行示例数据，列顺序可任意）：

`姓名` · `公司` · `邮箱` · `手机号` · `WhatsApp` · `Skype` · `LinkedIn` · `Facebook` · `Instagram` · `职位` · `行业` · `国家` · `官网` · `地址` · `等级` · `来源` · `优先级` · `感兴趣产品` · `产品型号` · `产品分类` · `预计采购数量` · `目标价格` · `MOQ` · `需求备注` · `备注` · `状态`

**工作表「填写说明」**：逐列说明取值要求（如 `状态` 可填 `待开发` / `已联系` / `已回复` / `有意向` / `报价中` / `谈判中` / `已成交` / `已流失`，旧值 `已开发` 会自动归为 `已联系`；`等级` 可填 `A` / `B` / `C`；`优先级` 可填 `高 / 中 / 低` 或 `High / Medium / Low`，无法识别的值忽略并落为默认 `Medium`；`来源` 建议填 `Alibaba` / `Google` / `Exhibition` 等，**未知来源值原样保留、不报错**）。

> 模板未包含的字段（如 `标签` / `负责人` / `下一次跟进时间`）仍可在导入向导的列映射步骤手动指定，或直接调用导入接口传入。

### 自动识别 + 手动映射

导入向导分三步（弹窗顶部有步骤指示器）：

1. **选择文件** —— 支持 `.xlsx` / `.xlsm` / `.xls` / `.csv` / `.ods`，导入文件前端上限 **10 MB**（`MAX_IMPORT_FILE_SIZE`，浏览器本地解析、不上传原始文件）；后端 `express.json` 请求体总上限为 **25 MB**（为客户附件的 base64 上传预留）。前端用 xlsx 解析，可选择工作表与表头所在行，并在此步提供「下载模板」。
2. **列映射与检查** —— 系统按中英文别名自动匹配（例如 `姓名` / `name` / `客户名称` / `联系人` 都会映射到 `name`），未识别的列可手动在下拉里指定；界面实时预览前 **8** 行映射结果，并在前端先跑一轮校验（姓名必填、邮箱格式），问题行标红并给出原因。此步还可设置：
   - **重复邮箱策略**：`跳过`（默认）或 `覆盖更新`
   - **默认状态**：表格没有「状态」列时，新客户按此状态入库
   - 单次最多导入 **5000** 行，超出部分会被截断并明确提示
3. **导入结果** —— 四块统计（提交行数 / 新增 / 更新 / 跳过或失败），并逐行表格展示失败明细（Excel 真实行号 / 姓名 / 邮箱 / 原因）。可选择「继续导入下一批」或关闭。

> 后端 `POST /api/customers/import` 还支持 `dryRun: true`（只校验不落库，用于导入前预检），当前 UI 未暴露该开关，需要时可直接调接口。

### 直接导入现有表格

项目根目录自带的 `Genesis-目标客户主表.xlsx` 可直接拖入导入向导，表头会被自动识别。

---

## 从 mock 切换到真实 SMTP

默认 `MAIL_TRANSPORT=mock`：**不会真实投递邮件**，但开发信记录、客户状态、统计全部照常写入，方便本地演示与开发。前端在仪表盘和开发信记录页会常驻一条琥珀色提示，明确当前处于模拟通道。

切换步骤：

```ini
# server/.env
MAIL_TRANSPORT=smtp
MAIL_FROM=Your Name <you@yourdomain.com>
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false          # 465 端口时改为 true
SMTP_USER=you@yourdomain.com
SMTP_PASS=your-app-password
```

保存后后端（`tsx watch`）会自动重启，日志中出现：

```
[INFO] [mailer] SMTP transporter 已初始化: smtp.yourprovider.com:587
[INFO] [mailer] SMTP 连接自检通过
[INFO] [bootstrap]   邮件通道  : smtp（真实发送）
```

若自检失败，服务仍会正常启动，仅在日志里给出警告，实际发送时该封信会以 `failed` 状态落库：

```
[WARN] [mailer] SMTP 连接自检失败（服务仍会启动，发送时将返回失败状态）: …
```

常见服务商参数：

| 服务商 | HOST | PORT | 备注 |
| --- | --- | --- | --- |
| Gmail | `smtp.gmail.com` | 587 | 需开启两步验证并生成「应用专用密码」 |
| Outlook / 365 | `smtp.office365.com` | 587 | 需开启 SMTP 认证 |
| QQ 邮箱 | `smtp.qq.com` | 465（`SMTP_SECURE=true`） | 需开启 SMTP 并使用授权码 |
| 163 邮箱 | `smtp.163.com` | 465（`SMTP_SECURE=true`） | 需授权码 |
| 阿里云企业邮 | `smtp.mxhichina.com` | 465（`SMTP_SECURE=true`） | — |

发送失败时开发信会以 `status: "failed"` 落库并保存 `error` 字段，在开发信记录页可悬停查看失败原因，修复后可直接「重新发送」。

---

## 常见问题排查

**Q: 启动后端报 `MongoNetworkError` / `connect ECONNREFUSED 127.0.0.1:27017`**
MongoDB 没启动。按 [4. 启动 MongoDB](#4-启动-mongodb) 检查服务状态；Windows 下先 `Get-Service MongoDB`。

**Q: 端口 5000 被占用**
改 `server/.env` 的 `PORT`，同时把 `web/.env` 的 `VITE_API_PROXY_TARGET` 改成同样的端口。

**Q: 前端能打开但列表一直转圈 / 报 401**
- 后端没启动：看 `npm run dev` 的 `SERVER` 那一路日志
- Token 过期：退出重新登录（默认 7 天有效期）

**Q: 前端页面报 CORS 错误**
`server/.env` 的 `CORS_ORIGIN` 没包含当前前端地址。开发时用 Vite 代理不会触发 CORS；若直连后端则需把 `http://localhost:5173` 加进去。

**Q: 登录后立刻被踢回登录页**
`JWT_SECRET` 在两次启动之间变了（例如重新生成了 `.env`），旧 token 校验失败。重新登录即可。

**Q: 导入 Excel 提示「无法识别任何列」**
表头行不在第一行，或表头是合并单元格。请在导入向导的「列映射」步骤手动指定每一列。

**Q: 富文本编辑器粘贴后样式错乱**
Quill 会保留来源样式。建议用「粘贴为纯文本」（Ctrl+Shift+V）后再排版，或在预览标签页确认实际渲染效果。

**Q: 想彻底清空数据库重来**

```bash
cd server
npm run reset
```

或手动：

```bash
mongosh cdlm --eval "db.customers.drop(); db.developmentletters.drop(); db.followups.drop(); db.customerevents.drop(); db.customerattachments.drop(); db.quotations.drop(); db.lettertemplates.drop();"
```

---

## 许可

本项目为内部业务工具，未附加开源许可证。
