# 开发信质量：生成链路与这次改了什么

## 一封信是怎么写出来的

```
知识库检索(knowledgeContext) ─┐
客户档案 / 时间线 / 历史邮件  ─┼→ 生成模型（openai-provider: analyzeCustomer）
客户官网快照(website)        ─┘        │
                                       ▼
                         逐项核验 fact-verifier（逐句判定 + 引用证据片段）
                                       │
                    不支持 → 丢弃该句 / 整封重写一次 → 仍不支持 → 兜底安全稿
                                       ▼
                       重建正文（通过核验的句子）+ 固定结尾（签名/logo）
                                       ▼
                          存成草稿 → 业务员自检 → 通过后发送
```

关键点：**生成出来的稿子不等于最终稿**。中间那道 `fact-verifier` 会把「依据里没有的话」删掉。这既是安全底线，也是「写得越来越短」的主要原因。

## 之前为什么只剩一两句话

2026-10-21 用 Yankee Candle 这个真实客户复跑，拆开逐条核验记录能看到三种情况：

| 现象 | 真正原因 |
| --- | --- |
| 正文只剩「官网描述 + 一句提问」 | 能力段落里有一个细节依据里没写（例如「内托能固定蜡烛罐」），整段被判定 unsupported 后**整段删除** |
| 称呼 `Hello Diane,` 不见了 | 称呼被当成「事实陈述」判成 unverifiable 一起删掉 |
| 官网切入点缺失 | 该客户官网抓取失败（`customer_research_gap`：网站限制访问），模型没有客户侧素材可用 |
| 兜底稿是「I am reaching out to introduce our team…」 | 一旦所有段落都没过核验，就退回确定性安全稿；安全稿只会写有依据的条件，没有条件就只剩一句 |

顺带一个模型侧的诱因：改写阶段（rewrite）总是忍不住补细节（内托、采样、交期），补了就再被拒一次。

## 这次改了什么

1. **引用核验按「必要性」分层**（`fact-verifier.ts` `checkSemanticResults`）
   - 普通叙述：核验模型判定有依据，即使我们自己按 Unicode 偏移定位引用片段时没对上（大小写/标点/空格以外的细差），也**不再删整段**，只把判断理由记成「部分引用片段未能精确匹配原文」。
   - 关键承诺（数字、MOQ、价格、交期、认证、产能等）：仍然要求**全部引用精确匹配**，否则整段不通过——这条没有被放宽。
   - 一条引用都对不上（引用了不存在的来源、偏移乱写）：仍然 fail closed，直接判不通过。
2. **称呼与落款按非事实处理**（`courtesy()`）
   `Hello Diane,` / `Hi Tom,` / `Dear Ms. Lee,` 这类只含 1–3 个词的称呼不再被判成待核验的断言，不会再从正文里消失；兜底稿也会保留模型写的称呼。
3. **写作要求从「简洁」改成「有信息密度」**（`openai-provider.ts` 指令）
   明确 110–170 词、3–4 段；称呼用 First Name；第一段客户侧切入点，第二段 2–3 个来自已发布知识的具体能力点，第三段具体下一步 + 一个问题；**禁止「官网描述 + 一句提问」的空稿**，细节必须在知识原文里能找到。
4. **引用匹配放宽到「同字不同排版」**（`evidence-quote.ts`）
   只允许空白/大小写/标点/全半角差异，词与数字仍必须逐字一致（不放开同义改写）。
5. **官网抓取：WAF 拦截时走浏览器兜底**（`website/archive.ts`、`website/browser-fetch.ts`）
   顺序：实时 HTTP → Internet Archive 快照 → 无头浏览器（`WEBSITE_BROWSER_FETCH=true`，需要 `npm i playwright`）。Yankee Candle 这种 Akamai 站点普通 HTTP 客户端一律 403，但无头浏览器能正常打开；抓到的网站快照会带 `collectedAt`（归档内容用快照时间），并在证据里标注为「客户自述」。
6. **改写提示词加硬约束**（`providerFactVerifier.rewrite`）
   不得新增内托、隔档、配件、打样、检测、认证、产能、交期等依据里没有的细节，缺就写短句、不许猜。
7. **草稿 HTML 统一生成**（`renderLetterContent`）
   Agent 任务保存草稿时不再自己拼 `<p>`，改用和手动写信同一条渲染路径——固定结尾、品牌 logo、纯文本一致性都由它保证。
8. **审核哈希基线对齐**（`persistAndSend`）
   落库时把 `knowledgeReview.bodyHash` 重算为「实际保存的正文」的哈希。签名/渲染会改变正文，之前会导致审核页误报「主题或正文已修改」，现在不会再出现。

### 试过但回退的：逐句核验

把核验粒度改成「句子」效果很明显（同一封信 supported 从 1 涨到 5），但它会让一段里没依据的分句各自被放行，违反「整段支持」这个闸门（`knowledge-facts` 有专门用例守着）。已回退，改为上面的「分层引用」来减少误伤。

## 复跑对比（同一客户、同一任务）

改之前（3 次生成里 2 次退化成兜底稿）：

> Dear Diane Doyker,
> I am reaching out to introduce our team and see whether we could help with your requirements.
> Would a brief discussion about your requirements be useful?

改之后（官网抓到了、称呼改为 First Name、能力段写实）：

> Dear Diane,
>
> Your website describes original jar candles crafted with a premium plant wax blend alongside elegant multi-wick designs, home fragrances and seasonal scents, with promotions and gift-led sections.
>
> We produce rigid boxes in our own Xiamen facility, including a drawer-style "matchbox" structure sized for candles and premium retail sets, with a sleeve and tray built to your product's exact dimensions rather than fixed templates. Surface finishes such as foil stamping, embossing, debossing, spot UV and matte or soft-touch lamination can be combined.
>
> Would a brief discussion about your requirements be useful?

`semantic_partial`（有段落未过核验）+ `claims 2`，`customer_research_gap` 已消失。

## 官网抓取的三种路径

| 顺序 | 方式 | 说明 |
| --- | --- | --- |
| 1 | 实时 HTTP | 现有实现：固定 UA、DNS 钉住、只允许同站跳转、只读正文，12s 超时 |
| 2 | Internet Archive 快照 | `archive.org/wayback/available` 取最近快照（≤3 年），`collectedAt` 用快照时间。注意：本机网络访问 archive.org 会超时，可用性取决于部署环境的出网策略 |
| 3 | 无头浏览器 | `WEBSITE_BROWSER_FETCH=true` + `npm i playwright` 后启用；实测 Yankee Candle（Akamai 403）能正常取到正文，单页约 12–15s |

三个都失败时，审核页会出现 `customer_research_gap`，正文只能依据档案与历史往来，不会编造网站内容。

## 还没解决 / 可以继续加的

- **字数仍偏短**：目标 110–170 词，实际 110–140。核验仍会删掉没依据的段落，这是安全底线；想更具体，最有效的办法是把知识库里「产品能力」条目写得更细（结构、工艺、内衬、认证），模型才有可引用的细节。
- **官网抓取依赖出网**：Yankee Candle 这类 Akamai 站点只有无头浏览器能过（约 12–15s/页）；Internet Archive 在本机网络不可达。部署环境需要 `npm i playwright`，并把 `WEBSITE_BROWSER_FETCH=true` 打开。
- **逐页抓取的范围有限**：目前只读首页 + 相关内页（最多 4 页进正文证据），行业方案页需要先在「官网调查」里点重新调查才会更新。
- **知识入口径**：知识库里的「开发信范本 / 三段式」现在是提示词里的参考示例；如果希望模型更贴公司文风，可以把范本单独作为 style 参考注入（不参与事实核验），这需要额外改 `buildAnalysisInput`。

## 自检清单（业务员视角）

1. 第一段有没有说清「为什么找这家客户」？
2. 中间段有没有 2–3 个具体能力点（结构/材质/工艺/认证），而不是形容词？
3. 有没有知识里查不到的数字、交期、承诺？（有就删）
4. 结尾是不是一个明确、低门槛的下一步（例如「要不要给你 2–3 个结构方案」）？
5. 称呼、签名、logo 对不对？（签名与 logo 由系统统一追加）
