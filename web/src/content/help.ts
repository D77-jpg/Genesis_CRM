export type HelpCategoryId = 'start' | 'customers' | 'outreach' | 'mail' | 'quotes' | 'knowledge' | 'team' | 'billing' | 'security';

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface HelpArticle {
  slug: string;
  category: HelpCategoryId;
  title: LocalizedText;
  summary: LocalizedText;
  minutes: number;
  body: LocalizedText;
}

export const HELP_CATEGORIES: Array<{ id: HelpCategoryId; label: LocalizedText; description: LocalizedText }> = [
  { id: 'start', label: { zh: '快速开始', en: 'Getting started' }, description: { zh: '从登录到第一封开发信', en: 'From sign-in to your first outreach' } },
  { id: 'customers', label: { zh: '客户与线索', en: 'Customers and leads' }, description: { zh: '导入、去重、分级和跟进', en: 'Import, dedupe, grade and follow up' } },
  { id: 'outreach', label: { zh: '开发信与自动化', en: 'Outreach and automation' }, description: { zh: '模板、批量写信和发送队列', en: 'Templates, batch drafting and sending' } },
  { id: 'mail', label: { zh: '邮箱与合规', en: 'Mailbox and compliance' }, description: { zh: '连接邮箱、收信和退订', en: 'Connect mailboxes, receive replies and honor opt-outs' } },
  { id: 'quotes', label: { zh: '报价与订单', en: 'Quotes and orders' }, description: { zh: '报价、版本和客户状态', en: 'Quotes, versions and customer status' } },
  { id: 'knowledge', label: { zh: '知识与 AI', en: 'Knowledge and AI' }, description: { zh: '上传资料、审核和 AI 配置', en: 'Upload, review and configure AI' } },
  { id: 'team', label: { zh: '团队与组织', en: 'Team and organization' }, description: { zh: '角色、项目和组织设置', en: 'Roles, projects and organization settings' } },
  { id: 'billing', label: { zh: '套餐与账单', en: 'Plans and billing' }, description: { zh: '用量、发票和套餐变更', en: 'Usage, invoices and plan changes' } },
  { id: 'security', label: { zh: '安全与数据', en: 'Security and data' }, description: { zh: '账号安全、导出和删除', en: 'Account security, export and deletion' } },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'first-login',
    category: 'start',
    title: { zh: '第一次登录与工作区检查', en: 'First sign-in and workspace check' },
    summary: { zh: '确认账号、组织、项目和邮箱状态。', en: 'Confirm your account, organization, project and mailbox status.' },
    minutes: 4,
    body: {
      zh: `## 登录\n\n使用管理员发来的用户名和密码登录。首次登录后建议立即修改密码，并在「用户管理」绑定邮箱，以便启用邮件验证码和找回密码。\n\n## 检查四件事\n\n1. 右上角项目名称是否正确；项目之间数据严格隔离。\n2. 「组织设置」中的套餐、成员和用量是否符合预期。\n3. 「邮件合规」是否显示发件邮箱已验证。\n4. 「新手引导」中还有哪些必填资料未完成。\n\n## 下一步\n\n先导入一小批客户做试运行。不要直接导入全量名单；先用 10–20 条检查字段映射、去重和分级规则。`,
      en: `## Sign in\n\nUse the username and password from your administrator. Change the password after the first sign-in and add an email address under User management so verification codes and password recovery can work.\n\n## Check four things\n\n1. Confirm the project name in the top bar. Data is strictly isolated between projects.\n2. Review the plan, members and usage under Organization settings.\n3. Confirm the sending mailbox is verified under Mail compliance.\n4. Complete any required fields shown in Getting started.\n\n## Next step\n\nImport a small batch first. Do not load the full list until you have checked field mapping, deduplication and grading with 10–20 rows.`,
    },
  },
  {
    slug: 'import-customers',
    category: 'customers',
    title: { zh: '从 Excel 导入客户', en: 'Import customers from Excel' },
    summary: { zh: '模板字段、预检、重复处理和常见错误。', en: 'Template fields, precheck, duplicates and common errors.' },
    minutes: 5,
    body: {
      zh: `## 1. 下载模板\n\n在客户列表点击「导入 Excel」→「下载导入模板」。模板包含中英文表头，至少填写姓名或公司，建议同时填写邮箱和国家。\n\n## 2. 先预检\n\n选择文件后系统会在浏览器本地解析，不会上传原始表格。预检会显示新增、更新、重复和错误行。\n\n## 3. 处理重复\n\n- 同邮箱默认视为同一客户。\n- 同公司名或同网站会给出软重复提醒，但不会自动合并。\n- 批量导入建议选择「跳过重复」，确认后再处理需要更新的记录。\n\n## 4. 常见错误\n\n- 邮箱格式不正确：检查多余空格或全角字符。\n- 国家为空：先用系统国家标准化功能补齐。\n- 超过 5,000 行：拆成多个文件，避免超时。`,
      en: `## 1. Download the template\n\nOn the customer list choose Import Excel → Download template. The template has bilingual headers. Fill in at least a name or company; email and country are strongly recommended.\n\n## 2. Run the precheck\n\nThe file is parsed locally in your browser; the original spreadsheet is not uploaded. The precheck shows rows that will be created, updated, skipped as duplicates or rejected.\n\n## 3. Handle duplicates\n\n- The same email is treated as the same customer by default.\n- The same company or website produces a soft-duplicate warning but is not merged automatically.\n- For bulk imports choose Skip duplicates first, then process updates deliberately.\n\n## 4. Common errors\n\n- Invalid email: check for spaces or full-width characters.\n- Missing country: normalize countries before importing.\n- More than 5,000 rows: split the file to avoid a timeout.`,
    },
  },
  {
    slug: 'first-outreach',
    category: 'outreach',
    title: { zh: '创建并发送第一封开发信', en: 'Create and send your first outreach' },
    summary: { zh: '选客户、选模板、预览、审核和发送。', en: 'Choose a customer, template, preview, review and send.' },
    minutes: 6,
    body: {
      zh: `## 准备\n\n先在「模板中心」确认模板内容、占位符和签名，再在「邮件合规」确认发件邮箱已验证。\n\n## 发送\n\n1. 打开客户详情，点击「写开发信」。\n2. 选择模板或直接填写主题与正文。\n3. 使用预览检查占位符替换结果。\n4. 点击「发送」；系统会创建发送任务并写入时间线。\n\n## 发送后\n\n- 成功：客户状态更新为「已联系」，开发信记录可查看投递渠道和 Message-ID。\n- 失败：在「邮件中心」查看失败原因；不要重复点击发送，使用重试或重新生成任务。\n- 对方退订：系统会自动加入抑制名单，后续营销邮件会跳过该地址。\n\n## 建议\n\n第一封只讲一个明确价值点，不要同时塞入完整报价。把详细参数留给回复后的第二轮。`,
      en: `## Prepare\n\nCheck the template, placeholders and signature under Templates. Confirm the sender mailbox is verified under Mail compliance.\n\n## Send\n\n1. Open the customer and choose Write outreach.\n2. Pick a template or write the subject and body directly.\n3. Use Preview to check placeholder rendering.\n4. Choose Send. The system creates a delivery task and writes the timeline event.\n\n## After sending\n\n- Success: the customer becomes Contacted and the outreach record shows the channel and Message-ID.\n- Failure: inspect the reason in Mail center. Do not click Send repeatedly; retry or recreate the task.\n- Opt-out: the address is added to the suppression list and future marketing mail skips it.\n\n## Advice\n\nMake one clear value point in the first email. Leave detailed pricing and specifications for the reply.`,
    },
  },
  {
    slug: 'connect-mailbox',
    category: 'mail',
    title: { zh: '连接企业邮箱与收信', en: 'Connect a business mailbox and receive replies' },
    summary: { zh: 'SMTP 发件、IMAP/POP3 收件和验证失败排查。', en: 'SMTP sending, IMAP/POP3 receiving and verification troubleshooting.' },
    minutes: 7,
    body: {
      zh: `## 发件（SMTP）\n\n推荐使用企业邮箱的授权码，不要使用网页登录密码。常见配置：主机 smtp.企业域名，端口 587，STARTTLS 开启；部分服务商使用 465 + SSL。\n\n## 收件（IMAP/POP3）\n\n在「邮件中心 → 邮箱设置」添加个人收件邮箱。IMAP 通常为 993 + SSL；POP3 通常为 995 + SSL。保存后点击「测试连接」，再启用同步。\n\n## 验证失败\n\n- 认证失败：确认使用授权码，并检查账号是否开启 SMTP/IMAP 服务。\n- 连接超时：检查防火墙、端口和服务器地址。\n- 证书错误：不要关闭证书校验；改用服务商推荐的加密端口。\n- 能发不能收：确认收件同步已启用，并检查「邮件中心」的最近同步错误。\n\n## 合规\n\n配置 SPF、DKIM 和 DMARC 后再开始批量发送。系统会在发送前检查退订链接、频率上限和抑制名单。`,
      en: `## Sending (SMTP)\n\nUse an app password or authorization code from your business mailbox, not your web login password. Typical settings: smtp.your-domain.com, port 587 with STARTTLS; some providers require port 465 with SSL.\n\n## Receiving (IMAP/POP3)\n\nAdd a personal receiving mailbox under Mail center → Mailbox settings. IMAP usually uses 993 with SSL; POP3 uses 995 with SSL. Save, run Test connection, then enable sync.\n\n## Verification failures\n\n- Authentication failed: use the app password and confirm SMTP/IMAP is enabled for the account.\n- Timeout: check firewall, port and host.\n- Certificate error: do not disable certificate validation; use the provider's encrypted port.\n- Send works but receive does not: confirm inbox sync is enabled and review the latest sync error in Mail center.\n\n## Compliance\n\nConfigure SPF, DKIM and DMARC before bulk sending. The system checks unsubscribe links, rate limits and suppression lists before delivery.`,
    },
  },
  {
    slug: 'reply-and-followup',
    category: 'mail',
    title: { zh: '处理回复与安排跟进', en: 'Handle replies and schedule follow-ups' },
    summary: { zh: '识别回复、更新状态、设置下次跟进。', en: 'Recognize replies, update status and set the next follow-up.' },
    minutes: 5,
    body: {
      zh: `## 查看回复\n\n新回复会出现在「邮件中心」和客户时间线。系统按发件人邮箱、Message-ID 和主题线程匹配客户；匹配不到时可在邮件详情中手动关联。\n\n## 更新状态\n\n根据回复内容将客户改为「已回复」「有意向」「报价中」或「谈判中」。状态变化会写入时间线，便于交接。\n\n## 安排跟进\n\n在客户详情点击「新增跟进」，记录方式、结果、内容和下次跟进时间。到期未处理的跟进会出现在仪表盘和销售助手待办中。\n\n## 退订与投诉\n\n客户明确表示不要再联系时，系统会自动抑制该邮箱。不要绕过抑制名单继续发送；如为误判，请由管理员在合规设置中复核。`,
      en: `## See replies\n\nNew replies appear in Mail center and on the customer timeline. The system matches by sender, Message-ID and subject thread. If matching fails, link the message manually from its detail view.\n\n## Update status\n\nMove the customer to Replied, Interested, Quoting or Negotiating based on the reply. Status changes are written to the timeline for handover.\n\n## Schedule a follow-up\n\nOn the customer page choose Add follow-up and record the method, result, notes and next date. Due items appear on the dashboard and in the sales assistant to-do list.\n\n## Opt-outs and complaints\n\nWhen a customer asks not to be contacted, the address is automatically suppressed. Never bypass the suppression list. Ask an administrator to review genuine mistakes in compliance settings.`,
    },
  },
  {
    slug: 'create-quote',
    category: 'quotes',
    title: { zh: '创建报价单与版本', en: 'Create quotes and versions' },
    summary: { zh: '产品明细、金额、有效期和状态联动。', en: 'Line items, totals, validity and status changes.' },
    minutes: 5,
    body: {
      zh: `## 创建\n\n在客户详情点击「新增报价单」，填写标题、币种、有效期、付款方式和交期，再添加产品明细。金额由系统按数量 × 单价计算，不能手工覆盖。\n\n## 版本\n\n修改已发出的报价会生成新版本，历史版本保留。对外发送前确认版本号和有效期，避免客户拿到过期价格。\n\n## 状态\n\n- 草稿：仅内部可见。\n- 已发送：等待客户反馈。\n- 已接受：客户确认，可进入订单流程。\n- 已拒绝 / 已过期：保留记录，必要时创建新版本。\n\n## 与客户状态联动\n\n创建报价时可勾选「标记客户为报价中」。报价被接受后，客户状态会更新为「谈判中」或「已成交」，具体取决于后续操作。`,
      en: `## Create\n\nOn the customer page choose Add quote. Enter the title, currency, validity, payment terms and lead time, then add line items. Totals are calculated from quantity × unit price and cannot be overwritten manually.\n\n## Versions\n\nEditing a sent quote creates a new version while preserving history. Confirm the version and validity before sending so the customer never receives an expired price.\n\n## Status\n\n- Draft: internal only.\n- Sent: awaiting customer feedback.\n- Accepted: customer confirmed; move to order processing.\n- Rejected / expired: keep the record and create a new version if needed.\n\n## Customer status\n\nYou can mark the customer as Quoting when creating a quote. After acceptance, the customer moves to Negotiating or Won depending on the next action.`,
    },
  },
  {
    slug: 'knowledge-and-ai',
    category: 'knowledge',
    title: { zh: '上传知识库与使用 AI 助手', en: 'Upload knowledge and use the AI assistant' },
    summary: { zh: '资料审核、发布、检索范围和 AI 密钥配置。', en: 'Review, publish, retrieval scope and AI credentials.' },
    minutes: 6,
    body: {
      zh: `## 上传资料\n\n在「知识库」上传公司介绍、产品目录、认证、价格规则和常见问题。一个文件作为一篇资料处理；上传后先看解析结果，再发布给助手使用。\n\n## 发布前检查\n\n- 产品型号、MOQ、交期和价格是否为最新版本。\n- 是否包含不应让 AI 读取的内部备注或个人信息。\n- 是否明确标注来源和生效日期。\n\n## AI 助手\n\nAI 只读取当前项目已发布的知识和授权业务数据。它默认只读，不会自动发送邮件或修改客户。管理员可在「AI 配置」选择模型和密钥；没有配置时使用 Mock Provider，仅用于演示。\n\n## 质量反馈\n\n对不满意的回答使用反馈按钮。知识库管理员会根据问题补充资料或调整审核规则。`,
      en: `## Upload\n\nUpload company profiles, product catalogs, certifications, pricing rules and FAQs under Knowledge. One file becomes one document. Review the parsed result before publishing it to the assistant.\n\n## Check before publishing\n\n- Confirm models, MOQ, lead time and prices are current.\n- Remove internal notes or personal data the AI should not read.\n- Record the source and effective date.\n\n## AI assistant\n\nThe assistant reads only published project knowledge and authorized business data. It is read-only by default and never sends email or edits customers automatically. Administrators choose the model and key under AI settings. Without a key the Mock Provider is used for demonstration only.\n\n## Quality feedback\n\nUse the feedback controls on unsatisfactory answers. Knowledge administrators can add sources or adjust review rules.`,
    },
  },
  {
    slug: 'team-roles',
    category: 'team',
    title: { zh: '团队、角色与项目权限', en: 'Teams, roles and project access' },
    summary: { zh: '管理员、项目管理员、业务员和只读账号。', en: 'Admin, project admin, sales and viewer roles.' },
    minutes: 4,
    body: {
      zh: `## 角色\n\n- 组织管理员（admin）：管理组织、成员、项目、套餐和所有业务数据。\n- 项目管理员（project_admin）：管理指定项目的品牌资料、成员和业务配置。\n- 业务员（user）：管理自己名下客户，发送开发信和创建报价。\n- 只读（viewer）：查看被授权项目的数据，不能写入或发送。\n\n## 项目隔离\n\n每个项目有独立的客户、邮件、模板和知识库。切换项目会切换整套数据视图。平台管理员也不能在普通业务接口跨组织读取数据。\n\n## 成员离职\n\n先停用账号，再转移客户负责人和待办任务。不要直接共享管理员密码；为每个人创建独立账号。`,
      en: `## Roles\n\n- Organization admin: manages the organization, members, projects, plan and all business data.\n- Project admin: manages brand data, members and settings for assigned projects.\n- Sales user: manages owned customers, sends outreach and creates quotes.\n- Viewer: reads assigned project data without write or send access.\n\n## Project isolation\n\nEach project has separate customers, mail, templates and knowledge. Switching projects switches the whole data view. Platform administrators cannot read another organization through normal business APIs.\n\n## Offboarding\n\nDisable the account first, then transfer customer ownership and open tasks. Never share an administrator password; create a separate account for every person.`,
    },
  },
  {
    slug: 'billing-usage',
    category: 'billing',
    title: { zh: '用量、套餐与发票', en: 'Usage, plans and invoices' },
    summary: { zh: '查看额度、创建账单草稿和申请套餐变更。', en: 'Review limits, create invoice drafts and request plan changes.' },
    minutes: 4,
    body: {
      zh: `## 查看用量\n\n「套餐与用量」显示当前周期的开发信、AI Token 和附件存储，以及套餐上限和估算账单。数据按组织隔离，不跨租户汇总。\n\n## 账单\n\n当前版本使用人工开票：管理员可以创建账单草稿，确认金额和周期后由财务开具正式发票。支付网关和自动扣款尚未接入。\n\n## 套餐变更\n\n联系平台管理员升级或降级。升级立即生效；降级通常在下一个周期生效。年付套餐按合同执行。\n\n## 额度提醒\n\n接近上限时系统会在界面提示。达到硬上限时新增用量会暂停，已有数据不会删除。`,
      en: `## Review usage\n\nPlans and usage shows outreach emails, AI tokens and attachment storage for the current period, plus limits and an estimated invoice. Data is scoped to your organization and never aggregated across tenants.\n\n## Invoices\n\nBilling is currently manual. Administrators can create an invoice draft; finance issues the formal invoice after confirming the amount and period. A payment gateway and automatic charging are not yet connected.\n\n## Plan changes\n\nAsk a platform administrator to upgrade or downgrade. Upgrades take effect immediately; downgrades usually apply at the next period. Annual plans follow the signed order.\n\n## Limit alerts\n\nThe UI warns when usage approaches a limit. At a hard cap new usage pauses and existing data is retained.`,
    },
  },
  {
    slug: 'security-data',
    category: 'security',
    title: { zh: '账号安全、数据导出与删除', en: 'Account security, export and deletion' },
    summary: { zh: '强密码、2FA、导出和删除请求。', en: 'Strong passwords, 2FA, export and deletion requests.' },
    minutes: 4,
    body: {
      zh: `## 账号安全\n\n使用至少 12 位、包含大小写字母、数字和符号的独立密码。管理员和财务账号必须绑定邮箱并开启两步验证。不要通过聊天工具发送密码或 API Key。\n\n## 会话\n\n系统使用 HttpOnly Cookie 和可轮换的刷新令牌。离开公共电脑前点击退出登录；发现异常登录时立即重置密码并联系管理员。\n\n## 导出\n\n客户列表支持 Excel 导出；邮件和附件可在邮件详情下载。导出前确认接收人权限，避免把客户名单发送到个人邮箱。\n\n## 删除\n\n删除客户会级联删除其跟进、开发信和附件。组织注销或数据主体删除请求由管理员提交，平台在合同约定的保留期后完成清理并出具确认。`,
      en: `## Account security\n\nUse a unique password of at least 12 characters with upper and lower case, numbers and symbols. Administrators and finance users must add an email address and enable two-factor authentication. Never send passwords or API keys through chat.\n\n## Sessions\n\nThe app uses HttpOnly cookies and rotating refresh tokens. Sign out before leaving a shared computer; if you notice unusual activity, reset the password and contact an administrator.\n\n## Export\n\nThe customer list exports to Excel; emails and attachments download from the message detail. Confirm the recipient is authorized before exporting a customer list.\n\n## Deletion\n\nDeleting a customer cascades to follow-ups, outreach and attachments. Organization closure or data-subject deletion requests are submitted by an administrator; the platform completes deletion after the contractual retention period and provides confirmation.`,
    },
  },
];
