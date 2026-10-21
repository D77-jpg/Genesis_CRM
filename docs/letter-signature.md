# 开发信固定结尾（公司签名）

服务端统一的开发信结尾。业务员自己审核、自己发送，结尾不再各写一套。

## 结构

```
{Douglas Carlos}                      ← 当前使用账号的姓名（加粗）
Sales Manager, Genesis (Xiamen) Bags Co., Ltd.
──────────────────────────────        ← <hr>
Genesis Bags · Custom Packaging Manufacturer · Xiamen· Where Packaging Begins
WhatsApp +86 153 0600 1357 · sales@genesisbags.com
genesisbags.com · genesisgroup.en.alibaba.com
Gold Supplier on Alibaba.com since 2014 · ISO 9001 / FSC® / BSCI Certified
```

第一行以外的内容写在 `server/src/services/letter-signature.ts` 的 `LETTER_SIGNATURE` 里，改这一个常量即可全站生效。

## 第一行取谁的名字

`signatureName()` 的优先级：

1. 该账号**个人发件邮箱的显示名**（`UserMailAccount.displayName`）——签名跟「用哪个账号发」走
2. 登录账号的姓名（`User.displayName`）
3. 项目「我方信息」里的发件人署名（`Project.senderName`）
4. `SENDER_NAME` 环境变量
5. 兜底 `Sales Team`

所以：想让签名显示 `Douglas Carlos`，把账号姓名或个人发件邮箱显示名设成它即可；同一份代码下不同业务员发出去的结尾名字不同，其余信息完全相同。

同一个值也用于占位符 `{{senderName}}`，避免「正文里的署名」和「结尾的署名」不是同一个人。

## 生效位置

| 场景 | 位置 | 说明 |
| --- | --- | --- |
| Agent 生成稿 | `knowledge-grounding.ts` / `fact-verifier.ts` | 逐项核验阶段就写入纯文本签名，`knowledgeReview.bodyHash` 因此包含签名 |
| 生成稿存成草稿 | `customer-analysis.service.ts` → `renderLetterContent()` | 把同一段换成 HTML 版（名字加粗 + 细线），`contentText` 与纯文本版逐字一致 |
| 模板信 / 回复 / 手写 | `letter.service.ts` `renderLetter()` → `ensureSignature()` | 渲染时补结尾；模板自带的 `Best,<br>{{senderName}}<br>{{companyName}}` 会先被 `stripTrailingSignoff()` 去掉，不会出现两套署名 |
| 预览接口 | 同 `renderLetter()` | 预览、草稿、实际发送是同一份内容，审核看到的等于客户收到的 |

`SIGNATURE_MARKER`（`Gold Supplier on Alibaba.com since 2014` 那一行）用于幂等判断：正文里已经有这一行就不再追加。重复保存草稿、重发、审核通过后再次渲染都不会叠出第二份签名。

## 界面上怎么看

- **审核弹窗**「审核结论」卡底部有「结尾（发送时统一追加，正文里不用写落款）」预览：第一行就是当前账号的姓名，下面是固定信息。Agent 草稿的正文本身已含结尾，预览会自动隐藏（避免同一段出现两次）。
- **模板中心**的模板正文不要再写 `Best, {{senderName}} {{companyName}}` 这类落款；写了也会被 `stripTrailingSignoff()` 去掉再用固定结尾替换（富文本编辑器把落款拆成多个 `<p>` 也能处理）。
- 只有「预览」页签看到的是渲染后的完整邮件，编辑区保留模板占位符（`{{firstName}}` 等），这是既有行为。

## 品牌 logo

签名里带 `GENESIS PACKAGING` 的图片，由服务端提供：

- 图片本体内联在 `server/src/constants/brand-logo.ts`（320×192 PNG，base64，约 7KB），不依赖构建产物。
- 对外地址 `GET /api/brand/genesis-logo.png`：邮件客户端不带 JWT（和追踪像素同理），所以这个路由不鉴权、只返回这一张固定图片。
- 邮件里的 `<img>` 用 `PUBLIC_BASE_URL`（留空复用 `TRACKING_BASE_URL`）拼成绝对地址，收件人必须能访问到这个 CRM 地址——和追踪像素是同一个前提。
- `.env` 里 `SIGNATURE_LOGO=false` 可关掉图片，只发文字签名。

`safeMailHtml()` 仍然剥离所有远程图片（防追踪像素/钓鱼图），只放行 `brandLogoUrl()` 这一个地址：其它 `img` 一律删除。这是白名单，不要扩大成通用放行。

## 为什么图片要白名单

`safeMailHtml()` 只放行排版类标签，远程图片默认全部剥离——这是防止跟踪像素与钓鱼图片的既有安全策略。固定结尾里唯一需要的图片是品牌 logo，因此做成「单一地址白名单」：只有 `brandLogoUrl()` 返回的那一个 URL 会被保留，其他 `img` 在清洗后由 `stripUnexpectedImages()` 删除。

以后若要加别的图（产品图、活动横幅），按同样方式逐个加白名单，不建议直接把 `img` 全放开。

## 改动时要注意

- **`htmlToPlainText(renderSignatureHtml(name)) === renderSignatureText(name)` 必须成立。** `contentText` 是从 HTML 转回来的，而审核哈希是对 `contentText` 算的；两者不一致，审核页就会误报「审核后内容已变化」。`tests/letter-signature.test.ts` 覆盖了这条和「过一个空行」的细节。
- 新增的落款行不要以 `Genesis`/`www.`/`http`/邮箱 开头以外的形式出现后又被 `stripSignatureText()` 误删；那组启发式只用于**尾部**的落款识别。
- 草稿发送前的审核哈希校验不需要改：签名在保存草稿前就已经写进正文，审核通过的就是带签名的内容。

## 验证

```bash
cd server
npm run test:mail        # 含 tests/letter-signature.test.ts（7 项）
```
