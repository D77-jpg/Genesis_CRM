import {GENESIS_PLAYBOOK,type PlaybookCardData} from './genesis-playbook.data';
import {IRONHUE_PLAYBOOK} from './ironhue-playbook.data';
import {VELATURO_PLAYBOOK} from './velaturo-playbook.data';
import type {OutreachPlaybookContext} from '../project-profile';

/**
 * Select a project-scoped sales playbook card before drafting. This is a
 * deliberately small, deterministic first pass: it only chooses a card when
 * the customer's own profile / website contains enough matching signals.
 * Card text is strategy and must never be added to the fact evidence bundle.
 */
export interface PlaybookSelectionInput {
  projectKey: string;
  taskType?: string;
  outreachStep?: number;
  industry?: string;
  interestedProducts?: string;
  productCategory?: string;
  websiteText?: string;
  /** Project-managed cards imported through the knowledge workspace. */
  cards?:{segments:PlaybookCardData[];preferences:PlaybookCardData[]};
}

const GENERIC_TERMS=new Set([
  'brand','brands','product','products','packaging','package','pouch','pouches','box','boxes',
  'customer','customers','supplier','suppliers','company','business','retail','wholesale',
  'design','designer','collection','collections','quality','premium','luxury','gift','gifts',
  'boutique','shop','store','spa','resort','hotel','program','range','line','new',
  '品牌','产品','包装','客户','供应商','公司','设计','系列','品质','礼品','高端','轻奢',
]);

// A card may only compete when the customer shows at least one category signal.
// This prevents generic words such as "gift" or "boutique" from selecting a
// hospitality card for a jewelry brand.
const REQUIRED_SIGNALS:Record<string,RegExp>={
  I01:/jewel|necklace|earring|ring|bracelet|pendant|珠宝|首饰/i,
  I02:/candle|蜡烛/i,
  I03:/perfume|fragrance|香水|香氛/i,
  I04:/skincare|skin care|body care|beauty|护肤|身体护理|美妆/i,
  I05:/handmade|artisan|atelier|jewel|珠宝|手作|工坊/i,
  I06:/leather|handbag|皮具|手袋/i,
  I07:/watch|腕表|手表/i,
  I08:/wedding ring|bridal|diamond|婚戒|钻石|高级珠宝/i,
  I09:/scarf|silk tie|necktie|围巾|丝巾|领带/i,
  I10:/jewel|珠宝|multi[- ]?store|chain|连锁/i,
  I11:/makeup brush|beauty tool|美妆|刷具/i,
  I12:/soap|沐浴|天然皂/i,
  I13:/perfume|travel spray|试香|旅行装/i,
  I14:/hair accessory|hair tie|发饰|发圈|头饰/i,
  I15:/eyewear|sunglasses|眼镜|太阳镜/i,
  I16:/sleepwear|lingerie|睡衣|内衣|家居服/i,
  I17:/aromatherapy|essential oil|芳疗|精油/i,
  I18:/wallet|card holder|belt|钱包|卡包|皮带/i,
  I19:/shoe|footwear|bridal|鞋履|婚鞋/i,
  I20:/diffuser|home fragrance|香薰|扩香/i,
  I21:/subscription|礼盒|订阅/i,
  I22:/tea|coffee|茶|咖啡/i,
  I23:/chocolate|candy|bakery|巧克力|糖果|烘焙/i,
  I24:/wine|spirits|葡萄酒|烈酒/i,
  I25:/stationery|notebook|pen|文具|钢笔|手账/i,
  I26:/wedding|event|伴手礼|婚礼|活动/i,
  I27:/ceramic|glass|homeware|陶瓷|玻璃|家居/i,
  I28:/crystal|mineral|spiritual|水晶|矿石|灵性/i,
  I29:/electronic|audio|tech|电子|音频|科技/i,
  I30:/grooming|beard|理容|胡须/i,
  I31:/pet|宠物/i,
  I32:/museum|gallery|design gift|博物馆|美术馆|设计礼品/i,
  I33:/hotel|resort|hospitality|酒店|度假/i,
  I34:/bedding|textile|towel|家纺|床品|毛巾/i,
  I35:/golf|sport|高尔夫|运动/i,
  I36:/handcraft|souvenir|personalized|手工艺|纪念品|个性化/i,
  I37:/beauty salon|clinic|美容院|医美/i,
  I38:/coin|medal|collectible|纪念币|奖章|收藏/i,
  I39:/baby|kid|婴童/i,
  I40:/promotional|low[- ]?cost|促销|赠品/i,
};

function terms(value:string):string[]{
  const text=String(value??'').normalize('NFKC').toLowerCase();
  const result:string[]=[];
  for(const part of text.split(/[^a-z0-9\u4e00-\u9fff-]+/u)){
    for(const match of part.matchAll(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g)){
      const term=match[0].replace(/^-+|-+$/g,'');
      if(term.length>=2&&!GENERIC_TERMS.has(term))result.push(term);
    }
  }
  return result;
}

function scoreCard(card:PlaybookCardData,haystack:string):number{
  let score=0;
  const fields:[keyof Pick<PlaybookCardData,'name'|'signals'|'products'|'logic'>,number][]=[
    ['name',2],['signals',2],['products',3],['logic',1],
  ];
  for(const [field,weight] of fields){
    for(const term of new Set(terms(card[field])))if(haystack.includes(term))score+=weight;
  }
  for(const term of card.keywords??[]){
    if(term.length>=3&&haystack.includes(term.toLowerCase()))score+=3;
  }
  // Keep deliberate multi-word product phrases useful even when tokenization
  // splits them differently (for example "fine jewellery" or "gift box").
  for(const phrase of `${card.products} ${card.signals}`.split(/[、,，/／|｜;；]+/)){
    const value=phrase.trim().toLowerCase();
    if(value.length>=3&&value.length<=40&&haystack.includes(value))score+=2;
  }
  return score;
}

function choosePreference(haystack:string):PlaybookCardData|undefined{
  const id=
    /existing supplier|current supplier|already (?:have|work|source)|incumbent|现有供应商|已有供应商|现有包装|稳定供应/i.test(haystack)
      ? 'P07'
      : /new collection|new product|new brand|launch|new range|新品|新系列|上市/i.test(haystack)
        ? 'P04'
        : /sustainab|eco[- ]?friendly|recycl|环保|可持续/i.test(haystack)
          ? 'P06'
          : /multi[- ]?sku|wholesale|distributor|price|catalog|多个|系列|批发|经销/i.test(haystack)
            ? 'P02'
            : /chain|multi[- ]?store|retailer|连锁|门店/i.test(haystack)
              ? 'P05'
              : 'P01';
  return GENESIS_PLAYBOOK.preferences.find(card=>card.id===id);
}

function chooseIronhuePreference(haystack:string):PlaybookCardData|undefined{
  const id=
    /existing supplier|current supplier|already (?:have|work|source)|incumbent|现有供应商|已有供应商|稳定供应/i.test(haystack)?'IHP07'
      :/new (?:line|product|brand)|launch|first order|新品|新线|首单/i.test(haystack)?'IHP04'
        :/price|budget|cost|margin|毛利|预算|价格/i.test(haystack)?'IHP02'
          :/tender|test|standard|certif|文件|认证|测试|准入/i.test(haystack)?'IHP06'
            :/multi|chain|distributor|wholesale|连锁|批发|多店/i.test(haystack)?'IHP05'
              :'IHP01';
  return IRONHUE_PLAYBOOK.preferences.find(card=>card.id===id);
}

function chooseVelaturoPreference(haystack:string):PlaybookCardData|undefined{
  const id=
    /existing supplier|current supplier|already (?:have|work|source)|incumbent|现有供应商|已有供应商|稳定供应/i.test(haystack)?'VAP07'
      :/deadline|opening|launch date|project date|开业|节点|日期/i.test(haystack)?'VAP03'
        :/trial|test|sample|small batch|试款|样品/i.test(haystack)?'VAP04'
          :/material|frame|flame|clean|材料|画框|阻燃|清洁/i.test(haystack)?'VAP06'
            :/price|budget|cost|预算|价格/i.test(haystack)?'VAP02'
              :'VAP01';
  return VELATURO_PLAYBOOK.preferences.find(card=>card.id===id);
}

const PLAYBOOKS:Record<string,{segments:PlaybookCardData[];preferences:PlaybookCardData[]}>={
  genesis:GENESIS_PLAYBOOK,
  ironhue:IRONHUE_PLAYBOOK,
  velaturo:VELATURO_PLAYBOOK,
};

/** Read-only built-in cards for the admin inspector; selection remains project-aware. */
export function getBuiltinPlaybook(projectKey:string){
  return PLAYBOOKS[projectKey.toLowerCase()];
}

const PROJECT_GATES:Record<string,RegExp>={
  ironhue:/fitness|gym|dumbbell|barbell|kettlebell|weight|strength|training|workout|健身|哑铃|杠铃|壶铃|力量|训练/i,
  velaturo:/wall art|painting|canvas|portrait|art gallery|art consultant|home decor|艺术|画作|油画|丙烯|墙面|肖像|画廊|装饰画/i,
};

const PREFERENCE_CHOOSERS:Record<string,(haystack:string)=>PlaybookCardData|undefined>={
  genesis:choosePreference,
  ironhue:chooseIronhuePreference,
  velaturo:chooseVelaturoPreference,
};

export function selectOutreachPlaybook(input:PlaybookSelectionInput):OutreachPlaybookContext|undefined{
  const projectKey=input.projectKey.toLowerCase();
  const playbook=input.cards??PLAYBOOKS[projectKey];
  if(!playbook)return undefined;
  if(input.taskType&&input.taskType!=='first_outreach'&&input.outreachStep===undefined)return undefined;
  const haystack=[
    input.industry,input.interestedProducts,input.productCategory,input.websiteText,
  ].filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
  if(!haystack.trim())return undefined;
  const gate=input.cards?undefined:PROJECT_GATES[projectKey];
  if(gate&&!gate.test(haystack))return undefined;
  const ranked=playbook.segments
    .filter(card=>Boolean(input.cards)||projectKey!=='genesis'||!REQUIRED_SIGNALS[card.id]||REQUIRED_SIGNALS[card.id].test(haystack))
    .map(card=>({card,score:scoreCard(card,haystack)}))
    .sort((a,b)=>b.score-a.score||a.card.id.localeCompare(b.card.id));
  const top=ranked[0];
  if(!top||top.score<3)return undefined;
  const importedPreference=input.cards?.preferences
    .map(card=>({card,score:scoreCard(card,haystack)}))
    .sort((a,b)=>b.score-a.score||a.card.id.localeCompare(b.card.id))[0]?.card;
  const preference=input.cards?importedPreference:PREFERENCE_CHOOSERS[projectKey]?.(haystack);
  return {
    segmentCode:top.card.id,
    segmentName:top.card.name,
    signals:top.card.signals,
    products:top.card.products,
    logic:top.card.logic,
    avoid:top.card.avoid,
    cta:top.card.cta,
    prepare:top.card.prepare,
    check:top.card.check,
    subjects:top.card.subjects.slice(0,3),
    ...(preference?{
      preferenceCode:preference.id,
      preferenceName:preference.name,
      preferenceLogic:preference.logic,
      preferenceCta:preference.cta,
    }:{}),
    confidence:top.score>=7?'high':'medium',
  };
}
