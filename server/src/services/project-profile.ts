/**
 * 项目级销售画像 / 开发信配置
 * ------------------------------------------------------------------
 * 自动开发信、客户分析、跟进信和签名都必须跟随「当前项目」，
 * 不能把 Genesis 的包装话术带到 IronHue 或其他项目。
 *
 * 已知项目使用精确配置；未知项目根据 Project.industry / companyName
 * 生成通用配置，至少保证不会串用其他项目的话术。
 */
import type { LetterSignature } from './letter-signature';
import { IRONHUE_LOGO_PATH } from '../constants/ironhue-logo';

export interface ProjectLike {
  code?: string;
  slug?: string;
  name?: string;
  companyName?: string;
  industry?: string;
  website?: string;
  mailFrom?: string;
  senderName?: string;
}

export interface ProjectSalesProfile {
  key: 'genesis' | 'ironhue' | 'general';
  label: string;
  /** 对外身份，一句话 */
  identity: string;
  /** 我方供应什么 */
  offerSummary: string;
  /** 开发信唯一聚焦的采购主题 */
  outreachFocus: string;
  /** 明确禁止询问/评价的无关主题 */
  avoidTopics: string;
  /** 第一段客户洞察的名称 */
  insightLabel: string;
  /** 第一段洞察示例 */
  insightExamples: string;
  /** 第二段可选的真实证明点示例 */
  proofExamples: string;
  /** 第三段低负担 CTA 示例 */
  ctaExamples: string;
  /** 主题必须落在这个范围 */
  subjectFocus: string;
  /** 项目签名 */
  signature: LetterSignature;
}

export type ProjectPromptContext = Omit<ProjectSalesProfile, 'signature'>;

const GENESIS_SIGNATURE: LetterSignature = {
  title: 'Sales Manager, Genesis (Xiamen) Bags Co., Ltd.',
  lines: [
    'Genesis Bags · Custom Packaging Manufacturer · Xiamen· Where Packaging Begins',
    'WhatsApp +86 153 0600 1357 · sales@genesisbags.com',
    'genesisbags.com · genesisgroup.en.alibaba.com',
    'Gold Supplier on Alibaba.com since 2014 · ISO 9001 / FSC® / BSCI Certified',
  ],
  logoAlt: 'Genesis Packaging',
};

const IRONHUE_SIGNATURE: LetterSignature = {
  title: 'Sales Manager, IRONHUE',
  lines: [
    'Free Weight & Strength Training Equipment',
    'Wholesale · OEM · ODM · Private Label',
    'E: sales@ironhue.com',
    'T / WhatsApp: +86 138 6042 3022',
    'W: ironhue.com',
  ],
  logoPath: IRONHUE_LOGO_PATH,
  logoAlt: 'IRONHUE',
};

const GENESIS_PROFILE: ProjectSalesProfile = {
  key: 'genesis',
  label: 'Genesis｜定制包装',
  identity: 'Genesis（厦门）包装制品出口商',
  offerSummary: '我们供应定制包装（礼盒、布袋、纸袋等）。',
  outreachFocus: '客户的包装采购需求',
  avoidTopics: '客户的首饰设计、款式、产品线扩展、设计团队等非包装事项',
  insightLabel: '包装场景洞察',
  insightExamples: '礼盒是收礼人第一眼看到的东西、首饰袋影响开箱体验',
  proofExamples: '袋盒同厂同色、标准款 100 件起、先确认实物样再下单、按签样+书面规格复购',
  ctaExamples: '当前包装形式、尺寸、数量、内衬/托盘、印刷或样品',
  subjectFocus: '包装',
  signature: GENESIS_SIGNATURE,
};

const IRONHUE_PROFILE: ProjectSalesProfile = {
  key: 'ironhue',
  label: 'IRONHUE｜自由重量与力量训练器材',
  identity: 'IRONHUE 的自由重量与力量训练器材 OEM/ODM 制造商',
  offerSummary: '我们供应哑铃、杠铃片、壶铃、杠铃和训练配件，支持私标 Logo、定制颜色与 OEM/ODM。',
  outreachFocus: '客户的自由重量/力量训练器材采购、私标定制与 OEM/ODM 合作',
  avoidTopics: '客户的其他非健身器材产品线（如首饰、蜡烛、服装）、品牌设计、门店装修等无关事项',
  insightLabel: '采购/产品线洞察',
  insightExamples: '客户当前销售的哑铃、杠铃片、壶铃或杠铃产品线，以及自有品牌/私标需求',
  proofExamples: '江苏自有工厂的杠铃片生产与私标定制能力',
  ctaExamples: '客户当前采购的产品线、定制 Logo/颜色需求或样品需求',
  subjectFocus: '自由重量/力量训练器材',
  signature: IRONHUE_SIGNATURE,
};

function generalProfile(project: ProjectLike): ProjectSalesProfile {
  const companyName = String(project.companyName || project.name || '本项目供应商').trim();
  const industry = String(project.industry || '').trim();
  const signatureLines = [
    `${companyName}${industry ? ` · ${industry}` : ''}`,
    project.website ? `Website ${project.website}` : '',
    project.mailFrom ? `Email ${project.mailFrom}` : '',
  ].filter(Boolean);
  return {
    key: 'general',
    label: `${companyName}｜通用项目配置`,
    identity: industry ? `${companyName}（${industry}）的供应商` : `${companyName} 的供应商`,
    offerSummary: industry ? `我们提供${industry}相关的产品与服务。` : '我们提供本项目的产品与服务。',
    outreachFocus: '与本项目产品/服务相关的采购需求',
    avoidTopics: '其他项目、其他行业，以及知识库未确认的品类和承诺',
    insightLabel: '采购场景洞察',
    insightExamples: '客户当前产品/服务与其采购场景之间的具体关联',
    proofExamples: '当前项目已发布知识中的一个能力、交付或服务证明',
    ctaExamples: '客户当前的采购品类、规格或合作方式',
    subjectFocus: '本项目产品/服务',
    signature: {
      title: `Sales Manager, ${companyName}`,
      lines: signatureLines.length ? signatureLines : [companyName],
      logoPath: null,
    },
  };
}

export function resolveProjectSalesProfile(project?: ProjectLike | null): ProjectSalesProfile {
  const p = project ?? {};
  // 只按项目标识匹配已知项目；不要按行业猜测，否则未来同行业项目会误继承 Genesis/IronHue 话术。
  const identity = `${p.code ?? ''} ${p.slug ?? ''} ${p.name ?? ''}`.toLowerCase();
  if (identity.includes('ironhue')) return IRONHUE_PROFILE;
  if (identity.includes('genesis')) return GENESIS_PROFILE;
  return generalProfile(p);
}

export function projectPromptContext(profile: ProjectSalesProfile): ProjectPromptContext {
  const { signature: _signature, ...context } = profile;
  return context;
}

/** 自动创建首封开发信任务时使用的目标文本（项目级，不含其他项目话术） */
export function firstOutreachGoal(profile: ProjectSalesProfile, extra = ''): string {
  return `为首封开发信准备英文草稿，收件人是刚通过审核的新客户。${profile.identity}；${profile.offerSummary} 开发信和结尾问题只围绕${profile.outreachFocus}，不要询问${profile.avoidTopics}。${extra}按三段式写：正文 50–90 词（最多 110 词），一个证明点，一个低负担 CTA；收尾沿用现有签名和 Could you please... 风格。只保存待审核草稿，不发送邮件。`;
}
