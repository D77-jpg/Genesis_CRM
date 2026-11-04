export type LegalDocId = 'terms' | 'privacy' | 'dpa' | 'sla';

export interface LegalDocument {
  id: LegalDocId;
  title: { zh: string; en: string };
  summary: { zh: string; en: string };
  updated: string;
  body: { zh: string; en: string };
}

const ENTITY = '[运营主体法定名称 / Legal entity name]';
const ADDRESS = '[注册地址 / Registered address]';
const LAW = '[适用法律与管辖地 / Governing law and jurisdiction]';

export const LEGAL_DOCUMENTS: Record<LegalDocId, LegalDocument> = {
  terms: {
    id: 'terms',
    title: { zh: '服务条款', en: 'Terms of Service' },
    summary: { zh: '规范 Genesis CRM 服务的使用、账户、数据、费用和责任。', en: 'Rules for using Genesis CRM, including accounts, data, fees and liability.' },
    updated: '2026-11-04',
    body: {
      zh: `## 1. 协议范围

本服务条款（“条款”）是你与 ${ENTITY}（“我们”）之间关于 Genesis CRM 云服务（“服务”）的协议。注册、访问或使用服务即表示你代表所在组织接受本条款；如果你没有授权，请不要使用服务。

## 2. 服务内容

服务包括多租户 CRM、客户与线索管理、开发信与邮件同步、报价管理、知识库、AI 辅助和相关支持。具体功能以你订购的套餐和订单为准。我们可能持续改进服务，但不会实质性削减已付费的核心功能。

## 3. 账户与安全

- 你负责确保账户信息真实、准确，并妥善保管登录凭据。
- 每个用户应使用独立账户；不得共享管理员密码。
- 如发现未经授权的访问，应立即重置密码并通知我们。
- 你可以为成员分配组织管理员、项目管理员、业务员或只读角色。

## 4. 客户数据与内容

你保留对导入的客户数据、邮件、附件、知识库内容及 AI 输入输出（“客户数据”）的所有权。你授予我们为提供服务、支持和履行法律义务而处理客户数据的有限许可。我们不会将客户数据出售给第三方，也不会用于训练面向其他客户的通用模型。

你声明并保证：你已取得处理客户数据所需的授权和合法基础，特别是发送营销邮件、进行打开/点击追踪以及向 AI 提供商传输必要内容时。

## 5. 可接受使用

不得使用服务：

- 发送垃圾邮件、欺诈信息或违反适用反垃圾邮件法律的内容；
- 侵犯知识产权、隐私权或其他第三方权利；
- 上传恶意软件、进行渗透攻击、绕过速率限制或干扰服务；
- 处理受法律禁止或需要额外监管审批的高度敏感数据；
- 伪装身份、伪造发件人或规避退订/抑制名单。

我们可对涉嫌滥用采取限流、暂停发送或暂停账户的措施，并在合理可行时通知你。

## 6. 费用与付款

费用以订单或价格页为准，以美元计价，不含税费。除非另有约定，账单按所选周期预付。逾期未付的金额可能产生滞纳金；我们可在合理通知后暂停服务。除法律要求或本条款明确约定外，已付款项不予退还。

当前版本采用人工开票；支付网关、自动续费和在线退款流程尚未接入。套餐升级自确认时生效，降级通常自下一周期生效。

## 7. 试用

试用期默认 14 天，仅供评估。试用数据在转为付费账户后保留；若未转化，我们可在试用结束后 30 天内删除，法律要求保留的除外。

## 8. 知识产权

我们及许可方保留服务、软件、文档、商标和聚合统计数据的全部权利。你不得复制、反编译、转售或基于服务创建竞争产品，除非法律允许或我们书面同意。反馈可被我们无偿用于改进服务。

## 9. 保密

双方应对披露的保密信息采取合理保护，仅用于履行本条款，并在协议终止后继续承担保密义务。法律要求披露时，应尽可能提前通知对方。

## 10. 保证与免责

我们以商业上合理的技能提供服务，并努力保持服务可用。除本条款、SLA 或订单明确约定外，服务按“现状”提供，不提供其他明示或默示保证。我们不保证服务不会中断、无错误，或 AI 输出必然准确、完整或适合特定商业决策。

## 11. 责任限制

在法律允许的最大范围内，任何一方均不对间接、附带、特殊、惩罚性或后果性损失承担责任，包括利润、收入、商誉或数据损失。除因故意或重大过失、违反保密义务、侵犯知识产权或依法不可限制的责任外，我们的累计责任不超过索赔发生前 12 个月内你已支付的服务费用。

## 12. 赔偿

如因你违反可接受使用、侵犯第三方权利或违法处理客户数据而导致第三方索赔，你应赔偿我们及关联方因此产生的合理损失和费用。

## 13. 暂停与终止

- 你可以随时停止使用服务；已付款项按第 6 条处理。
- 我们可在你严重违约、违法或危害服务安全时暂停或终止账户。
- 终止后，你可在 30 天内导出客户数据；逾期后我们将按隐私政策和 DPA 删除或匿名化。
- 终止不影响已产生的付款义务、保密、责任限制和争议解决条款。

## 14. 适用法律与争议解决

本条款适用 ${LAW}，不考虑冲突法规则。双方应先友好协商；协商不成的，提交该管辖地有管辖权的法院。若你所在地区的强制性消费者或数据保护法律赋予你额外权利，该等权利不受影响。

## 15. 变更与联系

我们可能更新本条款，并在重大变更生效前通过服务内通知或邮件告知。继续使用即视为接受更新后的条款。联系地址：${ADDRESS}；支持邮箱：support@genesisgroup.cn。

> 本文本为上市准备版本，具体运营主体、注册地址、适用法律和商业条款需由法务顾问在正式签约前复核。`,
      en: `## 1. Scope

These Terms of Service ("Terms") govern your access to the Genesis CRM cloud service ("Service") provided by ${ENTITY} ("we", "us"). By registering, accessing or using the Service, you accept these Terms on behalf of your organization. If you are not authorized, do not use the Service.

## 2. The Service

The Service includes a multi-tenant CRM, customer and lead management, outreach and mailbox sync, quotation management, knowledge base, AI assistance and related support. Features depend on the plan and order you purchase. We may improve the Service but will not materially reduce paid core functionality.

## 3. Accounts and security

- You are responsible for accurate account information and safeguarding credentials.
- Every user must have a separate account; administrator passwords must not be shared.
- If you suspect unauthorized access, reset the password and notify us promptly.
- You may assign organization admin, project admin, sales or viewer roles.

## 4. Customer Data

You retain ownership of imported customer records, emails, attachments, knowledge content and AI inputs/outputs ("Customer Data"). You grant us a limited license to process Customer Data to provide the Service, support you and comply with law. We do not sell Customer Data or use it to train general models for other customers.

You represent that you have the required authorizations and lawful bases to process Customer Data, including sending marketing email, applying open/click tracking and transmitting necessary content to AI providers.

## 5. Acceptable use

You must not use the Service to:

- send spam, fraudulent messages or content that violates anti-spam law;
- infringe intellectual property, privacy or other third-party rights;
- upload malware, conduct penetration attacks, bypass rate limits or disrupt the Service;
- process highly sensitive data that is prohibited by law or requires additional regulatory approval;
- impersonate another person, forge a sender or evade opt-out/suppression lists.

We may rate-limit, suspend sending or suspend an account for suspected abuse and will notify you where reasonably practicable.

## 6. Fees and payment

Fees are stated in the order or pricing page, in USD, excluding taxes. Unless agreed otherwise, invoices are prepaid for the selected period. Late amounts may incur interest, and we may suspend the Service after reasonable notice. Except where required by law or expressly stated, payments are non-refundable.

Billing is currently manual. A payment gateway, automatic renewal and online refunds are not yet connected. Upgrades take effect on confirmation; downgrades generally apply to the next period.

## 7. Trial

The default trial is 14 days and is for evaluation. Trial data is retained when you convert to a paid account; if you do not convert, we may delete it within 30 days after the trial, except where law requires retention.

## 8. Intellectual property

We and our licensors retain all rights in the Service, software, documentation, trademarks and aggregated statistics. You may not copy, decompile, resell or build a competing product from the Service except as permitted by law or our written consent. Feedback may be used without compensation to improve the Service.

## 9. Confidentiality

Each party will protect the other's confidential information with reasonable care, use it only to perform these Terms and keep it confidential after termination. Where disclosure is legally required, the disclosing party will give prompt notice where possible.

## 10. Warranties and disclaimers

We provide the Service with commercially reasonable skill and effort and work to keep it available. Except as expressly stated in these Terms, the SLA or an order, the Service is provided "as is" without other express or implied warranties. We do not warrant uninterrupted or error-free operation, or that AI output will be accurate, complete or suitable for a particular business decision.

## 11. Limitation of liability

To the maximum extent permitted by law, neither party is liable for indirect, incidental, special, punitive or consequential loss, including lost profits, revenue, goodwill or data. Except for willful misconduct, gross negligence, breach of confidentiality, IP infringement or liability that cannot be limited by law, our aggregate liability will not exceed the Service fees you paid in the 12 months before the claim.

## 12. Indemnity

If a third-party claim arises from your breach of acceptable use, infringement of third-party rights or unlawful processing of Customer Data, you will indemnify us and our affiliates for reasonable losses and costs.

## 13. Suspension and termination

- You may stop using the Service at any time; refunds follow Section 6.
- We may suspend or terminate an account for material breach, illegal activity or harm to the Service.
- After termination you may export Customer Data for 30 days; afterwards we delete or anonymize it under the Privacy Policy and DPA.
- Termination does not affect accrued payment obligations, confidentiality, liability limits or dispute resolution.

## 14. Governing law and disputes

These Terms are governed by ${LAW}, excluding conflict-of-law rules. The parties will first attempt good-faith negotiation; unresolved disputes will be submitted to the competent courts of that jurisdiction. Mandatory consumer or data-protection rights in your region are not affected.

## 15. Changes and contact

We may update these Terms and will notify you of material changes before they take effect through the Service or email. Continued use constitutes acceptance. Contact: ${ADDRESS}; support: support@genesisgroup.cn.

> This is a launch-readiness draft. The legal entity, registered address, governing law and commercial terms must be reviewed by counsel before execution.`,
    },
  },
  privacy: {
    id: 'privacy',
    title: { zh: '隐私政策', en: 'Privacy Policy' },
    summary: { zh: '说明我们收集哪些数据、如何处理、保留和共享。', en: 'What data we collect, how we use, retain and share it.' },
    updated: '2026-11-04',
    body: {
      zh: `## 1. 适用范围

本政策适用于 Genesis CRM 网站、应用、API 和支持渠道。企业客户在其组织内导入的客户数据由该客户控制，我们作为处理者按 DPA 处理；我们为自身营销、安全和账户管理处理的数据由我们作为控制者。

## 2. 我们收集的数据

- **账户与组织数据**：姓名、用户名、邮箱、角色、所属组织、登录时间和安全事件。
- **业务数据**：客户联系人、公司、邮箱、国家、跟进记录、开发信、报价、知识库文档和附件。
- **邮件数据**：发件人、收件人、主题、正文、附件、Message-ID、退订/退回状态，以及打开和点击事件。
- **AI 数据**：你提交的提示词、检索到的知识片段和模型输出。
- **技术数据**：IP 地址、设备/浏览器信息、请求日志、错误日志、用量指标和 Cookie/本地存储标识。

我们不主动收集支付卡号；当前人工开票所需的银行信息由财务在独立渠道处理。

## 3. 处理目的与法律基础

我们处理数据用于：提供和保障服务、验证身份、发送事务通知、同步邮件、生成报价、提供 AI 辅助、计量计费、排查故障、防止滥用和遵守法律。法律基础取决于场景，包括履行合同、合法利益（服务安全与改进）、同意（非必要 Cookie 或营销）和法律义务。

## 4. 邮件追踪

开发信可包含打开像素和链接追踪。你应在发送前确认已获得所需同意，并在隐私政策中披露追踪。收件人可通过退订链接或联系我们选择退出；我们支持组织级和全局抑制名单。

## 5. 共享与子处理者

我们不会出售个人数据。我们与以下类别的服务商共享必要数据：

- 云主机、数据库和对象存储提供商；
- 邮件发送与收件服务商；
- AI 模型提供商（仅传输完成请求所需内容）；
- 错误监控、日志和客户支持工具；
- 专业顾问、审计机构和依法要求的政府机关。

子处理者名单可向 support@genesisgroup.cn 索取。我们与子处理者签署保密和数据保护条款，并要求其提供不低于本政策的保护水平。

## 6. 国际传输

数据可能在你所在国家以外处理。涉及欧洲经济区、英国或瑞士的个人数据时，我们采用欧盟标准合同条款（SCC）或法律认可的等效机制，并根据需要实施补充措施。

## 7. 保留期限

- 账户和组织数据：账户存续期间，终止后 30 天内删除或匿名化。
- 客户业务数据：由组织管理员配置；终止后 30 天内可导出，之后删除。
- 邮件与附件：按组织设置和套餐保留；删除客户时级联删除。
- 安全与审计日志：通常 180 天，法律要求或调查需要时更长。
- 备份：滚动备份最长 30 天，之后按备份周期覆盖。

## 8. 安全措施

我们采用 TLS、密码哈希、HttpOnly Cookie、CSRF 防护、基于角色的访问控制、租户隔离、速率限制、审计日志、最小权限和加密凭据存储。没有系统能保证绝对安全；如发生影响你数据的泄露，我们将按 DPA 和法律要求通知。

## 9. 你的权利

在适用法律范围内，你可以请求访问、更正、删除、限制处理、导出或反对处理，并有权向监管机构投诉。组织成员应首先联系其组织管理员；我们会在收到请求后 30 天内响应，复杂请求可延长。

## 10. Cookie

我们使用必要的 Cookie 维持登录、CSRF 防护和语言偏好，可能使用本地存储保存界面状态。非必要分析或营销 Cookie 仅在你同意时使用。你可以通过浏览器设置清除 Cookie，但这会影响登录。

## 11. 儿童

服务面向企业和商业用户，不面向 16 岁以下儿童。我们不会有意收集儿童个人数据。

## 12. 变更与联系

我们可能更新本政策，并在重大变更时通过服务或邮件通知。控制者/处理者联系：${ENTITY}，${ADDRESS}，privacy@genesisgroup.cn。

> 本文本为上市准备版本，需由隐私顾问结合运营主体、部署区域、邮件服务商和 AI 子处理者复核。`,
      en: `## 1. Scope

This Policy applies to the Genesis CRM website, application, API and support channels. Customer data imported by a business customer is controlled by that customer and processed by us as a processor under the DPA. Data we process for our own marketing, security and account administration is controlled by us.

## 2. Data we collect

- **Account and organization data**: name, username, email, role, organization, sign-in times and security events.
- **Business data**: customer contacts, company, email, country, follow-up notes, outreach, quotes, knowledge documents and attachments.
- **Mail data**: sender, recipient, subject, body, attachments, Message-ID, opt-out/bounce status, and open/click events.
- **AI data**: prompts you submit, retrieved knowledge snippets and model output.
- **Technical data**: IP address, device/browser information, request and error logs, usage metrics, and cookie/local-storage identifiers.

We do not intentionally collect payment card numbers. Bank details for manual invoicing are handled separately by finance.

## 3. Purposes and legal bases

We process data to provide and secure the Service, authenticate users, send transactional notices, sync mail, generate quotes, provide AI assistance, meter billing, troubleshoot, prevent abuse and comply with law. Legal bases depend on context and include performance of a contract, legitimate interests (security and improvement), consent (non-essential cookies or marketing) and legal obligations.

## 4. Email tracking

Outreach may include open pixels and link tracking. You should confirm required consent and disclose tracking in your own privacy notice before sending. Recipients can opt out through the unsubscribe link or by contacting us; organization-level and global suppression lists are supported.

## 5. Sharing and subprocessors

We do not sell personal data. We share necessary data with:

- cloud hosting, database and object-storage providers;
- email delivery and receiving providers;
- AI model providers (only content needed to fulfill a request);
- error monitoring, logging and customer-support tools;
- professional advisers, auditors and authorities where required by law.

A subprocessor list is available from support@genesisgroup.cn. We impose confidentiality and data-protection terms and require protection no less protective than this Policy.

## 6. International transfers

Data may be processed outside your country. For personal data from the EEA, UK or Switzerland we use the EU Standard Contractual Clauses (SCCs) or a recognized equivalent, with supplementary measures where needed.

## 7. Retention

- Account and organization data: while the account is active and for 30 days after termination, then deleted or anonymized.
- Customer business data: configured by the organization admin; exportable for 30 days after termination, then deleted.
- Mail and attachments: per organization settings and plan; deleting a customer cascades to its mail.
- Security and audit logs: normally 180 days, longer for legal requirements or investigations.
- Backups: rolling backups up to 30 days, then overwritten by the backup cycle.

## 8. Security

We use TLS, password hashing, HttpOnly cookies, CSRF protection, role-based access control, tenant isolation, rate limits, audit logs, least privilege and encrypted credential storage. No system is absolutely secure. If a breach affects your data, we will notify you as required by the DPA and law.

## 9. Your rights

Where applicable law provides them, you may request access, correction, deletion, restriction, portability or object to processing, and may complain to a regulator. Organization members should contact their administrator first. We respond within 30 days, with an extension for complex requests where permitted.

## 10. Cookies

We use essential cookies for sign-in, CSRF protection and language preference, and local storage for interface state. Non-essential analytics or marketing cookies are used only with consent. Clearing cookies in your browser will affect sign-in.

## 11. Children

The Service is for business users and is not directed to children under 16. We do not knowingly collect children's personal data.

## 12. Changes and contact

We may update this Policy and will notify material changes through the Service or email. Controller/processor contact: ${ENTITY}, ${ADDRESS}, privacy@genesisgroup.cn.

> This is a launch-readiness draft. It must be reviewed by privacy counsel against the operating entity, deployment regions, mail providers and AI subprocessors.`,
    },
  },
  dpa: {
    id: 'dpa',
    title: { zh: '数据处理协议（DPA）', en: 'Data Processing Agreement (DPA)' },
    summary: { zh: '客户作为控制者、Genesis CRM 作为处理者时的数据保护条款。', en: 'Data-protection terms when the customer is controller and Genesis CRM is processor.' },
    updated: '2026-11-04',
    body: {
      zh: `## 1. 角色与范围

本 DPA 适用于我们为提供 Genesis CRM 服务而代表客户处理个人数据的情形。客户是控制者，我们是处理者。附件订单、主服务条款和本 DPA 共同构成完整协议；冲突时，就个人数据保护事项以本 DPA 为准。

## 2. 处理说明

- **主题**：CRM、邮件同步、开发信、报价、知识库和 AI 辅助。
- **持续时间**：服务订阅期间及终止后的约定清理期。
- **数据类型**：客户联系人信息、业务沟通、邮件内容与附件、跟进记录、报价、知识库内容和用量日志。
- **数据主体**：客户的员工、联系人、潜在客户和邮件收件人。
- **特殊类别数据**：服务不要求处理特殊类别数据；客户不得主动提交除非已告知我们并取得合法基础。

## 3. 客户指示

我们仅按客户通过界面、API 或书面支持请求作出的指示处理个人数据，包括本 DPA 和主协议。我们会在发现指示违反适用法律时通知客户，并有权暂停相关处理。

## 4. 保密与人员

我们确保获授权人员仅在有业务需要时访问个人数据，并承担保密义务。我们提供适当培训，并对访问进行日志记录和定期复核。

## 5. 安全措施

我们实施与风险相称的技术和组织措施，包括：

- 传输加密、访问控制、密码哈希和多因素认证；
- 租户隔离、最小权限、审计日志和变更管理；
- 备份、漏洞管理、事件响应和供应商风险评估；
- 凭据加密存储、速率限制、CSRF 防护和输入校验；
- 开发、预发布和生产环境隔离，以及版本化数据库迁移。

## 6. 子处理者

客户一般授权我们使用第 5 条所列类别的子处理者。我们会在新增或替换子处理者前通过服务或邮件提供通知，并给予客户合理的反对机会。客户反对时，双方可协商替代方案；无法达成时，客户可终止受影响的服务。

## 7. 协助义务

在合理范围内，我们协助客户响应数据主体请求、进行数据保护影响评估（DPIA）和事前咨询监管机构。若数据主体直接联系我们，我们会引导其联系客户，除非法律要求另行处理。

## 8. 数据泄露

发现个人数据泄露后，我们会在 48 小时内通知客户，提供已知的性质、范围、可能后果和已采取的措施。通知不构成对责任的承认。客户负责评估是否向监管机构或数据主体通报。

## 9. 国际传输

如个人数据从 EEA、英国或瑞士传输至未获充分性认定的国家，双方以欧盟 SCC 或等效条款为传输机制，并应要求签署附件。补充措施包括传输加密、访问限制和供应商评估。

## 10. 审计与证明

我们应客户合理请求提供最近的安全认证、审计摘要或问卷答复，并允许在提前 30 天通知后进行有限审计。审计不得影响其他客户安全或保密，费用由客户承担，除非审计发现重大不合规。

## 11. 删除与返还

服务终止或客户要求时，我们将在 30 天内返还或删除个人数据，法律要求保留的除外。备份中的副本将在滚动备份周期内被覆盖；我们保证其不被恢复用于业务目的。

## 12. 责任与期限

本 DPA 在服务协议存续期间有效，并在终止后持续至数据处理和删除完成。责任限制适用主协议，但法律不允许限制的责任除外。

## 13. 签署

正式签署时由双方授权代表完成。运营主体、地址和适用法律以订单为准：${ENTITY}，${ADDRESS}，${LAW}。联系方式：dpo@genesisgroup.cn。

> 本文本为 DPA 模板，正式签约前需由双方律师复核，并根据实际子处理者、部署区域和客户所在法域补充附件。`,
      en: `## 1. Roles and scope

This DPA applies when we process personal data on behalf of the customer to provide Genesis CRM. The customer is the controller and we are the processor. The order, master terms and this DPA form one agreement; for personal-data protection, this DPA controls conflicts.

## 2. Processing details

- **Subject matter**: CRM, mailbox sync, outreach, quotes, knowledge base and AI assistance.
- **Duration**: the subscription term and agreed cleanup period after termination.
- **Data types**: customer contact details, business communications, email content and attachments, follow-up records, quotes, knowledge content and usage logs.
- **Data subjects**: customer employees, contacts, prospects and email recipients.
- **Special categories**: the Service does not require special-category data; the customer must not submit it without informing us and establishing a lawful basis.

## 3. Customer instructions

We process personal data only on instructions from the customer through the UI, API or written support request, including this DPA and the master agreement. If we believe an instruction violates law, we will notify the customer and may suspend the processing.

## 4. Confidentiality and personnel

We ensure authorized personnel access personal data only when needed and are bound by confidentiality. We provide appropriate training and log and periodically review access.

## 5. Security measures

We implement technical and organizational measures proportionate to risk, including:

- encryption in transit, access control, password hashing and multi-factor authentication;
- tenant isolation, least privilege, audit logs and change management;
- backups, vulnerability management, incident response and vendor risk assessment;
- encrypted credential storage, rate limits, CSRF protection and input validation;
- separate development, staging and production environments and versioned database migrations.

## 6. Subprocessors

The customer generally authorizes the categories of subprocessors listed in Section 5 of the Privacy Policy. We will notify the customer through the Service or email before adding or replacing a subprocessor and provide a reasonable opportunity to object. If the parties cannot agree on an alternative, the customer may terminate the affected service.

## 7. Assistance

We reasonably assist with data-subject requests, data-protection impact assessments (DPIAs) and prior consultations. If a data subject contacts us directly, we will refer them to the customer unless law requires otherwise.

## 8. Personal data breach

After becoming aware of a personal-data breach, we will notify the customer within 48 hours with the known nature, scope, likely consequences and measures taken. Notice is not an admission of liability. The customer decides whether to notify regulators or data subjects.

## 9. International transfers

If personal data is transferred from the EEA, UK or Switzerland to a country without an adequacy decision, the parties rely on the EU SCCs or an equivalent mechanism and will execute the relevant annex on request. Supplementary measures include encryption in transit, access restrictions and vendor assessments.

## 10. Audits and evidence

On reasonable request we provide recent security certifications, audit summaries or questionnaire responses, and allow a limited audit with 30 days' notice. Audits must not compromise other customers' security or confidentiality. The customer bears the cost unless the audit finds material non-compliance.

## 11. Deletion and return

On termination or customer request, we return or delete personal data within 30 days, except where law requires retention. Copies in backups are overwritten within the rolling backup cycle and are not restored for business use.

## 12. Liability and term

This DPA is effective for the term of the service agreement and continues until processing and deletion are complete. Liability limits in the master agreement apply except where law prohibits limitation.

## 13. Signature

Authorized representatives sign at contract execution. The operating entity, address and governing law follow the order: ${ENTITY}, ${ADDRESS}, ${LAW}. Contact: dpo@genesisgroup.cn.

> This is a DPA template. Both parties' counsel should review it before signature and complete annexes for actual subprocessors, deployment regions and the customer's jurisdiction.`,
    },
  },
  sla: {
    id: 'sla',
    title: { zh: '服务等级协议（SLA）', en: 'Service Level Agreement (SLA)' },
    summary: { zh: '可用性目标、支持响应时间和服务补偿。', en: 'Availability target, support response times and service credits.' },
    updated: '2026-11-04',
    body: {
      zh: `## 1. 适用范围

本 SLA 适用于付费套餐的 Genesis CRM 托管服务。试用、免费额度、第三方邮件服务商、客户自有 SMTP/IMAP 服务和客户网络不在可用性承诺范围内。

## 2. 可用性目标

我们承诺每个自然月 **99.9%** 的服务可用性（“月度正常运行时间”）。可用性按以下公式计算：

\`\`\`
可用性 = (总分钟数 - 不可用分钟数) / 总分钟数 × 100%
\`\`\`

“不可用”指核心 API（登录、客户列表、开发信发送、邮件同步、报价）连续 5 分钟以上无法正常响应，且由我们的基础设施或软件导致。计划维护、客户配置错误、第三方服务中断、网络攻击和不可抗力不计入。

## 3. 支持等级与响应目标

| 等级 | 定义 | 首次响应目标 | 更新频率 |
| --- | --- | --- | --- |
| P1 紧急 | 服务全面不可用、数据泄露风险或核心流程完全阻断 | 1 小时 | 每 2 小时 |
| P2 高 | 主要功能严重受限，无合理绕过方案 | 4 工作小时 | 每个工作日 |
| P3 中 | 部分功能异常，有可用的绕过方案 | 1 个工作日 | 每 2 个工作日 |
| P4 低 | 咨询、配置请求或外观问题 | 2 个工作日 | 按需 |

支持时间为北京时间工作日 09:00–18:00；P1 提供 7×24 值班响应。响应目标不等于修复时间。

## 4. 服务补偿

若月度可用性低于 99.9%，客户可在事件结束后 30 天内提交补偿申请：

| 月度可用性 | 服务补偿（占月度费用） |
| --- | --- |
| 99.0% – 99.9% | 5% |
| 95.0% – 99.0% | 10% |
| 低于 95.0% | 25% |

补偿以服务抵扣形式发放，不折现，且不得超过对应月份的已付费用。补偿是违反可用性承诺的唯一救济。

## 5. 维护

我们尽量提前 72 小时通知计划维护，紧急安全维护可缩短通知。计划维护优先安排在北京时间低峰时段，并尽量在 4 小时内完成。

## 6. 客户责任

客户应提供有效的支持联系人、保持客户端和网络符合要求、及时报告故障，并配合故障排查。因客户未履行义务导致的延迟不计入响应目标。

## 7. 数据与恢复

我们按备份策略保护数据，但本 SLA 不替代客户自身的导出和备份责任。发生区域级故障时，恢复时间目标（RTO）为 8 小时，恢复点目标（RPO）为 24 小时，具体取决于基础设施提供商。

## 8. 除外情形

- 不可抗力、战争、罢工、政府行为或大规模网络攻击；
- 客户或第三方网络、设备、浏览器或邮件服务商问题；
- 客户违反服务条款或配置错误；
- 非我们控制的开源软件、AI 模型或第三方 API 变更；
- 计划维护和客户请求的测试。

## 9. 联系

故障报告：support@genesisgroup.cn；紧急电话以订单或支持门户为准。运营主体：${ENTITY}，${ADDRESS}。适用法律：${LAW}。

> 本 SLA 为上市准备模板，补偿比例、支持时段和 RTO/RPO 需结合真实运维能力和合同承诺复核。`,
      en: `## 1. Scope

This SLA applies to the hosted Genesis CRM service on paid plans. Trials, free allowances, third-party mail providers, customer-owned SMTP/IMAP services and customer networks are outside the availability commitment.

## 2. Availability target

We target **99.9%** Service availability each calendar month ("Monthly Uptime"). Availability is calculated as:

\`\`\`
Availability = (total minutes - unavailable minutes) / total minutes × 100%
\`\`\`

"Unavailable" means core APIs (sign-in, customer list, outreach sending, mailbox sync, quotes) fail to respond normally for more than 5 consecutive minutes due to our infrastructure or software. Scheduled maintenance, customer misconfiguration, third-party outages, network attacks and force majeure are excluded.

## 3. Support severity and response targets

| Severity | Definition | First response | Updates |
| --- | --- | --- | --- |
| P1 Critical | Full outage, data-breach risk or complete block of a core workflow | 1 hour | Every 2 hours |
| P2 High | Major function severely limited with no reasonable workaround | 4 business hours | Each business day |
| P3 Medium | Partial malfunction with a workaround | 1 business day | Every 2 business days |
| P4 Low | Question, configuration request or cosmetic issue | 2 business days | As needed |

Support hours are 09:00–18:00 China Standard Time on business days; P1 has 24×7 on-call response. Response targets are not fix times.

## 4. Service credits

If Monthly Uptime is below 99.9%, the customer may request a credit within 30 days after the incident:

| Monthly Uptime | Service credit (% of monthly fee) |
| --- | --- |
| 99.0% – 99.9% | 5% |
| 95.0% – 99.0% | 10% |
| Below 95.0% | 25% |

Credits are applied to future service, are not convertible to cash and may not exceed the fees paid for the affected month. Credits are the sole remedy for missing the availability commitment.

## 5. Maintenance

We aim to give 72 hours' notice of scheduled maintenance; emergency security maintenance may have shorter notice. Scheduled work is preferred during low-traffic hours in China Standard Time and targeted for completion within 4 hours.

## 6. Customer responsibilities

The customer must provide a valid support contact, keep clients and networks within supported configurations, report incidents promptly and cooperate with troubleshooting. Delays caused by the customer's failure to meet these responsibilities do not count toward response targets.

## 7. Data and recovery

We protect data under our backup policy, but this SLA does not replace the customer's own export and backup responsibilities. For a regional failure, the recovery time objective (RTO) is 8 hours and the recovery point objective (RPO) is 24 hours, subject to the infrastructure provider.

## 8. Exclusions

- force majeure, war, strikes, government action or large-scale network attacks;
- customer or third-party network, device, browser or mail-provider issues;
- breach of the Terms or customer misconfiguration;
- changes to open-source software, AI models or third-party APIs outside our control;
- scheduled maintenance and customer-requested testing.

## 9. Contact

Incident reports: support@genesisgroup.cn; emergency phone as stated in the order or support portal. Operating entity: ${ENTITY}, ${ADDRESS}. Governing law: ${LAW}.

> This SLA is a launch-readiness template. Credit percentages, support hours and RTO/RPO must be validated against actual operations and contractual commitments.`,
    },
  },
};
