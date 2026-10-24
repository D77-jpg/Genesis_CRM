/**
 * 国家归一表（server / web 共用同一份内容，两处文件需保持一致）
 * ------------------------------------------------------------------
 * 背景：国家字段来自手工填写、Excel 导入、官网调查和 AI 抓取，
 * 同一个国家会出现 UK / U.K. / England / 英国 等十几种写法，
 * 导致筛选、统计和列表展示都不一致。
 *
 * 这里的规则：
 * - 统一「存储值」= 中文简称（如 英国、美国），前端展示为「🇬🇧 英国」。
 * - 任何别名（英文名、ISO2 / ISO3、常见口语写法、繁体 / 别称）都归一到同一个简称。
 * - 识别不了的值原样保留，绝不丢弃用户填的内容。
 *
 * 数据行格式：ISO2|English name|中文简称|别名1,别名2,...
 */

export interface CountryEntry {
  /** ISO 3166-1 alpha-2 */
  code: string;
  /** 中文简称（统一存储值） */
  name: string;
  /** 英文名 */
  en: string;
  /** 其它可识别的写法 */
  aliases: string[];
}

const COUNTRY_SOURCE = `
US|United States|美国|USA,US,U.S.A.,U.S.,America,United States of America,美利坚,美利坚合众国
GB|United Kingdom|英国|UK,U.K.,GB,GBR,Great Britain,Britain,England,Scotland,Wales,Northern Ireland,英格兰,苏格兰,威尔士,大不列颠,联合王国
DE|Germany|德国|DE,DEU,Deutschland,西德
FR|France|法国|FR,FRA
IT|Italy|意大利|IT,ITA,Italia
ES|Spain|西班牙|ES,ESP,Espana,España
PT|Portugal|葡萄牙|PT,PRT
NL|Netherlands|荷兰|NL,NLD,Holland,The Netherlands
BE|Belgium|比利时|BE,BEL
LU|Luxembourg|卢森堡|LU,LUX
CH|Switzerland|瑞士|CH,CHE,Suisse,Schweiz
AT|Austria|奥地利|AT,AUT,Osterreich,Österreich
SE|Sweden|瑞典|SE,SWE
NO|Norway|挪威|NO,NOR
DK|Denmark|丹麦|DK,DNK
FI|Finland|芬兰|FI,FIN
IS|Iceland|冰岛|IS,ISL
IE|Ireland|爱尔兰|IE,IRL,Eire
PL|Poland|波兰|PL,POL
CZ|Czechia|捷克|CZ,CZE,Czech Republic,Czech
SK|Slovakia|斯洛伐克|SK,SVK
HU|Hungary|匈牙利|HU,HUN
RO|Romania|罗马尼亚|RO,ROU
BG|Bulgaria|保加利亚|BG,BGR
GR|Greece|希腊|GR,GRC,Hellas
TR|Turkey|土耳其|TR,TUR,Turkiye,Türkiye
RU|Russia|俄罗斯|RU,RUS,Russian Federation,俄国
UA|Ukraine|乌克兰|UA,UKR
BY|Belarus|白俄罗斯|BY,BLR
MD|Moldova|摩尔多瓦|MD,MDA
RS|Serbia|塞尔维亚|RS,SRB
HR|Croatia|克罗地亚|HR,HRV
SI|Slovenia|斯洛文尼亚|SI,SVN
BA|Bosnia and Herzegovina|波黑|BA,BIH,Bosnia
AL|Albania|阿尔巴尼亚|AL,ALB
CY|Cyprus|塞浦路斯|CY,CYP
MT|Malta|马耳他|MT,MLT
LT|Lithuania|立陶宛|LT,LTU
LV|Latvia|拉脱维亚|LV,LVA
EE|Estonia|爱沙尼亚|EE,EST
GE|Georgia|格鲁吉亚|GE,GEO
AM|Armenia|亚美尼亚|AM,ARM
AZ|Azerbaijan|阿塞拜疆|AZ,AZE
KZ|Kazakhstan|哈萨克斯坦|KZ,KAZ
UZ|Uzbekistan|乌兹别克斯坦|UZ,UZB
MN|Mongolia|蒙古|MN,MNG,蒙古国
CA|Canada|加拿大|CA,CAN
MX|Mexico|墨西哥|MX,MEX,Mexico City
BR|Brazil|巴西|BR,BRA,Brasil
AR|Argentina|阿根廷|AR,ARG
CL|Chile|智利|CL,CHL
CO|Colombia|哥伦比亚|CO,COL
PE|Peru|秘鲁|PE,PER
EC|Ecuador|厄瓜多尔|EC,ECU
UY|Uruguay|乌拉圭|UY,URY
VE|Venezuela|委内瑞拉|VE,VEN
PY|Paraguay|巴拉圭|PY,PRY
CU|Cuba|古巴|CU,CUB
CN|China|中国|CN,CHN,Mainland China,中国大陆,中华人民共和国,PRC
HK|Hong Kong|中国香港|HK,HKG,Hong Kong SAR,香港,Hongkong
TW|Taiwan|中国台湾|TW,TWN,台湾,台灣
MO|Macao|中国澳门|MO,MAC,Macau,澳门,澳門
JP|Japan|日本|JP,JPN
KR|South Korea|韩国|KR,KOR,Korea,Republic of Korea,南韩,南朝鲜
SG|Singapore|新加坡|SG,SGP
MY|Malaysia|马来西亚|MY,MYS
TH|Thailand|泰国|TH,THA
VN|Vietnam|越南|VN,VNM,Viet Nam
ID|Indonesia|印尼|ID,IDN,印度尼西亚
PH|Philippines|菲律宾|PH,PHL
IN|India|印度|IN,IND
PK|Pakistan|巴基斯坦|PK,PAK
BD|Bangladesh|孟加拉|BD,BGD,孟加拉国
LK|Sri Lanka|斯里兰卡|LK,LKA
NP|Nepal|尼泊尔|NP,NPL
AE|United Arab Emirates|阿联酋|AE,ARE,UAE,U.A.E.,Emirates,迪拜
SA|Saudi Arabia|沙特阿拉伯|SA,SAU,KSA,沙特
QA|Qatar|卡塔尔|QA,QAT
KW|Kuwait|科威特|KW,KWT
OM|Oman|阿曼|OM,OMN
BH|Bahrain|巴林|BH,BHR
JO|Jordan|约旦|JO,JOR
LB|Lebanon|黎巴嫩|LB,LBN
IL|Israel|以色列|IL,ISR
EG|Egypt|埃及|EG,EGY
MA|Morocco|摩洛哥|MA,MAR
TN|Tunisia|突尼斯|TN,TUN
DZ|Algeria|阿尔及利亚|DZ,DZA
NG|Nigeria|尼日利亚|NG,NGA
GH|Ghana|加纳|GH,GHA
KE|Kenya|肯尼亚|KE,KEN
ET|Ethiopia|埃塞俄比亚|ET,ETH
TZ|Tanzania|坦桑尼亚|TZ,TZA
ZA|South Africa|南非|ZA,ZAF
AU|Australia|澳大利亚|AU,AUS,澳洲
NZ|New Zealand|新西兰|NZ,NZL
`;

/** 解析数据行，得到结构化的国家表 */
export const COUNTRIES: readonly CountryEntry[] = COUNTRY_SOURCE.trim()
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [code, en, name, aliasText] = line.split('|');
    return {
      code,
      en,
      name,
      aliases: (aliasText ?? '').split(',').map((item) => item.trim()).filter(Boolean),
    };
  });

/** 把任意写法压成匹配键：小写、去掉空格与常见分隔符 */
function toKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\u3000.,;:'"`’‘“”·\-_/\\()（）[\]【】<>{}&+]/g, '');
}

/** 匹配键 -> 规范国家（同一国家可能命中多个键，值都指向同一条记录） */
const KEY_INDEX: Map<string, CountryEntry> = (() => {
  const index = new Map<string, CountryEntry>();
  COUNTRIES.forEach((entry) => {
    [entry.code, entry.en, entry.name, ...entry.aliases].forEach((candidate) => {
      const key = toKey(candidate);
      if (key && !index.has(key)) index.set(key, entry);
    });
  });
  return index;
})();

/** 规范中文简称 -> 条目 */
const NAME_INDEX: Map<string, CountryEntry> = new Map(COUNTRIES.map((entry) => [entry.name, entry]));

/** 由 ISO2 生成国旗 emoji（区域指示符号），识别失败返回空串 */
export function flagOfCountryCode(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/**
 * 归一国家写法：返回统一的中文简称。
 * 空值返回 null；识别不了的原样返回（trim 后），保证不丢用户填的内容。
 */
export function normalizeCountry(input?: string | null): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const hit = KEY_INDEX.get(toKey(raw));
  return hit ? hit.name : raw;
}

/** 判断是否是我们认识的国家写法 */
export function isKnownCountry(input?: string | null): boolean {
  const raw = (input ?? '').trim();
  return Boolean(raw && KEY_INDEX.has(toKey(raw)));
}

/** 某个国家（中文简称或任意写法）的所有已知写法，用于宽松匹配库里未归一的历史数据 */
export function countryAliasList(input?: string | null): string[] {
  const raw = (input ?? '').trim();
  if (!raw) return [];
  const entry = KEY_INDEX.get(toKey(raw)) ?? NAME_INDEX.get(raw);
  if (!entry) return [raw];
  return [...new Set([entry.name, entry.en, entry.code, ...entry.aliases])];
}

/** 国旗 emoji：识别不了返回空串 */
export function countryFlag(input?: string | null): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const entry = KEY_INDEX.get(toKey(raw));
  return entry ? flagOfCountryCode(entry.code) : '';
}

/** 国家代码（ISO2 小写），识别不了返回空串；前端用它加载本地国旗图片 */
export function countryCode(input?: string | null): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const entry = KEY_INDEX.get(toKey(raw));
  return entry ? entry.code.toLowerCase() : '';
}

/**
 * 结构化展示信息：{ code, name }。
 * 认不出来的国家 code 为空、name 保持原文，调用方可只显示文字。
 */
export function countryInfo(input?: string | null): { code: string; name: string } | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const entry = KEY_INDEX.get(toKey(raw));
  return entry ? { code: entry.code.toLowerCase(), name: entry.name } : { code: '', name: raw };
}
/** 展示用文案：「🇬🇧 英国」；识别不了的国家原样显示 */
export function formatCountry(input?: string | null): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const entry = KEY_INDEX.get(toKey(raw));
  if (!entry) return raw;
  return `${flagOfCountryCode(entry.code)} ${entry.name}`;
}

/** 下拉候选项：value 用统一简称，label 带国旗 */
export const COUNTRY_OPTIONS: readonly { value: string; label: string }[] = COUNTRIES.map((entry) => ({
  value: entry.name,
  label: `${flagOfCountryCode(entry.code)} ${entry.name}`,
}));

/** 导入 / 批量场景的国家取值结果 */
export interface ResolvedCountry {
  /** 归一后的国家；一个都认不出来时是原文（可能为空串） */
  value: string;
  /** 原文写了多个国家（United Kingdom / New Zealand） */
  mixed: boolean;
  /** 一个都认不出来 */
  unknown: boolean;
  /** 原文带了城市补充（Ireland (Dublin)） */
  withRegion: boolean;
  /** 归一结果和原文是否不同（用于提示「已自动整理」） */
  changed: boolean;
}

/**
 * Excel / 批量导入用的国家解析：
 *   "United States"                     -> 美国
 *   "Ireland (Dublin)"                  -> 爱尔兰（去掉城市补充）
 *   "United Kingdom / New Zealand"      -> 英国（多国取第一个认得的）
 *   "Mars"                              -> Mars（认不出来原样保留）
 * 手工录入不走这里，避免把用户写的细节吞掉。
 */
export function resolveCountry(input?: string | null): ResolvedCountry {
  const raw = (input ?? '').trim();
  if (!raw) return { value: '', mixed: false, unknown: false, withRegion: false, changed: false };

  const direct = KEY_INDEX.get(toKey(raw));
  if (direct) {
    return { value: direct.name, mixed: false, unknown: false, withRegion: false, changed: direct.name !== raw };
  }

  const stripped = raw.replace(/\s*[（(][^（()）]*[)）]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const withRegion = stripped !== raw;
  if (withRegion) {
    const hit = KEY_INDEX.get(toKey(stripped));
    if (hit) return { value: hit.name, mixed: false, unknown: false, withRegion: true, changed: true };
  }

  const parts = stripped
    .split(/\s*(?:[/／、,，;；|｜]|&|\+)\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const hit = KEY_INDEX.get(toKey(part));
      if (hit) return { value: hit.name, mixed: true, unknown: false, withRegion, changed: true };
    }
    return { value: raw, mixed: true, unknown: true, withRegion, changed: false };
  }

  return { value: raw, mixed: false, unknown: true, withRegion, changed: false };
}
