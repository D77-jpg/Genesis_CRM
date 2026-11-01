// Generated from the Genesis Lead Scout V1.6 kblib. Keep this a project-scoped
// playbook, not a fact source. The selector only uses card fields; sample email
// bodies are intentionally omitted so the model cannot copy unverified claims.
export interface PlaybookCardData {
 id:string; name:string; signals:string; products:string; logic:string; avoid:string;
 cta:string; prepare:string; check:string; subjects:string[]; keywords?:string[];
}
export const GENESIS_PLAYBOOK: {segments:PlaybookCardData[];preferences:PlaybookCardData[]} = {
  "segments": [
    {
      "id": "I01",
      "name": "独立轻奢／设计师珠宝品牌",
      "signals": "necklace / earrings / demi-fine；有独立站、明确品牌、持续上新；核对包装页",
      "products": "绒布、缎面或棉布首饰袋；适配品牌的袋盒组合",
      "logic": "品牌手感与可持续补货并重；不能仅凭精美网站判断预算",
      "avoid": "仅转售其他品牌、没有包装采购权；个人零售小单",
      "cta": "Want me to mock up two pouch options with your logo?",
      "prepare": "实际袋型近照＋Logo细节＋同尺寸方案；没有案例时提供材质比较",
      "check": "100件仅适用官网FAQ所列标准款（FACT04），定制面料/工艺按500件起核；Logo效果图需设计同事确认可出，且标注为效果图非实物。",
      "subjects": [
        "[Collection] + a matching pouch",
        "Pouches for [Brand]"
      ]
    },
    {
      "id": "I02",
      "name": "精品蜡烛品牌",
      "signals": "scented candle / seasonal collection / gift sets；可见罐型和礼赠入口",
      "products": "蜡烛外礼盒、抽屉盒；按罐型讨论内托",
      "logic": "罐体适配、开盒观感、季节款库存；礼盒不等于运输防护",
      "avoid": "只卖廉价散装蜡烛、无礼赠包装需求；要求未验证的零破损承诺",
      "cta": "If you send me the jar dimensions, I’ll sketch a box-and-insert layout. Worth a try?",
      "prepare": "罐体尺寸示意＋试装照片＋外箱测试方案，不能只展示空盒",
      "check": "礼盒≠运输防护：运输破损、外箱与缓冲须用装好产品另测，客户问起再谈，不在首封预先声明。",
      "subjects": [
        "A box for the [Candle] jar",
        "[Brand] candles – a box idea"
      ]
    },
    {
      "id": "I04",
      "name": "护肤与身体护理礼赠品牌",
      "signals": "skincare sets / body care gifts；记录套装包含的真实SKU",
      "products": "多瓶套装磁吸盒、硬盒与分隔内托",
      "logic": "产品组合变化、瓶罐高低差、装盒效率与上市计划",
      "avoid": "只需灌装容器或医药直接接触包装；无外礼盒需求",
      "cta": "Shall I put together a one-page layout for this set?",
      "prepare": "套装布局图＋实际产品尺寸确认表＋包装组装评估",
      "check": "最终适配以实际瓶罐试装为准；不涉及灌装容器或直接接触包装。",
      "subjects": [
        "A box for your [Set]",
        "[Set] – a layout idea"
      ]
    },
    {
      "id": "I05",
      "name": "定制／手作珠宝与工坊品牌",
      "signals": "handmade / made to order / bespoke jewelry；独立品牌而非个人买家",
      "products": "小型首饰袋、简洁礼盒；按款式尺寸适配",
      "logic": "产品多款少量、品牌识别、库存压力；不预设其采购量很小",
      "avoid": "仅个人制作兴趣或数量明显低于可行起订",
      "cta": "Should I send two fabric options with your logo applied, as a quick visual?",
      "prepare": "同一作品两种材质的示意＋单SKU和混SKU报价边界",
      "check": "100件仅限标准款（FACT04）；客户若要定制颜色/面料，起订按方案核定。效果图标注为示意。",
      "subjects": [
        "Pouches for [Studio]",
        "A small-run pouch for [Collection]"
      ]
    },
    {
      "id": "I03",
      "name": "小众香水／精品香氛品牌",
      "signals": "eau de parfum / niche fragrance / discovery；瓶型与品牌视觉明确",
      "products": "香水瓶二次外礼盒、磁吸盒、展示内托",
      "logic": "瓶型适配、气味干扰、工艺一致性；不能把盒材等同危险品运输资质",
      "avoid": "要求提供玻璃瓶、灌装或危险品运输但超出现有服务范围",
      "cta": "Would a quick concept for this bottle be worth a look?",
      "prepare": "结构样＋瓶型适配＋气味与表面工艺评估清单",
      "check": "盒材气味在实物样上评估；不涉及玻璃瓶、灌装或危险品运输资质。样品费用按FACT05。",
      "subjects": [
        "A box for [Fragrance]",
        "[Brand] – a fitted box idea"
      ]
    },
    {
      "id": "I06",
      "name": "皮具／手袋品牌",
      "signals": "leather handbags / bag care / dust bag；有自有品牌与稳定产品线",
      "products": "棉布、缎面防尘袋；小皮具配套盒",
      "logic": "大袋面料、摩擦与掉色风险、尺寸冗余、补货一致性",
      "avoid": "要求未经验证的绝对防霉、防水或防染色保证",
      "cta": "Want me to put together a size plan for this collection?",
      "prepare": "装袋尺寸图＋面料小样＋建议摩擦／迁色验证项目",
      "check": "迁色/摩擦须用样品与客户皮料实测，不承诺绝对防霉、防染色；面料色卡是否免费寄送先确认。",
      "subjects": [
        "Dust bags for [Bag Collection]",
        "Sizing dust bags for [Brand]"
      ]
    },
    {
      "id": "I10",
      "name": "珠宝连锁／多门店零售商",
      "signals": "store locator / 多门店 / 自有包装；核对集中采购权",
      "products": "统一零售首饰袋、不同尺寸礼盒",
      "logic": "跨门店规格一致、补货节奏、SKU复杂度",
      "avoid": "各店只能用品牌总部指定包装且无采购权",
      "cta": "Would a sample spec sheet be useful for your purchasing team?",
      "prepare": "SKU规格矩阵＋签样清单＋包装装箱规划",
      "check": "先核实是否集中采购；不承诺多地址分仓直发。",
      "subjects": [
        "One pouch spec for every [Retailer] store",
        "Pouch reorders for [Retailer]"
      ]
    },
    {
      "id": "I09",
      "name": "围巾／丝巾／领带等配饰品牌",
      "signals": "silk scarf / tie / accessories gifts；有单品与礼赠分类",
      "products": "缎面或棉布袋、围巾礼盒",
      "logic": "折叠尺寸、印花与包装视觉冲突、体积与手感",
      "avoid": "仅服装挂袋或大件衣物包装、现有尺寸产线不适配",
      "cta": "Shall I send you a side-by-side of the two?",
      "prepare": "折叠样与空隙示意＋材质触感比较",
      "check": "以实际折叠尺寸为准；大件服装挂袋不在范围内。",
      "subjects": [
        "Packaging for [Scarf Collection]",
        "Pouch or box for [Brand] scarves?"
      ]
    },
    {
      "id": "I11",
      "name": "美妆刷具／美容工具品牌",
      "signals": "brush set / beauty tools；核对刷柄长度和套装数量",
      "products": "刷具袋、工具收纳袋与套装盒；不默认复杂拉链包能力",
      "logic": "刷毛受压、内衬掉纤维、工具排列和取放",
      "avoid": "需要专业工具消毒／医疗无菌包装",
      "cta": "If you share the brush lengths, I’ll suggest a size. Would that help?",
      "prepare": "实物试装＋取放演示＋面料掉纤维评估",
      "check": "面料掉纤维需实物评估；复杂拉链化妆包不是默认能力。",
      "subjects": [
        "A pouch for your [Brush Set]",
        "[Brand] brush set packaging"
      ]
    },
    {
      "id": "I18",
      "name": "钱包／卡包／皮带等小皮具品牌",
      "signals": "wallet / cardholder / belt gifts；可核对尺寸",
      "products": "小皮具防尘袋、抽屉礼盒与袋盒套装",
      "logic": "小件礼赠感、皮面接触、不同产品尺寸共用",
      "avoid": "只需塑料卡套或未经确认的全新材料工艺",
      "cta": "Want me to send both options side by side?",
      "prepare": "实物试装＋表面接触检查＋替代结构图",
      "check": "皮面接触以实物检查；皮带需先确认卷装/平装方式。",
      "subjects": [
        "Gift packaging for your [Wallet]",
        "Pouch + box for [Brand]"
      ]
    },
    {
      "id": "I07",
      "name": "精品腕表／独立腕表品牌",
      "signals": "independent watch / microbrand / watch collection；新系列、预售页面",
      "products": "腕表外展示盒、磁吸盒；专用枕与内衬须确认能力",
      "logic": "表带适配、展示姿态、压痕风险与外观一致性",
      "avoid": "超复杂木盒、机械结构或未经验证的保险运输承诺",
      "cta": "Would you like to see one box direction for this model?",
      "prepare": "表样试装与闭盒检查；枕型／包覆结构报价前确认",
      "check": "表枕/包覆内衬能力报价前先确认；不承诺保险运输或机械结构。",
      "subjects": [
        "A presentation box for the [Watch]",
        "[Brand] – watch box idea"
      ]
    },
    {
      "id": "I12",
      "name": "天然皂／沐浴与身体礼品品牌",
      "signals": "soap gifts / bath set / handmade body care；确认是否独立密封",
      "products": "已密封产品的棉麻外袋与礼赠盒",
      "logic": "自然视觉、香味与材料相容性、油脂接触、礼赠组合",
      "avoid": "直接接触未包裹产品且需功能／卫生保证而未验证",
      "cta": "Should I send you cotton and linen swatches?",
      "prepare": "已密封产品的试装图＋材质选择说明",
      "check": "仅用于已独立密封产品；不直接接触裸皂。100件仅限标准款；色卡寄送先确认。",
      "subjects": [
        "Gift pouches for [Bath Collection]",
        "Linen or cotton for [Brand]?"
      ]
    },
    {
      "id": "I14",
      "name": "真丝发饰／发圈／高端头饰品牌",
      "signals": "silk scrunchies / hair accessories / gift bundles",
      "products": "缎面袋、束口袋、小型礼盒",
      "logic": "小件产品包装成本占比、缎面触感、礼赠视觉",
      "avoid": "低价无品牌散货、仅需极小零售订单",
      "cta": "Want me to mock up a pouch in your colors?",
      "prepare": "一件与多件装袋效果＋同尺寸材质比较",
      "check": "100件仅限标准款；效果图标注为示意。",
      "subjects": [
        "Pouches for [Hair Collection]",
        "A scrunchie pouch for [Brand]"
      ]
    },
    {
      "id": "I21",
      "name": "订阅礼盒／主题礼赠品牌",
      "signals": "subscription / monthly box / curated gifts；明确周期与包装采购主体",
      "products": "外展示礼盒与主题布袋；邮寄外箱另行评估",
      "logic": "每期组合改变、装盒效率、体积与截单日",
      "avoid": "一次性无复购项目、寄送结构或自动化装箱能力不匹配",
      "cta": "Worth looking at one edition together?",
      "prepare": "组合尺寸表、组装步骤、出货体积估算",
      "check": "邮寄外箱与自动化装箱另评估；以仓库组装日倒排，不以发货日当完工日。",
      "subjects": [
        "One box, every edition",
        "Packaging for [Subscription Box]"
      ]
    },
    {
      "id": "I13",
      "name": "香水试香／旅行装套组品牌",
      "signals": "discovery set / sample set / travel fragrance；记录小瓶数量",
      "products": "试香套装抽屉盒、旅行装布袋",
      "logic": "小瓶排列、标签可读性、内托开发、套组更新",
      "avoid": "寻求瓶体供应、灌装或液体运输资质",
      "cta": "If you share the vial size, I’ll sketch a layout. Interested?",
      "prepare": "小瓶尺寸确认表＋结构示意与试装检查",
      "check": "瓶型未定版前不锁内托；不涉及瓶体供应、灌装或液体运输资质。",
      "subjects": [
        "A layout for your [Discovery Set]",
        "[Brand] discovery set box"
      ]
    },
    {
      "id": "I20",
      "name": "无火香薰／室内香氛礼赠品牌",
      "signals": "reed diffuser / home fragrance gift；核对杆与瓶的长度差",
      "products": "扩香瓶与配件外礼盒、硬盒与内托",
      "logic": "长配件布局、瓶体固定、渗漏不属于外盒保证",
      "avoid": "需要直接接触香精的容器或未验证危险品服务",
      "cta": "Would a layout sketch for one size be helpful?",
      "prepare": "实际产品试装和运输测试提案，绝不声称外盒防漏",
      "check": "外盒不承担防漏；渗漏与运输表现须另测，绝不声称防漏。",
      "subjects": [
        "A gift box for [Diffuser Range]",
        "[Brand] diffuser box layout"
      ]
    },
    {
      "id": "I16",
      "name": "丝绸睡衣／内衣与家居服品牌",
      "signals": "silk sleepwear / lingerie gift / bridal robe；有礼赠或套装",
      "products": "服饰礼赠缎面／棉布袋与硬盒",
      "logic": "折叠体积、面料接触与色迁移、退换货包装",
      "avoid": "要求大型服装拉链袋或未经验证的防霉抗菌",
      "cta": "Want me to compare a bag and a box on the same folded size?",
      "prepare": "服装折叠样试装＋建议材料接触测试",
      "check": "深色袋与浅色服装迁色须样品实测；不承诺防霉抗菌。",
      "subjects": [
        "Gift bags for [Sleepwear Collection]",
        "A softer alternative to a box"
      ]
    },
    {
      "id": "I08",
      "name": "高端婚戒／钻石与高级珠宝品牌",
      "signals": "fine jewelry / bridal / engagement；高端定位需多项事实交叉判断",
      "products": "戒指盒外礼盒、绒布袋；铰链／灯光盒非默认能力",
      "logic": "单件体验与瑕疵敏感、审批多、切换成本高",
      "avoid": "仅寻求专有珠宝盒结构且本方无能力；供应商准入明显不可达",
      "cta": "Is there a packaging item your team is reviewing this year?",
      "prepare": "近距离做工图、签样与验收清单；无授权不展示别家商标",
      "check": "铰链戒指盒/灯光盒非默认能力；无授权不展示他牌商标；准入与审核周期长，按项目推进。",
      "subjects": [
        "An outer packaging option for [Collection]",
        "[Brand] – a second packaging source"
      ]
    },
    {
      "id": "I15",
      "name": "独立眼镜／太阳镜品牌",
      "signals": "eyewear / sunglasses / frame collection；确认已有镜盒",
      "products": "眼镜外软袋或硬盒外包装；不替代硬质镜盒",
      "logic": "镜片接触风险、袋口尺寸、已有镜盒协同",
      "avoid": "要求未经测试的镜片清洁、防刮或冲击防护声明",
      "cta": "Would an outer-pouch concept be relevant for this range?",
      "prepare": "接触材料验证方案＋实物适配；不承诺擦镜／防刮功能",
      "check": "不承诺擦镜、防刮或抗冲击；镜片接触材料须专项验证。",
      "subjects": [
        "Outer pouches for [Eyewear Range]",
        "A pouch idea for [Brand]"
      ]
    },
    {
      "id": "I17",
      "name": "芳疗／精油与健康礼赠品牌",
      "signals": "aromatherapy / essential oil gift set；确认密封瓶装套组",
      "products": "密封瓶外礼盒、礼赠布袋",
      "logic": "瓶型布局、材料气味、包装与健康宣称边界",
      "avoid": "需要直接接触液体、医疗无菌或健康功效认证",
      "cta": "Shall I put that comparison together?",
      "prepare": "瓶型布局和相容性评估，不用医疗／疗效话术",
      "check": "不用医疗/疗效话术；不涉及直接接触液体或无菌包装。",
      "subjects": [
        "A gift box for [Aromatherapy Set]",
        "[Brand] oils – a box layout"
      ]
    },
    {
      "id": "I25",
      "name": "精品文具／钢笔与手账品牌",
      "signals": "fountain pen / stationery gift / journal set；核对产品布局",
      "products": "钢笔布袋、礼盒、笔记本套组外盒",
      "logic": "长形尺寸、纸面工艺、配件固定、盒体体积",
      "avoid": "需要墨水液体容器、复杂机械开合或专利结构",
      "cta": "Want me to sketch a layout for this set?",
      "prepare": "实际套组布局＋笔表面接触检查",
      "check": "笔身表面接触以实物检查；不含墨水容器或机械开合结构。",
      "subjects": [
        "A gift box for your [Stationery Set]",
        "[Brand] set packaging"
      ]
    },
    {
      "id": "I26",
      "name": "婚礼伴手礼／活动礼赠品牌",
      "signals": "wedding favors / bridesmaid gifts / event gifting；区别专业公司和新人",
      "products": "缎面、欧根纱、棉麻外袋；活动礼盒",
      "logic": "一次性定制多、日期刚性、数量分散和版本错误",
      "avoid": "个人极小订单、已无法满足的活动日期",
      "cta": "Do you have an upcoming event or season you’re planning packaging for?",
      "prepare": "最终版式确认单＋版本清单＋时间倒排",
      "check": "区分专业活动公司与个人新人；活动日≠收货日，交期按排产核实后再承诺。",
      "subjects": [
        "Favor pouches for [Company]",
        "Pouches for your event gifts"
      ]
    },
    {
      "id": "I28",
      "name": "水晶／矿石与灵性礼品品牌",
      "signals": "crystal gifts / gemstone sets / spiritual gifts；品牌与套组",
      "products": "棉麻或绒布袋、密封或已包装产品的礼赠盒",
      "logic": "不规则形状、尖角、重量差异、材质掉纤维",
      "avoid": "重型尖锐原石、未知药草直接接触或功效声明要求",
      "cta": "Should I suggest two or three sizes that would cover your range?",
      "prepare": "代表性实物试装＋尖角与缝口评估",
      "check": "尖角与重件需实物评估缝线；不附加任何疗效宣传；100件仅限标准款。",
      "subjects": [
        "Pouches for [Crystal Set]",
        "Pouch sizes for [Brand] crystals"
      ]
    },
    {
      "id": "I30",
      "name": "男士理容／胡须护理礼赠品牌",
      "signals": "grooming kit / beard gift / shaving set；套装组件可见",
      "products": "瓶罐工具组合外盒与布袋；不默认化妆包复杂版型",
      "logic": "工具与瓶罐混装、纸面与品牌气质、组装效率",
      "avoid": "需要剃刀医疗／危险品或直接液体容器认证",
      "cta": "Worth a quick look?",
      "prepare": "套组布局＋已密封瓶罐试装＋工具接触检查",
      "check": "仅针对已密封瓶罐；剃刀等刀具运输与危险品要求另核。",
      "subjects": [
        "A gift box for your [Grooming Kit]",
        "[Brand] grooming kit layout"
      ]
    },
    {
      "id": "I22",
      "name": "精品茶／咖啡礼赠品牌",
      "signals": "tea gifts / coffee gift sets / corporate gifting；核对密封内包装",
      "products": "已密封茶罐、咖啡袋的二次礼盒与外袋",
      "logic": "罐袋尺寸混合、组合变化、食品接触边界",
      "avoid": "需要未验证直接食品接触袋、阻隔功能或保鲜承诺",
      "cta": "Shall I sketch a layout for this set?",
      "prepare": "密封内包装试装＋明确非直接食品接触范围",
      "check": "仅二次包装，不涉及直接食品接触、阻隔或保鲜功能。",
      "subjects": [
        "A gift box for [Tea or Coffee Set]",
        "[Brand] gift set packaging"
      ]
    },
    {
      "id": "I19",
      "name": "精品鞋履／婚鞋品牌",
      "signals": "bridal shoes / premium footwear / shoe care；有品牌与包装页",
      "products": "鞋履防尘袋；礼盒结构能力先确认",
      "logic": "鞋面材料相容、单只／成对装袋、尺寸与补货",
      "avoid": "超大鞋袋与设备不适配、要求绝对防霉",
      "cta": "Want a quick recommendation on format and fabric?",
      "prepare": "鞋样试装和建议接触测试，不能用普通袋承诺运输保护",
      "check": "超大鞋袋先核设备；迁色/摩擦实测，不承诺防霉或运输保护。",
      "subjects": [
        "Dust bags for [Shoe Collection]",
        "Shoe bags for [Brand]"
      ]
    },
    {
      "id": "I29",
      "name": "消费电子配件／音频与科技礼品品牌",
      "signals": "audio accessories / tech gift / cable set；有自有品牌",
      "products": "配件布袋、套装礼盒；不默认ESD／电池运输能力",
      "logic": "尺寸、多配件收纳、表面接触、功能声明",
      "avoid": "要求防静电、防火、电池危险品运输等未验证能力",
      "cta": "Would that comparison be useful?",
      "prepare": "组装样＋实物接触验证，抗静电等必须有专项依据",
      "check": "抗静电、防火、电池运输等不是默认能力，客户提出再专项评估。",
      "subjects": [
        "Pouches for [Accessory Set]",
        "[Brand] accessory packaging"
      ]
    },
    {
      "id": "I32",
      "name": "博物馆／美术馆与设计礼品零售",
      "signals": "museum shop / exhibition gifts / licensed collection",
      "products": "文创礼盒、艺术周边布袋；授权图案须核对",
      "logic": "艺术版权、跨品类包装、展期、零售与礼赠双场景",
      "avoid": "无授权图案复制、公共机构采购入口无法进入",
      "cta": "Would a packaging direction for one collection be useful?",
      "prepare": "授权范围确认＋版式打样＋适配样",
      "check": "艺术图案授权须客户提供；公共机构采购入口先核实。",
      "subjects": [
        "Packaging for [Exhibition Collection]",
        "Gift pouches for the [Museum] shop"
      ]
    },
    {
      "id": "I24",
      "name": "葡萄酒／烈酒精品礼赠品牌",
      "signals": "wine gifts / spirits gift set / distillery；瓶型和礼赠套组",
      "products": "瓶外布袋、瓶装礼盒；承重内托与运输另验证",
      "logic": "较大重量、固定结构、装配运输与酒类合规边界",
      "avoid": "未经验证重瓶结构、木盒专用结构或酒类配送需求",
      "cta": "Shall I send a side-by-side?",
      "prepare": "瓶样试装＋承重与运输验证项目",
      "check": "重瓶承托与运输须装瓶实测；不涉及酒类配送合规。节日表述仅在临近季节使用。",
      "subjects": [
        "Gift packaging for [Bottle]",
        "Bottle bag or box for [Brand]?"
      ]
    },
    {
      "id": "I31",
      "name": "高端宠物配饰品牌",
      "signals": "premium pet accessories / collar gifts；有品牌礼赠定位",
      "products": "项圈牵引绳外袋、礼盒；包装不作为宠物玩具",
      "logic": "金属件接触、不同尺寸、多SKU和包装滞销",
      "avoid": "要求可咬食、可吞食或宠物安全功能保证",
      "cta": "Want me to mock up a pouch with your logo?",
      "prepare": "实物折叠与试装，清楚标识包装用途",
      "check": "包装非宠物玩具，不承诺可咬/可吞食安全；效果图标注为示意。",
      "subjects": [
        "Gift pouches for [Pet Collection]",
        "[Brand] collar packaging"
      ]
    },
    {
      "id": "I23",
      "name": "巧克力／糖果与烘焙礼赠品牌",
      "signals": "chocolate gifts / confectionery / packaged treats；核对内包装",
      "products": "独立密封食品外礼盒；不默认食品直接接触内托",
      "logic": "食品接触边界、包装气味、温度与节庆周期",
      "avoid": "裸食品直接接触、冷链或保鲜能力需求未满足",
      "cta": "Would a layout for one assortment be useful?",
      "prepare": "二次包装边界、材料要求清单、试装样",
      "check": "不默认食品直接接触内托；不承诺冷链与保鲜。",
      "subjects": [
        "Outer gift boxes for [Collection]",
        "A gift box idea for [Brand]"
      ]
    },
    {
      "id": "I27",
      "name": "精品陶瓷／玻璃与家居礼品品牌",
      "signals": "ceramic gifts / glassware / design objects；有礼赠系列",
      "products": "礼赠外盒；专用缓冲／邮寄结构另确认",
      "logic": "易碎、重量与售后风险，展示盒不能代替缓冲",
      "avoid": "需要本方未验证的防震系统或超大重型盒",
      "cta": "Want me to suggest one box direction for this piece?",
      "prepare": "实际产品试装＋包装系统测试计划",
      "check": "展示盒不能代替缓冲；易碎品须整套包装测试，不承诺零破损。",
      "subjects": [
        "A presentation box for [Object]",
        "[Brand] gift box idea"
      ]
    },
    {
      "id": "I34",
      "name": "精品家纺／床品与毛巾礼赠品牌",
      "signals": "linen bedding / towel gift / textile bundle；有礼赠或包装需求",
      "products": "棉布外袋与纺织品礼盒；大尺寸产线先核对",
      "logic": "折叠体积、湿度与迁色、单位体积成本",
      "avoid": "超大件设备不适用、未经验证防霉或长期压缩功能",
      "cta": "Shall I send that comparison?",
      "prepare": "实物体积测量＋外袋试装＋装箱估算",
      "check": "大尺寸先核产线；不承诺防霉或长期压缩性能。",
      "subjects": [
        "Fabric bags for [Textile Collection]",
        "A gift bag idea for [Brand]"
      ]
    },
    {
      "id": "I33",
      "name": "精品酒店／度假村礼赠与零售项目",
      "signals": "hotel gifts / spa boutique / resort shop；已核实的礼赠或零售项目",
      "products": "欢迎礼外袋、SPA零售礼盒；不默认客房全套耗材供应",
      "logic": "多部门审批、补货点位、品牌标准和到仓日期",
      "avoid": "单店无采购权、超短急单、仅低价消耗品比价",
      "cta": "Who looks after packaging for the boutique or gift program?",
      "prepare": "品牌规范、试装样、收货与装箱方案",
      "check": "集团/单店采购权先核；不默认客房耗材供应；多部门审批计入排期。",
      "subjects": [
        "Packaging for [Hotel] gifts",
        "A pouch for [Gift Program]"
      ]
    },
    {
      "id": "I35",
      "name": "高尔夫／精品运动小配件品牌",
      "signals": "golf accessories / sporting gifts / premium accessories",
      "products": "球标、手套等小配件袋与礼盒；非重器械包装",
      "logic": "不同配件尺寸、粗糙表面接触、礼赠定位与实用性",
      "avoid": "重型器械、户外防水或专业器材保护需专项性能",
      "cta": "Would that be useful?",
      "prepare": "产品试装＋表面接触检查＋Logo近照",
      "check": "不声称耐候或防水；赛事日期须已公开才引用。",
      "subjects": [
        "Gift pouches for [Accessory Set]",
        "[Brand] gift packaging"
      ]
    },
    {
      "id": "I36",
      "name": "手工艺／纪念品与个性化礼品品牌",
      "signals": "personalized keepsakes / artisan gifts / commemorative gifts",
      "products": "纪念小件布袋与礼盒；按实物核对结构",
      "logic": "多款少量、个性化版本、礼赠感与包装成本",
      "avoid": "单次个人订单、侵权图案、超小批量不合适",
      "cta": "Want me to suggest sizes based on your best-sellers?",
      "prepare": "代表性产品试装、版本清单和共同尺寸提案",
      "check": "不复制侵权图案；100件仅限标准款。",
      "subjects": [
        "Pouches for [Keepsake Collection]",
        "[Brand] gift packaging"
      ]
    },
    {
      "id": "I38",
      "name": "纪念币／奖章与收藏品品牌",
      "signals": "commemorative coin / medal / collectible gifts；核对保护壳",
      "products": "带现有保护壳藏品的展示袋／礼盒",
      "logic": "材料相容性、氧化／迁移、展示与长期保存边界",
      "avoid": "要求未检测的无酸、无PVC、长期防氧化等保证",
      "cta": "Would an outer-box layout for this piece be useful?",
      "prepare": "材料相容性验证方案和保护壳试装",
      "check": "不声称无酸、无PVC、档案级或防氧化；相关要求须专项证据。",
      "subjects": [
        "A presentation box for [Collectible]",
        "Outer packaging for [Brand]"
      ]
    },
    {
      "id": "I37",
      "name": "美容院／医美机构的非医疗礼赠",
      "signals": "skincare gift program / aftercare gift；必须确认非医疗包装",
      "products": "密封护肤品或礼赠小件的外袋与盒；非医疗用途",
      "logic": "品牌可信度、卫生边界、活动到货、采购权限",
      "avoid": "医疗器械、药品直接包装、无菌或医用级承诺",
      "cta": "Should I send a quick concept with your logo?",
      "prepare": "非医疗用途声明、密封物品试装、活动时间表",
      "check": "仅限密封、非医疗物品的外包装；不涉及医疗器械、药品或无菌。",
      "subjects": [
        "Gift packaging for [Program]",
        "A pouch for [Clinic] gifts"
      ]
    },
    {
      "id": "I40",
      "name": "大众促销小礼品／低单价赠品品牌",
      "signals": "promotional gifts / giveaway products；必须有可行采购量和预算",
      "products": "简洁棉布、欧根纱或缎面外袋；标准化优先",
      "logic": "价格敏感、运费占比、短活动周期、利润空间",
      "avoid": "极低预算、无采购量、只要最低价且无规格可比性",
      "cta": "Do you have a quantity in mind for your next campaign?",
      "prepare": "同规格阶梯报价、装箱体积和简化工艺对比",
      "check": "只看最低价且无规格可比时暂缓；运费/DDP未授权不报。",
      "subjects": [
        "Simple pouches for [Campaign]",
        "Pouch pricing for [Brand]"
      ]
    },
    {
      "id": "I39",
      "name": "婴童礼赠品牌的成人保管外包装",
      "signals": "baby gifts / newborn hamper；先确认受众、使用场景和安全要求",
      "products": "成人拆取与保管的外礼盒；抽绳袋适用性须评估",
      "logic": "儿童接触与抽绳风险、材料和小部件、法规要求",
      "avoid": "要求默认儿童可用、玩耍或睡眠用途、未验证合规",
      "cta": "Who on your team sets the packaging requirements for this range?",
      "prepare": "用途、接触人群、材料要求和独立测试计划",
      "check": "儿童接触、抽绳与小部件风险须评估；不默认儿童可用；测试与审批时间计入排期。",
      "subjects": [
        "Outer gift boxes for [Gift Set]",
        "[Brand] gift set packaging"
      ]
    }
  ],
  "preferences": [
    {
      "id": "P01",
      "name": "品质与品牌体验优先",
      "signals": "高单件售价仅是线索；再看材质、工艺说明、礼赠服务、包装照片与品牌一致性",
      "products": "",
      "logic": "材质与触感、细节还原、签样与批量一致性",
      "avoid": "开头谈最低价、未经授权堆客户Logo、承诺销量提升",
      "cta": "看一种材质／工艺对比",
      "prepare": "真实近照、材质样、试装样和建议验收项目",
      "check": "",
      "subjects": [
        "Packaging for [Collection]"
      ]
    },
    {
      "id": "P02",
      "name": "品质与性价比平衡",
      "signals": "有价格梯度、组合销售或多SKU，但未必低预算；优先以其明确预算和询盘为准",
      "products": "",
      "logic": "同规格比较、减少结构和SKU复杂度、总到仓成本",
      "avoid": "cheapest、先降材质、不区分数量与贸易条款报低价",
      "cta": "看同用途两种结构",
      "prepare": "相同尺寸数量下的物料、工艺与体积对比",
      "check": "",
      "subjects": [
        "One size for [Collection]?"
      ]
    },
    {
      "id": "P03",
      "name": "到货节点与上市计划优先",
      "signals": "公开发布日、活动日或客户明确交期；预售页面不能推定其包装出问题",
      "products": "",
      "logic": "审批、打样、生产、运输和入仓分节点；先验证可行性",
      "avoid": "guaranteed delivery、未经排产报固定天数、泛指急单都能接",
      "cta": "先核对一个最迟到仓日期",
      "prepare": "经确认的倒排计划与决策截止点；非空白承诺",
      "check": "",
      "subjects": [
        "Packaging for [Launch]"
      ]
    },
    {
      "id": "P04",
      "name": "首单试水与库存风险优先",
      "signals": "新品牌或新系列线索；不可把新品牌自动等同小订单或资金不足",
      "products": "",
      "logic": "缩减款色组合、先验证结构；MOQ按实际方案核定",
      "avoid": "所有产品100件、免费定制样、无条件接受极小单",
      "cta": "看一个简化首单方案",
      "prepare": "一个格式与简化配色方案；注明各SKU起订待核",
      "check": "",
      "subjects": [
        "A first-run pouch for [Collection]"
      ]
    },
    {
      "id": "P05",
      "name": "规模补货与执行稳定优先",
      "signals": "多个门店、稳定多SKU、批发渠道；实际消耗量须问客户",
      "products": "",
      "logic": "规格与封样、复购颜色工艺、装箱与交付计划",
      "avoid": "无证据零色差、100%准时、承诺无限产能",
      "cta": "看一个规格矩阵",
      "prepare": "规格表、批准样和变更记录模板",
      "check": "",
      "subjects": [
        "Consistent reorders for [Brand]"
      ]
    },
    {
      "id": "P06",
      "name": "可持续目标与文件要求优先",
      "signals": "有明确包装材料政策、减量目标或文件要求；绿色网站配色不是证据",
      "products": "",
      "logic": "减量、材料组成、使用与回收情境；按订单核文件",
      "avoid": "笼统eco-friendly、全产品可降解、用FSC代替整套法规合规",
      "cta": "先确认一个材料／文件要求",
      "prepare": "订单对应材料文件；证书有效期与范围需核验",
      "check": "",
      "subjects": [
        "[Brand]’s packaging requirements"
      ]
    },
    {
      "id": "P07",
      "name": "现有供应商稳定／备选供应商",
      "signals": "已有成熟包装或明确表示已有供应商；不能推定对现供不满意",
      "products": "",
      "logic": "低切换风险、非核心SKU试验、备选规格评估",
      "avoid": "诋毁现供应商、猜测质量问题、要求立即全部替换",
      "cta": "看一个备选方案",
      "prepare": "相同已知规格的替代样、差异说明与可行性",
      "check": "",
      "subjects": [
        "A back-up option for [Collection]"
      ]
    },
    {
      "id": "P08",
      "name": "设计还原与开发协作优先",
      "signals": "强设计语言、定制结构或设计师参与；仍要核实谁批准与谁采购",
      "products": "",
      "logic": "可制造性、材料替代、实物与屏幕差异、审批版本",
      "avoid": "免费无限改稿、未经验证百分之百还原、擅自改品牌色",
      "cta": "看一种关键工艺的可行性",
      "prepare": "版本化图稿、材料样与结构样；费用另行确认",
      "check": "",
      "subjects": [
        "Producing the [Collection] detail"
      ]
    }
  ]
};
