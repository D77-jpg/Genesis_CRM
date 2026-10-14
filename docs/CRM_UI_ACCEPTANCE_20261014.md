# CRM 全站 UI/UX 改造验收记录

日期：2026-10-14。仓库：Genesis_CRM；基线：`ef718db`（已合并客户列表行内编辑）；分支：`codex/crm-ui-unification`。

## 修改范围

统一浅灰蓝页面底色、白色工作区、蓝色主操作、文字层级、间距、圆角、边框、焦点和禁用反馈。共享规范见 `CRM_WORKSPACE_DESIGN.md`。

复用现有 React、Tailwind、Radix/shadcn、Lucide、Quill；新增共享工具栏、分组标题与抽屉容器，调整现有基础组件。未新增依赖。桌面内容最大 1600px，手机控件触达尺寸、导航焦点管理、长文本与表格滚动均统一。

## 逐页浏览验收

全部页面均检查桌面 1280px 和手机 375px 布局，页面主体未出现超出视口的横向溢出；宽表格通过局部滚动访问全部列。

| 页面 | 检查重点 | 实际截图文件 |
| --- | --- | --- |
| 仪表盘 | 客户、邮件与销售指标分组，手机双列指标，全部分布与近期活动保留 | dashboard.jpg / mobile-dashboard.jpg |
| 客户管理 | 筛选、长公司名、表头、分页、状态与负责人行内修改 | customers-final.jpg / mobile-customers.jpg |
| 客户详情 | 联系方式、需求、跟进、报价、开发信与附件，窄屏顺序 | customer-detail.jpg / mobile-customer-detail.jpg |
| 邮件中心 | 文件夹、邮件阅读、会话、写信入口、失败反馈、窄屏上下排列 | mail-final.jpg / mobile-mail.jpg |
| 开发信记录 | 筛选、状态、长主题、表格和分页 | letters.jpg / mobile-letters.jpg |
| 模板中心 | 分类、搜索、卡片、编辑与占位符入口 | templates.jpg / mobile-templates.jpg |
| 用户管理 | 用户卡片、菜单、权限标签及新建表单 | users.jpg / mobile-users.jpg |
| 项目工作空间 | 动态名称、长名称、成员信息及项目表单 | projects.jpg / mobile-projects.jpg |
| Agent 诊断 | 状态、诊断结果、内容分组与可展开信息 | agent-diagnostics.jpg / mobile-agent-diagnostics.jpg |
| AI 配置 | 当前配置、提供商字段、表单、帮助文字；未保存配置或外部调用 | ai-settings.jpg / mobile-ai-settings.jpg |
| 登录 | 标题、输入、密码显示、必填反馈与焦点 | login.jpg / mobile-login.jpg |
| 不存在页面 | 单一全局主题入口、返回操作、视口高度 | not-found.jpg / mobile-not-found.jpg |

截图是运行中的实际界面，数据来自独立临时数据库中的虚构资料；不是效果图，也没有替换正式数据库。截图保存在本机 `D:\Trade\AutoForceAI\logs\crm-design\screenshots`，不提交构建产物或测试数据库到仓库。

## 关键交互验收

- 使用真实 Express 路由与独立 MongoDB，验证客户表单创建、状态改为“已联系”、管理员分配负责人；刷新后与 API 读取结果一致，其他客户字段保留。
- 普通业务员导航保持原权限过滤，不展示管理入口或负责人分配控件；无权读取邮件时明确显示错误和重试入口，没有放开后端权限。
- 切换第二项目时品牌名称动态更新，客户空态正确；切回原项目成功。
- 临时注入一次客户列表 503 错误，统一错误组件具有 alert 语义，重新加载恢复列表。
- 客户表单空提交出现姓名必填提示，焦点回到字段，`aria-invalid=true`。
- 检查导入、客户、模板、用户、项目、报价、跟进、邮件撰写与邮箱配置弹窗；长表单正文可滚动、底部操作可达、关闭正常。报价金额显示 USD 1,500，与既有数据一致。
- 键盘 Tab、Escape 验证手机导航、Agent 与随手记焦点约束和关闭；表格方向键与 PageDown 滚动成功，表头保持可见。
- 检查 768/1024/1440px 和 812×375 横屏客户列表；深色客户页抽查；减少动态效果使用统一系统媒体查询。
- Quill 编辑器及工具按钮新增可访问名称。用键盘编辑并保存隔离测试草稿，重开预览及 API 读取确认正文精确为 `UI draft verification. No email is sent.`，状态仍为 draft、通道 mock。
- 回复收件人、主题只读和回复草稿禁用沿用原业务规则，补充原因提示。未点击发送、未启动 SMTP/IMAP 工作者、未测试真实邮箱连接。

## 自动检查

- 生产构建（含 TypeScript 类型检查）通过。
- ESLint：0 错误；8 条现有警告，涉及 Fast Refresh 导出与既有 Hook 依赖，未借界面改造修改相关业务逻辑。
- 现有客户字段回归检查 2 项通过；Agent 内容渲染与安全回归检查 3 项通过。
- Git diff 空白检查通过；server、store、lib、router、types、validators、依赖与锁文件未修改。constants 仅修改展示色值。

## 验证边界与交付

本次改动涉及前端展示、布局、访问性与邮件加载/错误反馈状态，不修改 API、数据模型、权限、统计公式或持久化处理。公司名称继续读取项目/服务端配置。

没有验证真实邮件发送/收取、外部 AI 服务、真实手机系统或完整屏幕阅读器体验；这些不能从隔离界面验收推断。深色模式只抽查客户页面。

测试服务关闭后，本机 5174 预览改为连接现有 5000 CRM 服务；5173 保留 main 界面，须本次分支进入 main 后再更新。最终代码先保存本地提交。自动审批拒绝本次新改造分支的 GitHub 推送，理由是此前授权只覆盖上一条功能分支；待用户确认后推送，PR 创建和合并按仓库约定由人操作。
