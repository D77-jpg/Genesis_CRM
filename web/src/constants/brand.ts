/**
 * 产品品牌常量
 * ------------------------------------------------------------------
 * 产品名统一由这里提供，避免标题、侧栏、公开页和邮件模板各写一套。
 * 品牌名固定为 GlobalCRM；只有浏览器标题允许通过 VITE_APP_TITLE 增加环境后缀
 * （例如 GlobalCRM Staging），避免旧环境变量把产品字标改回旧名称。
 */
export const PRODUCT_NAME = 'GlobalCRM';
export const PRODUCT_NAME_UPPER = 'GLOBALCRM';
const configuredTitle = String(import.meta.env.VITE_APP_TITLE || '').trim();
const legacyTitles = new Set(['客户开发信管理工具', 'Customer Dev Letter Manager', 'Genesis CRM', 'GENESIS CRM']);
export const PRODUCT_DISPLAY_NAME = !configuredTitle || legacyTitles.has(configuredTitle)
  ? PRODUCT_NAME
  : configuredTitle;
export const PRODUCT_TAGLINE = '跨境 B2B 销售 CRM';
export const PRODUCT_TAGLINE_EN = 'Cross-border B2B Sales CRM';
